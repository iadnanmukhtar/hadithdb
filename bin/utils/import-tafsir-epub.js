#!/usr/bin/env node
/* jslint node:true, esversion:9 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const mysql = require('mysql');
const AdmZip = require('adm-zip');
const cheerio = require('cheerio');
const { execSync } = require('child_process');

require('dotenv').config();

const DEFAULT_MAX_PREFIX_WORDS = 8;
const DEFAULT_MIN_PREFIX_WORDS = 4;
const DEFAULT_MIN_TOC_MATCH_RATIO = 0.9;
const PRESETS_FILE = path.join(__dirname, 'tafsir-epub-presets.json');

async function run(argv = process.argv.slice(2)) {
	const options = readOptions(argv);
	const db = makeDbConnection();
	let transactionStarted = false;
	let verseRows = [];
	const verseByRef = new Map();
	let verseByLinear = [];

	const conn = await getConnection(db);
	try {
		verseRows = await query(conn, `
			SELECT id, num, COALESCE(body_ar_alt, body) AS body
			FROM hadiths
			WHERE bookId=0
				AND num REGEXP '^[0-9]+:[1-9][0-9]*$'
			ORDER BY
				CAST(SUBSTRING_INDEX(num, ':', 1) AS UNSIGNED),
				CAST(SUBSTRING_INDEX(num, ':', -1) AS UNSIGNED),
				id`);
		for (const row of verseRows) {
			if (!isQuranRef(row.num) || !row.body || !row.body.trim())
				continue;
			const location = parseRef(row.num);
			const ref = `${location.surah}:${location.ayah}`;
			const existing = verseByRef.get(ref);
			if (existing) {
				existing.id = row.id;
				existing.text = normalizeVerseText(row.body);
				continue;
			}
			const item = {
				surah: location.surah,
				ayah: location.ayah,
				id: row.id,
				linearIndex: verseByLinear.length,
				text: normalizeVerseText(row.body)
			};
			verseByRef.set(ref, item);
			verseByLinear.push(item);
		}
		verseRows = verseByLinear;
		if (!verseRows.length)
			throw new Error('No Quran rows were returned from local DB. Is the DB running and initialized?');
		if (verseRows.length < 6236)
			console.warn(`WARNING: Quran row count is ${verseRows.length}; boundary matching may be incomplete.`);

		const prefixMap = buildVersePrefixMap(verseRows, options.maxPrefixWords, options.minPrefixWords);
		const passages = parseEpub(options.epub, verseRows, verseByRef, prefixMap, options);
		if (!passages.length)
			throw new Error('Could not detect usable tafsir passages from EPUB with current settings.');
		validateParsedPassages(passages, options);

		if (options.dryRun) {
			console.log(`DRY RUN: parsed ${passages.length} passages for '${options.alias}'.`);
			for (const [index, passage] of passages.slice(0, 10).entries())
				console.log(`${index + 1}. ${passage.start} -> ${passage.end} (${passage.text.length} chars)`);
			if (passages.length > 10)
				console.log(`... and ${passages.length - 10} more`);
			if (passages.tocValidation) {
				console.log(`TOC starts: expected ${passages.tocValidation.expectedStarts}, matched ${passages.tocValidation.matchedStarts}, missed ${passages.tocValidation.missedStarts}.`);
			}
			if (passages.unresolved > 0)
				console.log(`WARNING: ${passages.unresolved} paragraph(s) were skipped before first boundary match.`);
			return;
		}

		await query(conn, 'START TRANSACTION');
		transactionStarted = true;
		const bookId = await upsertCommentary(conn, options.alias, options.bookConfig);
		if (options.overwrite)
			await query(conn, `DELETE FROM hadiths_commentary WHERE bookId=${bookId}`);

		const values = [];
		let skipped = 0;
		for (const passage of passages) {
			const startAyah = verseByRef.get(passage.start);
			const endAyah = verseByRef.get(passage.end);
			if (!startAyah || !endAyah) {
				skipped++;
				continue;
			}
			if (!passage.text || !passage.text.trim())
				continue;
			values.push(`(
				${bookId},
				${startAyah.id},
				${startAyah.surah},
				${startAyah.ayah},
				${endAyah.ayah},
				${startAyah.ayah},
				${mysql.escape(passage.text)},
				NULL
			)`);
		}

		if (!values.length)
			console.log('No valid passages to insert.');
		else {
			for (let offset = 0; offset < values.length; offset += options.batchSize) {
				const batch = values.slice(offset, offset + options.batchSize);
				await query(conn, `
					INSERT INTO hadiths_commentary
						(bookId, hadithId, surah, ayahFrom, ayahTo, passageNum, text, text_en)
					VALUES ${batch.join('\n,')}
					ON DUPLICATE KEY UPDATE
						hadithId=VALUES(hadithId),
						surah=VALUES(surah),
						ayahFrom=VALUES(ayahFrom),
						ayahTo=VALUES(ayahTo),
						passageNum=VALUES(passageNum),
						text=VALUES(text),
						text_en=VALUES(text_en)`);
				console.log(`Inserted ${Math.min(offset + options.batchSize, values.length)}/${values.length} '${options.alias}' rows...`);
			}
		}

		if (skipped)
			console.log(`Skipped ${skipped} passages due to unresolved references.`);
		await query(conn, 'COMMIT');
		transactionStarted = false;

		if (options.buildIndex) {
			console.log(`Building commentary index for ${options.alias}...`);
			execSync(`node ${path.resolve(__dirname, '../../bin/buildCommentariesIndex.js')} --tafsir ${JSON.stringify(options.alias)}`, {
				env: Object.assign({}, process.env, {
					BULK_INDEX_GZIP: process.env.BULK_INDEX_GZIP || '1'
				}),
				stdio: 'inherit',
				shell: true
			});
		}

		console.log(`Loaded ${values.length} '${options.alias}' passages.`);
	} catch (err) {
		if (transactionStarted) {
			try {
				await query(conn, 'ROLLBACK');
			} catch (rollbackErr) {
				console.error(`ROLLBACK ERROR: ${rollbackErr.message}`);
			}
		}
		console.error(`ERROR: ${err.message}`);
		process.exitCode = 1;
	} finally {
		db.end();
	}
}

if (require.main === module)
	run();

function parseEpub(epubPath, verseByLinear, verseByRef, prefixMap, options) {
	const zip = new AdmZip(epubPath);
	const contentPath = resolveContentOpf(zip);
	const opfText = zip.readAsText(contentPath);
	const files = spineOrderFromOpf(opfText, contentPath);
	const tocEntries = parseTocEntries(zip, contentPath, opfText, options.maxSurah);
	if (debugTocEnabled())
		console.log(`DEBUG TOC entries=${tocEntries.length}, sample=${JSON.stringify(tocEntries.slice(0, 3))}`);
	const tocById = new Map();
	const usePrefixFallback = tocEntries.length === 0;
	const tocValidation = {
		expectedStarts: tocEntries.length,
		matchedStarts: 0,
		missedStarts: 0,
		matches: []
	};
	for (const entry of tocEntries) {
		if (entry.anchorId)
			tocById.set(entry.anchorId, entry);
	}

	let started = false;
	let current = null;
	const passages = [];
	let unresolved = 0;

	for (const filename of files) {
		const content = zip.readAsText(filename);
		if (!isTocTextFile(content))
			continue;

		const printedPage = extractPrintedPageNumber(content);
		const fallbackPage = extractPageFromFilename(filename);
		const page = Number.isFinite(fallbackPage) ? fallbackPage : printedPage;
		if (!started) {
			if (Number.isInteger(page) && page >= options.startPage)
				started = true;
			else
				continue;
		}

		const $ = cheerio.load(content, { decodeEntities: true }, false);
		const nodes = $('p,span,h1,h2,h3,h4,h5,h6').toArray();
		let activeTocBoundary = null;

		for (const node of nodes) {
			const tag = String(node.name || '').toLowerCase();
			if (tag !== 'p') {
				const anchorId = $(node).attr('id');
				const candidate = anchorId ? tocById.get(anchorId) : null;
				if (candidate)
					activeTocBoundary = candidate;
				continue;
			}
			if (tag !== 'p')
				continue;
			const raw = normalizeSpace($(node).text().replace(/\r\n?/g, ' '));
			if (!raw)
				continue;
			if (isFooterParagraph(raw) || isTocHeader(raw))
				continue;

			const boundary = detectBoundary(raw, verseByLinear, verseByRef, prefixMap, options, current, activeTocBoundary, usePrefixFallback);
			if (activeTocBoundary) {
				if (boundary && boundary.startRef === activeTocBoundary.ref) {
					tocValidation.matchedStarts++;
					tocValidation.matches.push({
						anchorId: activeTocBoundary.anchorId,
						ref: boundary.startRef,
						startLinear: boundary.linearIndex
					});
					activeTocBoundary = null;
				}
			}
			if (!boundary && !current) {
				unresolved++;
				continue;
			}
			if (boundary) {
				if (current) {
					const closeAt = boundary.linearIndex - 1;
					const safeClose = current.forceHardEnd != null ? Math.min(closeAt, current.forceHardEnd) : closeAt;
					emitPassage(passages, current, safeClose, verseByLinear);
				}
				const text = (boundary.bodyText || '').trim();
				current = {
					startLinear: boundary.linearIndex,
					startAyahRef: boundary.startRef,
					forceHardEnd: boundary.forceHardEnd,
					buffer: text ? [text] : []
				};
				continue;
			}
			current.buffer.push(raw);
		}
	}

	if (current)
		emitPassage(passages, current, current.forceHardEnd != null ? current.forceHardEnd : verseByLinear.length - 1, verseByLinear);

	passages.unresolved = unresolved;
	tocValidation.missedStarts = Math.max(0, tocValidation.expectedStarts - tocValidation.matchedStarts);
	passages.tocValidation = tocValidation;
	return passages;
}

function validateParsedPassages(passages, options) {
	const validation = passages.tocValidation;
	if (!validation || validation.expectedStarts < 1)
		throw new Error('The EPUB does not expose verse-level TOC boundaries; refusing to import unverified passages.');
	const matchRatio = validation.matchedStarts / validation.expectedStarts;
	if (matchRatio < options.minTocMatchRatio) {
		throw new Error(
			`Only ${validation.matchedStarts}/${validation.expectedStarts} verse-level TOC boundaries matched ` +
			`(${(matchRatio * 100).toFixed(1)}%); refusing to replace existing tafsir rows.`
		);
	}
	const firstMatchedRef = validation.matches[0] && validation.matches[0].ref;
	if (firstMatchedRef && !passages.some(passage => passage.start === firstMatchedRef))
		throw new Error(`The first matched TOC boundary ${firstMatchedRef} did not produce a passage; refusing to import.`);
}

function emitPassage(passages, current, endLinearIndex, verseByLinear) {
	const clampedEnd = Math.min(Math.max(current.startLinear, endLinearIndex), verseByLinear.length - 1);
	const forcedEnd = current.forceHardEnd != null ? current.forceHardEnd : clampedEnd;
	const endVerse = verseByLinear[Math.min(forcedEnd, clampedEnd)];
	if (!endVerse)
		return;
	const text = toMarkdown(current.buffer.join('\n\n'));
	if (!text)
		return;
	passages.push({
		start: current.startAyahRef,
		end: `${endVerse.surah}:${endVerse.ayah}`,
		text
	});
}

function detectBoundary(rawParagraph, verseByLinear, verseByRef, prefixMap, options, current, tocBoundaryHint, usePrefixFallback) {
	if (tocBoundaryHint) {
		const tocBoundary = detectBoundaryFromTocBoundary(rawParagraph, verseByRef, current, tocBoundaryHint, options.maxSurah);
		if (tocBoundary)
			return tocBoundary;
	}
	if (!usePrefixFallback)
		return null;
	const markerBoundary = detectBoundaryFromMarkerAtStart(rawParagraph, verseByRef, current, options.maxSurah);
	if (markerBoundary && isMonotonicBoundary(current, { surah: Number(markerBoundary.startRef.split(':')[0]), linearIndex: markerBoundary.linearIndex }, rawParagraph))
		return markerBoundary;
	if (!current)
		return null;
	return detectBoundaryFromPrefix(rawParagraph, prefixMap, options.minPrefixWords, options.maxPrefixWords, current, options.maxSurah);
}

function detectBoundaryFromTocBoundary(paragraph, verseByRef, current, tocBoundary, maxSurah) {
	if (!tocBoundary || !tocBoundary.surah || !tocBoundary.ayah)
		return null;
	const explicitStart = verseByRef.get(`${tocBoundary.surah}:${tocBoundary.ayah}`);
	if (!explicitStart)
		return null;
	if (explicitStart.surah > maxSurah)
		return null;
	if (current && explicitStart.linearIndex < current.startLinear)
		return null;
	return {
		startRef: `${tocBoundary.surah}:${tocBoundary.ayah}`,
		linearIndex: explicitStart.linearIndex,
		forceHardEnd: null
	};
}

function detectBoundaryFromMarkerAtStart(paragraph, verseByRef, current, maxSurah) {
	const regex = /^\(\s*([\d\u0660-\u0669]+)\s*[:：]\s*([\d\u0660-\u0669]+)(?:\s*(?:-|\u2013|\u2014|\u060C|،|\s*إِلَى\s*|\s*إلى\s*|\s*to\s*|\s*To\s*|\s*TO\s*)\s*([\d\u0660-\u0669]+))?\s*\)\s*(.*)$/u;
	const match = regex.exec(paragraph);
	if (!match)
		return null;
	const surah = Number(toEnglishDigits(match[1]));
	const ayah = Number(toEnglishDigits(match[2]));
	const rawRangeTo = match[3] ? toEnglishDigits(match[3]) : null;
	const startRef = `${surah}:${ayah}`;
	const start = verseByRef.get(startRef);
	if (!start || start.surah > maxSurah || (current && isMonotonicBoundary(current, start, paragraph) === false))
		return null;

	let forceHardEnd = null;
	if (rawRangeTo) {
		const endRef = `${surah}:${Number(rawRangeTo)}`;
		const end = verseByRef.get(endRef);
		if (end && end.linearIndex >= start.linearIndex)
			forceHardEnd = end.linearIndex;
	}

	return {
		startRef,
		linearIndex: start.linearIndex,
		forceHardEnd,
		bodyText: normalizeSpace(match[4] || '')
	};
}

function detectBoundaryFromPrefix(paragraph, prefixMap, minPrefixWords, maxPrefixWords, current, maxSurah) {
	const words = normalizeArabic(paragraph).split(' ').filter(Boolean);
	const maxCount = Math.min(maxPrefixWords, words.length);
	for (let count = maxCount; count >= minPrefixWords; count--) {
		const key = words.slice(0, count).join(' ');
		const candidates = prefixMap.get(key) || [];
		if (!candidates.length)
			continue;
		const inRangeCandidates = candidates.filter(item => item.surah <= maxSurah);
		if (!inRangeCandidates.length)
			continue;
		if (inRangeCandidates.length === 1 && (!current || isMonotonicBoundary(current, inRangeCandidates[0], paragraph)))
			return { startRef: `${inRangeCandidates[0].surah}:${inRangeCandidates[0].ayah}`, linearIndex: inRangeCandidates[0].linearIndex, forceHardEnd: null };
		if (!current)
			continue;
		const afterCurrent = inRangeCandidates.filter(item => isMonotonicBoundary(current, item, paragraph));
		if (!afterCurrent.length)
			continue;
		const chosen = afterCurrent.reduce((acc, item) => (item.linearIndex < acc.linearIndex ? item : acc));
		if (chosen)
			return { startRef: `${chosen.surah}:${chosen.ayah}`, linearIndex: chosen.linearIndex, forceHardEnd: null };
	}
	return null;
}

function isMonotonicBoundary(current, candidate, paragraph) {
	if (!current)
		return candidate.linearIndex > -1;
	if (candidate.linearIndex <= current.startLinear)
		return false;
	if (candidate.surah < currentStartSurah(current, paragraph))
		return false;
	if (candidate.surah > currentStartSurah(current, paragraph) + 1)
		return false;
	return true;
}

function currentStartSurah(current) {
	const marker = /^(\d+):(\d+)$/.exec(current.startAyahRef || '');
	return marker ? Number(marker[1]) : 0;
}

function buildVersePrefixMap(verseRows, maxPrefixWords, minPrefixWords) {
	const map = new Map();
	for (const verse of verseRows) {
		const words = verse.text.split(' ').filter(Boolean);
		const limit = Math.min(maxPrefixWords, words.length);
		for (let count = limit; count >= minPrefixWords; count--) {
			const key = words.slice(0, count).join(' ');
			if (!key)
				continue;
			const list = map.get(key) || [];
			list.push({ surah: verse.surah, ayah: verse.ayah, linearIndex: verse.linearIndex });
			map.set(key, list);
		}
	}
	return map;
}

function resolveContentOpf(zip) {
	const container = zip.readAsText('META-INF/container.xml');
	const match = /full-path="([^"]+)"/.exec(container);
	if (!match)
		throw new Error('Cannot find content.opf path in container.xml');
	return match[1];
}

function spineOrderFromOpf(opfText, opfPath) {
	const manifest = {};
	for (const match of opfText.matchAll(/<item\b[^>]*id="([^"]+)"[^>]*href="([^"]+)"[^>]*media-type="application\/xhtml\+xml"[^>]*>/g))
		manifest[match[1]] = match[2];
	const order = [];
	for (const match of opfText.matchAll(/<itemref\b[^>]*idref="([^"]+)"[^>]*>/g)) {
		if (manifest[match[1]]) {
			const joined = path.posix.join(path.posix.dirname(opfPath), manifest[match[1]]);
			order.push(joined.replace(/\\/g, '/'));
		}
	}
	return order.filter(name => /text\/page_\d+_\d+\.xhtml$/.test(name) || /text\/page_\d+\.xhtml$/.test(name));
}

function isTocTextFile(text) {
	return /<body[\s\S]*?>/.test(text);
}

function isFooterParagraph(text) {
	return /الصفحة\s*[:：]/.test(text) || /الجزء\s*[:：]/.test(text);
}

function parseTocEntries(zip, contentPath, opfText, maxSurah) {
	const tocPath = extractTocPath(zip, opfText, contentPath);
	if (debugTocEnabled()) {
		console.log(`DEBUG TOC path=${tocPath || 'null'}`);
		console.log(`DEBUG TOC exists=${tocPath ? Boolean(zip.getEntry(tocPath)) : false}`);
	}
	if (tocPath && !zip.getEntry(tocPath))
		return [];
	if (!tocPath)
		return [];
	const ncxText = zip.readAsText(tocPath);
	if (debugTocEnabled())
		console.log(`DEBUG TOC bytes=${ncxText.length}`);
	const $ = cheerio.load(ncxText, { xmlMode: true });
	const entries = [];
	const byLabelState = {
		activeSurah: null,
		surahByName: new Map(),
		surahCount: 0
	};

	const walk = function ($node, context, depth) {
		$node.each((_, el) => {
			const $el = $(el);
			const label = normalizeSpace($el.children('navLabel').children('text').first().text());
			const childPoints = $el.children('navPoint');
			const isAyahLabel = label && isNumericArabic(label);
			const nextContext = Object.assign({}, context);
			if (debugTocEnabled() && depth <= 2)
				console.log(`DEBUG TOC node depth=${depth} label=${label || '(empty)'} isAyah=${Boolean(isAyahLabel)} active=${context.activeSurah} children=${childPoints.length}`);

			if (depth === 1 && !isAyahLabel && label && childPoints.length > 0) {
				if (!context.surahByName.has(label)) {
					context.surahCount += 1;
					context.surahByName.set(label, context.surahCount);
				}
				nextContext.activeSurah = context.surahByName.get(label);
			}

			if (isAyahLabel && context.activeSurah && context.activeSurah <= maxSurah) {
				const content = $el.children('content').first().attr('src');
				const { file, id } = splitHref(content);
				const href = resolveTocHref(file, contentPath);
				const ayahNumber = arabicToEnglish(label);
				if (Number.isInteger(ayahNumber) && Number.isInteger(context.activeSurah)) {
					entries.push({
						anchorId: id,
						surah: context.activeSurah,
						ayah: ayahNumber,
						ref: `${context.activeSurah}:${ayahNumber}`,
						src: href,
						label
					});
				}
			}

			if (childPoints.length > 0)
				walk(childPoints, nextContext, depth + 1);
		});
	};
	walk($('navMap').children('navPoint'), byLabelState, 1);
	return entries;
}

function debugTocEnabled() {
	return process.env.DEBUG_TAFSIR_EPUB_TOC === '1' || process.env.DEBUG_RIDA_TOC === '1';
}

function extractTocPath(zip, opfText, opfPath) {
	const manifestFallback = resolveRelativePath(opfPath, 'toc.ncx');
	if (zip.getEntry(manifestFallback))
		return manifestFallback;
	const ncxMatch = /<item\b[^>]*media-type="application\/x-dtbncx\+xml"[^>]*>/i.exec(opfText);
	if (ncxMatch) {
		const hrefMatch = /href="([^"]+)"/i.exec(ncxMatch[0]);
		if (hrefMatch)
			return resolveRelativePath(opfPath, hrefMatch[1]);
	}
	const fallbackMatch = /<item\b[^>]*id="ncx"[^>]*>/i.exec(opfText);
	if (!fallbackMatch)
		return null;
	return resolveRelativePath(opfPath, 'toc.ncx');
}

function splitHref(href) {
	if (!href)
		return { file: '', id: '' };
	const [file, id] = href.split('#');
	return { file, id };
}

function resolveTocHref(filePath, opfPath) {
	if (!filePath)
		return '';
	return resolveRelativePath(opfPath, filePath);
}

function resolveRelativePath(basePath, href) {
	return path.posix.join(path.posix.dirname(basePath), href).replace(/\\/g, '/');
}

function isNumericArabic(value) {
	if (!value)
		return false;
	const normalized = value.replace(/[\u0660-\u0669]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).trim();
	return /^[0-9]+$/.test(normalized) && normalized.length > 0;
}

function arabicToEnglish(value) {
	if (!value)
		return NaN;
	return Number(toEnglishDigits(value));
}

function isTocHeader(text) {
	if (/^\d+$/.test(text))
		return true;
	if (/^\[.*\]$/.test(text))
		return true;
	if (text.length < 2)
		return true;
	return false;
}

function extractPrintedPageNumber(text) {
	const match = /الصفحة\s*[:：]\s*([\u0660-\u0669]+|\d+)/.exec(text);
	if (!match)
		return null;
	const number = Number(toEnglishDigits(match[1]));
	return Number.isFinite(number) ? number : null;
}

function extractPageFromFilename(filename) {
	const match = /_([0-9]+)\.xhtml$/i.exec(path.posix.basename(filename));
	if (!match)
		return null;
	const value = Number(match[1]);
	return Number.isFinite(value) ? value : null;
}

function normalizeVerseText(text) {
	return normalizeArabic(text)
		.split(' ')
		.filter(Boolean)
		.join(' ');
}

function normalizeArabic(value) {
	return normalizeSpace((value || '')
		.replace(/[\u0610-\u061A\u064B-\u065F\u0670]/g, '')
		.replace(/[\u0600-\u0605\u061B-\u061F\u0660-\u0669]/g, '')
		.replace(/[\u0000-\u002f\u003A-\u0040\u005B-\u0060\u007B-\u007E]/g, ' '));
}

function normalizeSpace(value) {
	return (value || '').replace(/\s+/g, ' ').trim();
}

function toEnglishDigits(value) {
	return String(value)
		.replace(/[\u0660-\u0669]/g, char => String('٠١٢٣٤٥٦٧٨٩'.indexOf(char)))
		.trim();
}

function normalizeParagraph(value) {
	return (value || '')
		.replace(/\r\n?/g, ' ')
		.replace(/\u00a0/g, ' ')
		.replace(/[\t ]+/g, ' ')
		.trim();
}

function toMarkdown(value) {
	if (!value)
		return '';
	const paragraphs = String(value)
		.split(/\n{2,}/)
		.map(paragraph => normalizeParagraph(paragraph))
		.filter(Boolean);
	return paragraphs
		.map(paragraph => paragraph.replace(/([`*_#>~])/g, '\\$1'))
		.join('\n\n');
}

function parseRef(value) {
	const match = /^([0-9]+):([0-9]+)$/.exec(String(value));
	if (!match)
		throw new Error(`Invalid Quran reference '${value}'.`);
	return { surah: Number(match[1]), ayah: Number(match[2]) };
}

function isQuranRef(value) {
	return /^[0-9]+:[1-9][0-9]*$/.test(String(value || ''));
}

function makeDbConnection() {
	const configured = appMysqlConnection();
	return mysql.createConnection({
		host: process.env.MYSQL_HOST || configured.host || '127.0.0.1',
		port: Number(process.env.MYSQL_PORT || configured.port || 3306),
		user: process.env.MYSQL_USER || configured.user || process.env.USER,
		password: process.env.MYSQL_PASSWORD || configured.password || '',
		database: process.env.MYSQL_DATABASE || configured.database || 'hadithdb'
	});
}

function appMysqlConnection() {
	try {
		const settings = require(path.join(os.homedir(), '.hadithdb', 'settings.json'));
		return settings.mysql && settings.mysql.connection ? settings.mysql.connection : {};
	} catch (err) {
		return {};
	}
}

function getConnection(db) {
	return new Promise((resolve, reject) => {
		db.connect(err => err ? reject(err) : resolve(db));
	});
}

function query(connection, sql) {
	if (process.env.DEBUG_IMPORT_SQL === '1')
		console.log(`DEBUG_SQL: ${sql.trim().replace(/\n/g, ' ')}`);
	return new Promise((resolve, reject) => {
		connection.query({ sql, timeout: 120000 }, (err, result) => err ? reject(err) : resolve(result));
	});
}

async function upsertCommentary(connection, alias, config) {
	const idColumn = await query(connection, `SHOW COLUMNS FROM books LIKE 'id'`);
	const idColumnHasAutoIncrement = idColumn[0] && /auto_increment/i.test(idColumn[0].Extra || '');
	const existing = await query(connection, `
		SELECT id
		FROM books
		WHERE alias=${mysql.escape(alias)}
			AND source='local'
			AND type='tafsir'
		LIMIT 1`);
	if (existing.length === 1)
		return existing[0].id;
	const bookId = Number(config.id || config.ordinal);
	if (!Number.isInteger(bookId) || bookId <= 0)
		throw new Error(`Invalid book id/config ordinal '${config.id || config.ordinal}'.`);
	const insertCols = idColumnHasAutoIncrement
		? '(ordinal, alias, type, shortName_en, shortName, hidden, source, lang, format, name_en, author_en, title, author, death, description)'
		: '(id, ordinal, alias, type, shortName_en, shortName, hidden, source, lang, format, name_en, author_en, title, author, death, description)';
	const insertVals = idColumnHasAutoIncrement
		? `(${Number(config.ordinal)}, ${mysql.escape(alias)}, 'tafsir', ${mysql.escape(config.shortName_en)}, ${mysql.escape(config.shortName)},
			0, 'local', ${mysql.escape(config.lang)}, ${mysql.escape(config.format)},
			${mysql.escape(config.name_en)}, ${mysql.escape(config.author_en)},
			${mysql.escape(config.name)}, ${mysql.escape(config.author)}, NULL,
			${mysql.escape(config.description)})`
		: `(${bookId}, ${Number(config.ordinal)}, ${mysql.escape(alias)}, 'tafsir', ${mysql.escape(config.shortName_en)}, ${mysql.escape(config.shortName)},
			0, 'local', ${mysql.escape(config.lang)}, ${mysql.escape(config.format)},
			${mysql.escape(config.name_en)}, ${mysql.escape(config.author_en)},
			${mysql.escape(config.name)}, ${mysql.escape(config.author)}, NULL,
			${mysql.escape(config.description)})`;
	await query(connection, `
		INSERT INTO books
			${insertCols}
		VALUES
			${insertVals}`);

	const rows = await query(connection, `
		SELECT id
		FROM books
		WHERE alias=${mysql.escape(alias)}
			AND source='local'
			AND type='tafsir'
		LIMIT 1`);
	if (rows.length !== 1)
		throw new Error(`Unable to upsert commentary '${alias}'.`);
	return rows[0].id;
}

function readOptions(argv) {
	const options = {
		epub: null,
		preset: null,
		configPath: null,
		alias: null,
		dryRun: false,
		startPage: null,
		maxSurah: null,
		minTocMatchRatio: null,
		maxPrefixWords: DEFAULT_MAX_PREFIX_WORDS,
		minPrefixWords: DEFAULT_MIN_PREFIX_WORDS,
		overwrite: false,
		batchSize: 100,
		buildIndex: true
	};

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--epub')
			options.epub = requiredValue(argv, ++i, arg);
		else if (arg === '--preset')
			options.preset = requiredValue(argv, ++i, arg);
		else if (arg === '--config')
			options.configPath = requiredValue(argv, ++i, arg);
		else if (arg === '--alias')
			options.alias = requiredValue(argv, ++i, arg);
		else if (arg === '--start-page')
			options.startPage = Number(requiredValue(argv, ++i, arg));
		else if (arg === '--max-surah')
			options.maxSurah = Number(requiredValue(argv, ++i, arg));
		else if (arg === '--min-toc-match-ratio')
			options.minTocMatchRatio = Number(requiredValue(argv, ++i, arg));
		else if (arg === '--max-prefix-words')
			options.maxPrefixWords = Number(requiredValue(argv, ++i, arg));
		else if (arg === '--min-prefix-words')
			options.minPrefixWords = Number(requiredValue(argv, ++i, arg));
		else if (arg === '--batch-size')
			options.batchSize = Number(requiredValue(argv, ++i, arg));
		else if (arg === '--overwrite')
			options.overwrite = true;
		else if (arg === '--no-index')
			options.buildIndex = false;
		else if (arg === '--dry-run')
			options.dryRun = true;
		else if (arg === '--help' || arg === '-h') {
			console.log(usage());
			process.exit(0);
		} else {
			throw new Error(`Unknown option '${arg}'.\n\n${usage()}`);
		}
	}

	if (!options.epub)
		throw new Error('EPUB path is required (--epub).');
	if (Boolean(options.preset) === Boolean(options.configPath))
		throw new Error('Specify exactly one book configuration source: --preset or --config.');
	options.bookConfig = loadBookConfig(options);
	options.alias = options.alias || options.bookConfig.alias;
	const parserConfig = options.bookConfig.parser || {};
	options.startPage = options.startPage === null ? Number(parserConfig.startPage || 1) : options.startPage;
	options.maxSurah = options.maxSurah === null ? Number(parserConfig.maxSurah || 114) : options.maxSurah;
	options.minTocMatchRatio = options.minTocMatchRatio === null
		? Number(parserConfig.minTocMatchRatio || DEFAULT_MIN_TOC_MATCH_RATIO)
		: options.minTocMatchRatio;
	if (!/^[A-Za-z0-9_-]+$/.test(options.alias))
		throw new Error(`Invalid tafsir alias '${options.alias}'.`);
	if (!Number.isInteger(options.startPage) || options.startPage < 1)
		throw new Error('--start-page must be an integer >= 1.');
	if (!Number.isInteger(options.maxSurah) || options.maxSurah < 1 || options.maxSurah > 114)
		throw new Error('--max-surah must be an integer from 1 to 114.');
	if (!Number.isFinite(options.minTocMatchRatio) || options.minTocMatchRatio <= 0 || options.minTocMatchRatio > 1)
		throw new Error('--min-toc-match-ratio must be greater than 0 and at most 1.');
	if (!Number.isInteger(options.maxPrefixWords) || options.maxPrefixWords < options.minPrefixWords)
		throw new Error('--max-prefix-words must be >= --min-prefix-words.');
	if (!Number.isInteger(options.minPrefixWords) || options.minPrefixWords < 2)
		throw new Error('--min-prefix-words must be >= 2.');
	if (!fs.existsSync(options.epub))
		throw new Error(`EPUB file does not exist: ${options.epub}`);
	return options;
}

function loadBookConfig(options) {
	let config;
	if (options.preset) {
		const presets = readJsonFile(PRESETS_FILE);
		config = presets[options.preset];
		if (!config)
			throw new Error(`Unknown tafsir EPUB preset '${options.preset}'.`);
	} else {
		config = readJsonFile(path.resolve(options.configPath));
	}
	const normalized = Object.assign({
		id: null,
		shortName_en: config.name_en,
		shortName: config.name || null,
		author_en: 'Unknown',
		author: null,
		description: '',
		lang: 'ar',
		format: 'md',
		parser: {}
	}, config);
	const bookId = Number(normalized.id || normalized.ordinal);
	if (!/^[A-Za-z0-9_-]+$/.test(normalized.alias || ''))
		throw new Error('Book config requires a valid alias.');
	if (!Number.isInteger(bookId) || bookId < 1)
		throw new Error('Book config requires a positive integer id or ordinal.');
	if (!normalized.name_en)
		throw new Error('Book config requires name_en.');
	return normalized;
}

function readJsonFile(filename) {
	if (!fs.existsSync(filename))
		throw new Error(`JSON config file does not exist: ${filename}`);
	try {
		return JSON.parse(fs.readFileSync(filename, 'utf8'));
	} catch (err) {
		throw new Error(`Unable to read JSON config '${filename}': ${err.message}`);
	}
}

function requiredValue(argv, index, option) {
	if (!argv[index])
		throw new Error(`${option} requires a value.`);
	return argv[index];
}

function usage() {
	return [
		'Usage: node bin/utils/import-tafsir-epub.js --epub <path> (--preset <name> | --config <path>) [options]',
		'',
		'Options:',
		'  --epub <path>           Path to a verse-TOC tafsir EPUB',
		'  --preset <name>         Book metadata/parser preset from tafsir-epub-presets.json',
		'  --config <path>         External JSON book metadata/parser configuration',
		'  --alias <alias>         Override the configured commentary alias',
		'  --start-page <n>        Override the first EPUB page to parse',
		'  --max-surah <n>         Override the highest surah to import',
		'  --min-toc-match-ratio   Required TOC match ratio from 0 to 1 (default: 0.9)',
		'  --max-prefix-words <n>  Max prefix words for fallback boundary matching (default: 8)',
		'  --min-prefix-words <n>  Min prefix words for fallback boundary matching (default: 4)',
		'  --batch-size <n>        DB batch size',
		'  --overwrite             Delete existing rows for alias before inserting',
		'  --no-index              Skip buildCommentariesIndex',
		'  --dry-run               Parse only, no DB writes',
		'  --help                  Show this help'
	].join('\n');
}

module.exports = {
	run,
	parseEpub,
	parseTocEntries,
	validateParsedPassages
};
