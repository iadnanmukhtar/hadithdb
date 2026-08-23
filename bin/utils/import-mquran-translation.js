#!/usr/bin/env node
/* jslint node:true, esversion:9 */
'use strict';

require('dotenv').config();

const axios = require('axios');
const cheerio = require('cheerio');
const { execFileSync } = require('child_process');
const fs = require('fs');
const mysql = require('mysql');
const os = require('os');
const path = require('path');

const EXPECTED_AYAHS = 6236;
const EXPECTED_SURAHS = 114;
const DEFAULT_BATCH_SIZE = 200;
const DEFAULT_CONCURRENCY = 8;
const DETAIL_CACHE_SAVE_EVERY = 50;
const DEFAULT_ISTIADHA = 'I seek refuge in God from Satan, the accursed.';
const SOURCE_URL_PATTERN = /^(https?:\/\/[^/]+)\/content\/category\/(\d+)\/(\d+)\/(\d+)(?:\/\d+\/\d+)?\/?$/;
const SOURCE_REF_CORRECTIONS = Object.freeze({
	809: Object.freeze({ surah: 6, ayah: 20 }),
	3095: Object.freeze({ surah: 26, ayah: 163 })
});
const SOURCE_SUPPLEMENTAL_PAGES = Object.freeze([
	Object.freeze({ surah: 55, ayah: 49, contentId: 4950 }),
	Object.freeze({ surah: 64, ayah: 2, contentId: 5201 })
]);
const SOURCE_SUPPLEMENTAL_REFS = new Set(SOURCE_SUPPLEMENTAL_PAGES.map(row => `${row.surah}:${row.ayah}`));
const SOURCE_FOOTNOTE_DEFINITION_CORRECTIONS = Object.freeze({
	'2:190': Object.freeze({ '*': '137' })
});
const SOURCE_FOOTNOTE_REFERENCE_CORRECTIONS = Object.freeze({
	'2:191': Object.freeze({ '137': '138' }),
	'22:31': Object.freeze({ '10': '11' }),
	'22:36': Object.freeze({ '11': '12' })
});

async function run(argv = process.argv.slice(2)) {
	const options = readOptions(argv);
	if (!options)
		return null;
	const cacheFile = options.cacheFile || path.resolve(process.cwd(), 'data/cache/mquran', `${options.alias}.json`);
	const translations = await loadSource(options, cacheFile);
	const db = await connectDb();
	let result;
	try {
		result = await importTranslation(db, options, translations);
	} finally {
		await closeDb(db);
	}

	if (!options.dryRun && options.buildIndex && result.changed) {
		console.log(`Rebuilding the commentary index for '${options.alias}'...`);
		execFileSync(process.execPath, [
			path.resolve(__dirname, '../buildCommentariesIndex.js'),
			'--tafsir', options.alias
		], {
			stdio: 'inherit',
			env: process.env
		});
	}
	return result;
}

async function loadSource(options, cacheFile) {
	if (!options.refresh && fs.existsSync(cacheFile)) {
		const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
		if (hasDetailedEntries(cached)) {
			validateSource(cached);
			console.log(`Using cached mquran.org source: ${displayPath(cacheFile)}`);
			return cached;
		}
		console.log(`Refreshing legacy mquran.org cache without detail-page footnotes: ${displayPath(cacheFile)}`);
	}

	const translations = await downloadSource(options, cacheFile);
	validateSource(translations);
	fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
	fs.writeFileSync(cacheFile, `${JSON.stringify(translations, null, 2)}\n`);
	const partialFile = partialCacheFile(cacheFile);
	if (fs.existsSync(partialFile))
		fs.unlinkSync(partialFile);
	console.log(`Cached ${EXPECTED_AYAHS} translations at ${displayPath(cacheFile)}.`);
	return translations;
}

async function downloadSource(options, cacheFile) {
	const listings = {};
	let nextSurah = 1;
	let completed = 0;
	const workerCount = Math.min(options.concurrency, EXPECTED_SURAHS);
	const workers = [];
	console.log(`Downloading ${EXPECTED_SURAHS} mquran.org chapter page(s) with concurrency ${workerCount}...`);
	for (let worker = 0; worker < workerCount; worker++) {
		workers.push((async () => {
			while (nextSurah <= EXPECTED_SURAHS) {
				const surah = nextSurah++;
				const url = chapterPageUrl(options.url, surah);
				const html = await fetchPage(url, options);
				const chapter = parseChapterPage(html, surah);
				for (const row of chapter)
					listings[`${row.surah}:${row.ayah}`] = { t: row.text, f: '', sourceId: row.contentId };
				completed++;
				if (completed % 10 === 0 || completed === EXPECTED_SURAHS)
					console.log(`Downloaded ${completed}/${EXPECTED_SURAHS} chapter page(s)...`);
				if (options.delay)
					await sleep(options.delay);
			}
		})());
	}
	await Promise.all(workers);
	for (const supplemental of SOURCE_SUPPLEMENTAL_PAGES) {
		listings[`${supplemental.surah}:${supplemental.ayah}`] = { t: '', f: '', sourceId: supplemental.contentId };
		console.warn(`Recovering mquran.org ${supplemental.surah}:${supplemental.ayah} from omitted content page ${supplemental.contentId}.`);
	}
	if (Object.keys(listings).length !== EXPECTED_AYAHS)
		throw new Error(`Expected ${EXPECTED_AYAHS} mquran.org listing rows, found ${Object.keys(listings).length}.`);
	return downloadDetails(options, sortTranslations(listings), cacheFile);
}

async function downloadDetails(options, listings, cacheFile) {
	const partialFile = partialCacheFile(cacheFile);
	const detailed = {};
	const resumeFiles = options.refresh ? [partialFile] : [cacheFile, partialFile];
	for (const resumeFile of resumeFiles) {
		if (fs.existsSync(resumeFile))
			Object.assign(detailed, readPartialDetails(resumeFile, listings));
	}
	const missing = Object.keys(listings).filter(ref => !isDetailedEntry(detailed[ref]));
	let next = 0;
	let completed = 0;
	let savedAt = 0;
	const workerCount = Math.min(options.concurrency, missing.length);
	console.log(`Downloading ${missing.length} mquran.org ayah detail page(s) with concurrency ${workerCount}...`);
	const workers = [];
	for (let worker = 0; worker < workerCount; worker++) {
		workers.push((async () => {
			while (next < missing.length) {
				const ref = missing[next++];
				const [surah, ayah] = ref.split(':').map(Number);
				const sourceId = listings[ref].sourceId;
				const url = printPageUrl(options.url, sourceId);
				const parsed = await fetchDetailPage(url, surah, ayah, sourceId, options);
				detailed[ref] = { ...parsed, sourceId };
				completed++;
				if (completed - savedAt >= DETAIL_CACHE_SAVE_EVERY || completed === missing.length) {
					writeJson(partialFile, sortTranslations(detailed));
					savedAt = completed;
				}
				if (completed % 100 === 0 || completed === missing.length)
					console.log(`Downloaded ${completed}/${missing.length} ayah detail page(s)...`);
				if (options.delay)
					await sleep(options.delay);
			}
		})());
	}
	const results = await Promise.allSettled(workers);
	writeJson(partialFile, sortTranslations(detailed));
	const failure = results.find(result => result.status === 'rejected');
	if (failure)
		throw failure.reason;
	return sortTranslations(detailed);
}

function partialCacheFile(cacheFile) {
	return cacheFile.replace(/\.json$/i, '.partial.json');
}

function readPartialDetails(filename, listings) {
	if (!fs.existsSync(filename))
		return {};
	const document = JSON.parse(fs.readFileSync(filename, 'utf8'));
	const retained = {};
	for (const [ref, value] of Object.entries(document || {})) {
		if (isDetailedEntry(value) && Number(value.sourceId) === Number(listings[ref]?.sourceId))
			retained[ref] = value;
	}
	console.log(`Resuming ${Object.keys(retained).length} cached ayah detail page(s) from ${displayPath(filename)}.`);
	return retained;
}

function writeJson(filename, document) {
	fs.mkdirSync(path.dirname(filename), { recursive: true });
	fs.writeFileSync(filename, `${JSON.stringify(document, null, 2)}\n`);
}

async function fetchDetailPage(url, surah, ayah, sourceId, options) {
	let lastError;
	for (let attempt = 1; attempt <= options.retries + 1; attempt++) {
		try {
			const html = await fetchPage(url, { ...options, retries: 0 });
			return parseDetailPage(html, surah, ayah, sourceId);
		} catch (err) {
			lastError = err;
			if (attempt <= options.retries)
				await sleep(options.retryDelay);
		}
	}
	throw new Error(`Unable to parse mquran.org ${surah}:${ayah} content page ${sourceId}: ${lastError.message}`);
}

async function fetchPage(url, options) {
	let lastError;
	for (let attempt = 1; attempt <= options.retries + 1; attempt++) {
		try {
			const response = await axios.get(url, {
				timeout: options.timeout,
				headers: { 'User-Agent': 'HadithDB Quran translation importer/1.0' },
				responseType: 'text'
			});
			return response.data;
		} catch (err) {
			lastError = err;
			if (attempt <= options.retries)
				await sleep(options.retryDelay);
		}
	}
	throw new Error(`Unable to fetch ${url}: ${describeAxiosError(lastError)}`);
}

function chapterPageUrl(sourceUrl, surah) {
	const match = SOURCE_URL_PATTERN.exec(sourceUrl);
	if (!match)
		throw new Error(`Unsupported mquran.org category URL '${sourceUrl}'.`);
	return `${match[1]}/content/category/${match[2]}/${Number(surah)}/${match[4]}/500/0/`;
}

function contentPageUrl(sourceUrl, contentId) {
	const match = SOURCE_URL_PATTERN.exec(sourceUrl);
	if (!match)
		throw new Error(`Unsupported mquran.org category URL '${sourceUrl}'.`);
	return `${match[1]}/content/view/${Number(contentId)}/${match[4]}/`;
}

function printPageUrl(sourceUrl, contentId) {
	const match = SOURCE_URL_PATTERN.exec(sourceUrl);
	if (!match)
		throw new Error(`Unsupported mquran.org category URL '${sourceUrl}'.`);
	return `${match[1]}/index2.php?option=com_content&task=view&id=${Number(contentId)}&pop=1&page=0&Itemid=${match[4]}`;
}

function parseChapterPage(html, expectedSurah) {
	const $ = cheerio.load(html);
	const rows = [];
	$('#component tr.sectiontableentry1, #component tr.sectiontableentry2').each(function () {
		const link = $(this).find('a[href*="/content/view/"]').first();
		if (!link.length)
			return;
		const value = normalizeText($(this).text());
		const match = /^(\d+)\.(\d+)\.\s+([\s\S]+)$/.exec(value);
		if (!match)
			return;
		const contentIdMatch = /\/content\/view\/(\d+)\//.exec(link.attr('href') || '');
		const correction = contentIdMatch ? SOURCE_REF_CORRECTIONS[Number(contentIdMatch[1])] : null;
		const surah = correction ? correction.surah : Number(match[1]);
		const ayah = correction ? correction.ayah : Number(match[2]);
		if (surah !== Number(expectedSurah))
			return;
		if (correction)
			console.warn(`Corrected mquran.org content page ${contentIdMatch[1]} from ${match[1]}:${match[2]} to ${surah}:${ayah}.`);
		if (!contentIdMatch)
			throw new Error(`mquran.org chapter ${expectedSurah} ayah ${ayah} had no content-page id.`);
		rows.push({ surah, ayah, text: match[3].trim(), contentId: Number(contentIdMatch[1]) });
	});
	if (!rows.length)
		throw new Error(`mquran.org chapter ${expectedSurah} contained no translation rows.`);
	const seen = new Set();
	for (const row of rows) {
		if (seen.has(row.ayah))
			throw new Error(`mquran.org chapter ${expectedSurah} repeated ayah ${row.ayah}.`);
		if (!row.text)
			throw new Error(`mquran.org chapter ${expectedSurah} ayah ${row.ayah} had no translation text.`);
		seen.add(row.ayah);
	}
	rows.sort((a, b) => a.ayah - b.ayah);
	let expectedAyah = 1;
	for (const row of rows) {
		while (SOURCE_SUPPLEMENTAL_REFS.has(`${expectedSurah}:${expectedAyah}`) && row.ayah > expectedAyah)
			expectedAyah++;
		if (row.ayah !== expectedAyah)
			throw new Error(`mquran.org chapter ${expectedSurah} is missing ayah ${expectedAyah}.`);
		expectedAyah++;
	}
	return rows;
}

function parseDetailPage(html, expectedSurah, expectedAyah, contentId) {
	const $ = cheerio.load(html);
	const value = normalizeText($('.contentheading').first().text());
	const match = /^(\d+)\.\s*(\d+)\.?\s+([\s\S]+)$/.exec(value);
	if (!match)
		throw new Error(`mquran.org content page did not contain a translation heading.`);
	const correction = SOURCE_REF_CORRECTIONS[Number(contentId)];
	const foundSurah = correction ? correction.surah : Number(match[1]);
	const foundAyah = correction ? correction.ayah : Number(match[2]);
	if (foundSurah !== Number(expectedSurah) || foundAyah !== Number(expectedAyah))
		throw new Error(`Expected mquran.org ${expectedSurah}:${expectedAyah}, found ${foundSurah}:${foundAyah}.`);
	const contentCell = $('table.contentpaneopen').eq(1).find('td[valign="top"]').first();
	if (!contentCell.length)
		throw new Error(`mquran.org ${expectedSurah}:${expectedAyah} had no content cell.`);
	const translationParagraph = contentCell.children().filter(function () {
		// A handful of source pages contain the literal malformed tag `<p<b>`.
		// Cheerio preserves it as a `p<b` element, so accept paragraph-like tags
		// while still excluding the preceding Arabic paragraph.
		const tagName = String(this.tagName || this.name || '').toLowerCase();
		return tagName.startsWith('p') && !$(this).attr('align') &&
			!$(this).find('font[face*="Arabic"]').length;
	}).first();
	if (!translationParagraph.length)
		throw new Error(`mquran.org ${expectedSurah}:${expectedAyah} had no translation paragraph.`);
	const ref = `${expectedSurah}:${expectedAyah}`;
	let text = inlineMarkdown($, translationParagraph, true).replace(/^\d+\s*\.?\s+/, '').trim();
	if (!text)
		throw new Error(`mquran.org ${expectedSurah}:${expectedAyah} had no translation text.`);
	text = correctFootnoteReferences(text, ref);
	const footnotes = parseFootnotes($, contentCell, ref, translationParagraph);
	text = appendOmittedFootnoteReferences(text, footnotes, ref);
	validateFootnotes(text, footnotes, ref);
	return { t: text, f: footnotes };
}

function correctFootnoteReferences(text, ref) {
	const corrections = SOURCE_FOOTNOTE_REFERENCE_CORRECTIONS[ref];
	if (!corrections)
		return text;
	let corrected = text;
	for (const [from, to] of Object.entries(corrections)) {
		if (corrected.includes(`[^${from}]`)) {
			console.warn(`mquran.org ${ref} mislabeled inline marker ${from}; correcting it to ${to}.`);
			corrected = corrected.replaceAll(`[^${from}]`, `[^${to}]`);
		}
	}
	return corrected;
}

function appendOmittedFootnoteReferences(text, footnotes, ref) {
	const references = new Set(Array.from(text.matchAll(/\[\^(\d+)\]/g), match => match[1]));
	const definitions = new Set(Array.from(footnotes.matchAll(/^\[\^(\d+)\]:/gm), match => match[1]));
	const omitted = Array.from(definitions).filter(label => !references.has(label));
	if (!omitted.length)
		return text;
	console.warn(`mquran.org ${ref} omitted inline marker(s) ${omitted.join(', ')}; appending them to the linked ayah.`);
	return `${text}${omitted.map(label => `[^${label}]`).join('')}`;
}

function inlineMarkdown($, element, footnoteReferences) {
	const clone = $(element).clone();
	clone.find('br').replaceWith('\n');
	clone.find('sup').each(function () {
		const label = normalizeText($(this).text()).replace(/\.$/, '');
		$(this).replaceWith(footnoteReferences && /^\d+$/.test(label) ? `[^${label}]` : label);
	});
	clone.find('i, em').each(function () {
		const original = $(this).text();
		const value = normalizeText(original);
		if (!value)
			$(this).replaceWith(' ');
		else
			$(this).replaceWith(`${/^\s/.test(original) ? ' ' : ''}*${value}*${/\s$/.test(original) ? ' ' : ''}`);
	});
	clone.find('b, strong').each(function () {
		$(this).replaceWith($(this).contents());
	});
	return normalizeText(clone.text()).replace(/\s+([,.;:!?])/g, '$1');
}

function parseFootnotes($, contentCell, ref = '', translationParagraph = null) {
	const notes = [];
	let current = null;
	const blocks = [];
	contentCell.find('blockquote').each(function () {
		const paragraphs = $(this).children('p');
		if (paragraphs.length)
			paragraphs.each(function () { blocks.push(this); });
		else
			blocks.push(this);
	});
	contentCell.children('hr').each(function () {
		$(this).nextAll('p').each(function () {
			blocks.push(this);
		});
	});
	if (translationParagraph?.length) {
		translationParagraph.nextAll('p').each(function () {
			blocks.push(this);
		});
	}
	$(blocks).each(function () {
			let value = '';
			if (this.type === 'text')
				value = normalizeText(this.data);
			else if (this.type === 'tag')
				value = inlineMarkdown($, this, false);
			if (!value)
				return;
			const marker = /^(\*?)(\d+(?:\/\d+)*|\*)\s*(\*?)[.:]\s*([\s\S]*)$/.exec(value);
			if (marker) {
				const labelValue = SOURCE_FOOTNOTE_DEFINITION_CORRECTIONS[ref]?.[marker[2]] || marker[2];
				const labels = labelValue.split('/');
				if (!labels.every(label => /^\d+$/.test(label))) {
					current = null;
					return;
				}
				if (labelValue !== marker[2])
					console.warn(`mquran.org ${ref} labeled footnote ${labelValue} as '${marker[2]}'; applying the linked-page correction.`);
				current = { labels, paragraphs: [] };
				notes.push(current);
				const firstParagraph = `${marker[1]}${marker[3]}${marker[4]}`;
				if (firstParagraph)
					current.paragraphs.push(firstParagraph);
			} else if (current)
				current.paragraphs.push(value);
			// Some first-ayah pages begin with an unnumbered surah introduction.
			// It is not linked from the translation, so it is not a footnote definition.
	});
	const grouped = new Map();
	for (const note of notes) {
		if (!note.paragraphs.length)
			throw new Error(`Footnote ${note.labels.join('/')} had no content.`);
		for (const label of note.labels) {
			const paragraphs = grouped.get(label) || [];
			for (const paragraph of note.paragraphs) {
				if (!paragraphs.includes(paragraph))
					paragraphs.push(paragraph);
			}
			grouped.set(label, paragraphs);
		}
	}
	return Array.from(grouped, ([label, paragraphs]) =>
		`[^${label}]: ${paragraphs.join('\n\n    ')}`).join('\n');
}

function validateFootnotes(text, footnotes, ref) {
	const referenceLabels = Array.from(text.matchAll(/\[\^(\d+)\]/g), match => match[1]);
	const definitionLabels = Array.from(footnotes.matchAll(/^\[\^(\d+)\]:/gm), match => match[1]);
	if (new Set(referenceLabels).size !== referenceLabels.length)
		throw new Error(`mquran.org ${ref} repeats an inline footnote marker.`);
	if (new Set(definitionLabels).size !== definitionLabels.length)
		throw new Error(`mquran.org ${ref} repeats a footnote definition.`);
	const references = new Set(referenceLabels);
	const definitions = new Set(definitionLabels);
	for (const label of references) {
		if (!definitions.has(label))
			throw new Error(`mquran.org ${ref} references missing footnote ${label}.`);
	}
	for (const label of definitions) {
		if (!references.has(label))
			throw new Error(`mquran.org ${ref} defines unreferenced footnote ${label}.`);
	}
}

function normalizeText(value) {
	return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function validateSource(translations, quranRows) {
	if (!translations || Array.isArray(translations) || typeof translations !== 'object')
		throw new Error('The mquran.org source must be a Quran-ref-keyed JSON object.');
	const entries = Object.entries(translations);
	if (entries.length !== EXPECTED_AYAHS)
		throw new Error(`Expected ${EXPECTED_AYAHS} mquran.org translations, found ${entries.length}.`);
	const surahs = new Set();
	for (const [ref, value] of entries) {
		const match = /^(\d+):([1-9]\d*)$/.exec(ref);
		if (!match)
			throw new Error(`Invalid Quran ref '${ref}' in mquran.org source.`);
		if (!isDetailedEntry(value))
			throw new Error(`Incomplete mquran.org detail-page data for '${ref}'.`);
		if (!normalizeText(value.t))
			throw new Error(`Missing mquran.org translation text for '${ref}'.`);
		validateFootnotes(value.t, value.f, ref);
		surahs.add(Number(match[1]));
	}
	if (surahs.size !== EXPECTED_SURAHS)
		throw new Error(`Expected ${EXPECTED_SURAHS} mquran.org surahs, found ${surahs.size}.`);
	if (quranRows) {
		const quranRefs = new Set(quranRows.map(row => row.ref));
		for (const ref of Object.keys(translations)) {
			if (!quranRefs.has(ref))
				throw new Error(`mquran.org source contains unknown Quran ref '${ref}'.`);
		}
		for (const ref of quranRefs) {
			if (!Object.prototype.hasOwnProperty.call(translations, ref))
				throw new Error(`mquran.org source is missing Quran ref '${ref}'.`);
		}
	}
	return true;
}

function hasDetailedEntries(document) {
	return document && typeof document === 'object' && !Array.isArray(document) &&
		Object.keys(document).length === EXPECTED_AYAHS && Object.values(document).every(isDetailedEntry);
}

function isDetailedEntry(value) {
	return value && typeof value === 'object' && !Array.isArray(value) &&
		typeof value.t === 'string' && value.t.trim() && typeof value.f === 'string' &&
		Number.isInteger(Number(value.sourceId)) && Number(value.sourceId) > 0 &&
		hasValidFootnoteLabels(value.t, value.f);
}

function hasValidFootnoteLabels(text, footnotes) {
	const references = Array.from(text.matchAll(/\[\^(\d+)\]/g), match => match[1]);
	const definitions = Array.from(footnotes.matchAll(/^\[\^(\d+)\]:/gm), match => match[1]);
	const referenceSet = new Set(references);
	const definitionSet = new Set(definitions);
	return referenceSet.size === references.length && definitionSet.size === definitions.length &&
		referenceSet.size === definitionSet.size &&
		Array.from(referenceSet).every(label => definitionSet.has(label));
}

function sortTranslations(translations) {
	return Object.fromEntries(Object.entries(translations).sort((left, right) => {
		const [leftSurah, leftAyah] = left[0].split(':').map(Number);
		const [rightSurah, rightAyah] = right[0].split(':').map(Number);
		return leftSurah - rightSurah || leftAyah - rightAyah;
	}));
}

async function importTranslation(db, options, translations) {
	const quranRows = await loadQuranRows(db);
	validateSource(translations, quranRows);
	const existingBooks = await query(db, `SELECT * FROM books WHERE alias=${mysql.escape(options.alias)} LIMIT 2`);
	if (existingBooks.length > 1)
		throw new Error(`Expected at most one book with alias '${options.alias}', found ${existingBooks.length}.`);
	if (existingBooks[0] && (existingBooks[0].type !== 'trans' || existingBooks[0].source !== 'local'))
		throw new Error(`Alias '${options.alias}' belongs to a non-local translation book.`);
	const existingRows = existingBooks[0] ? await loadTranslationRows(db, existingBooks[0].id) : [];
	validateExistingRows(existingRows, quranRows, options.alias);
	const changes = countChanges(existingRows, quranRows, translations, options.istiadhah);
	const metadataChanged = !existingBooks[0] || bookMetadataChanged(existingBooks[0], options);

	console.log(`Validated ${EXPECTED_AYAHS} mquran.org translations across ${EXPECTED_SURAHS} surahs.`);
	console.log(`${options.dryRun ? 'Would apply' : 'Applying'} ${changes.inserts} insert(s) and ${changes.updates} update(s) for '${options.alias}'.`);
	if (options.dryRun)
		return { changed: metadataChanged || changes.inserts > 0 || changes.updates > 0, ...changes };

	let lockHeld = false;
	try {
		const lockRows = await query(db, `SELECT GET_LOCK('hadithdb:import-mquran-translation', 30) AS acquired`);
		if (Number(lockRows[0]?.acquired) !== 1)
			throw new Error('Could not acquire the mquran.org translation import lock.');
		lockHeld = true;
		await query(db, 'START TRANSACTION');
		try {
			const bookId = await upsertBook(db, options);
			await upsertTranslationRows(db, bookId, quranRows, translations, options);
			await verifyImportedRows(db, bookId, quranRows, translations, options);
			await query(db, `UPDATE books SET content_lastmod=CURRENT_TIMESTAMP() WHERE id=${Number(bookId)}`);
			await query(db, 'COMMIT');
			console.log(`Imported and verified ${EXPECTED_AYAHS + 1} '${options.alias}' row(s), including Quran 1:0.`);
		} catch (err) {
			await query(db, 'ROLLBACK');
			throw err;
		}
	} finally {
		if (lockHeld)
			await query(db, `SELECT RELEASE_LOCK('hadithdb:import-mquran-translation')`);
	}
	return { changed: metadataChanged || changes.inserts > 0 || changes.updates > 0, ...changes };
}

async function loadQuranRows(db) {
	const rows = await query(db, `
		SELECT id, num
		FROM hadiths
		WHERE bookId=0
			AND num REGEXP '^[0-9]+:[1-9][0-9]*$'
		ORDER BY CAST(SUBSTRING_INDEX(num, ':', 1) AS UNSIGNED),
			CAST(SUBSTRING_INDEX(num, ':', -1) AS UNSIGNED)`);
	if (rows.length !== EXPECTED_AYAHS)
		throw new Error(`Expected ${EXPECTED_AYAHS} local Quran ayahs, found ${rows.length}.`);
	return rows.map(row => {
		const [surah, ayah] = row.num.split(':').map(Number);
		return { id: Number(row.id), ref: row.num, surah, ayah };
	});
}

async function loadTranslationRows(db, bookId) {
	return query(db, `
		SELECT id, hadithId, surah, ayahFrom, ayahTo, text_en, footnotes_en
		FROM hadiths_commentary
		WHERE bookId=${Number(bookId)}
		ORDER BY surah, ayahFrom, ayahTo, id`);
}

function validateExistingRows(rows, quranRows, alias) {
	const validRefs = new Set(quranRows.map(row => row.ref));
	validRefs.add('1:0');
	for (const row of rows) {
		if (Number(row.ayahFrom) !== Number(row.ayahTo))
			throw new Error(`Existing '${alias}' row ${row.id} spans ${row.surah}:${row.ayahFrom}-${row.ayahTo}.`);
		const ref = `${Number(row.surah)}:${Number(row.ayahFrom)}`;
		if (!validRefs.has(ref))
			throw new Error(`Existing '${alias}' row ${row.id} has unexpected ref '${ref}'.`);
	}
}

function countChanges(existingRows, quranRows, translations, istiadha) {
	const existingByRef = new Map(existingRows.map(row => [`${Number(row.surah)}:${Number(row.ayahFrom)}`, row]));
	let inserts = 0;
	let updates = 0;
	const expected = [{ ref: '1:0', text: istiadha, footnotes: '' }].concat(quranRows.map(row => ({
		ref: row.ref,
		text: translations[row.ref].t,
		footnotes: translations[row.ref].f
	})));
	for (const row of expected) {
		const existing = existingByRef.get(row.ref);
		if (!existing)
			inserts++;
		else if (String(existing.text_en || '') !== row.text || String(existing.footnotes_en || '') !== row.footnotes)
			updates++;
	}
	return { inserts, updates };
}

function bookMetadataChanged(book, options) {
	const expected = bookMetadata(options, options.ordinal || Number(book.ordinal));
	return Object.entries(expected).some(([key, value]) => String(book[key] ?? '') !== String(value ?? ''));
}

function bookMetadata(options, ordinal) {
	return {
		ordinal: Number(ordinal),
		type: 'trans',
		shortName_en: options.shortName,
		shortName: options.shortName,
		hidden: 0,
		source: 'local',
		lang: 'en',
		format: 'md',
		name_en: options.name,
		author_en: options.author,
		publisher: options.publisher || null,
		published_year: options.publishedYear || null,
		description: options.description || null,
		aqidah: options.aqidah || null
	};
}

async function upsertBook(db, options) {
	const existing = await query(db, `SELECT id, ordinal, type, source FROM books WHERE alias=${mysql.escape(options.alias)} FOR UPDATE`);
	if (existing[0] && (existing[0].type !== 'trans' || existing[0].source !== 'local'))
		throw new Error(`Alias '${options.alias}' belongs to a non-local translation book.`);
	let bookId = existing[0]?.id;
	let ordinal = options.ordinal || Number(existing[0]?.ordinal);
	if (!ordinal) {
		const rows = await query(db, `SELECT COALESCE(MAX(ordinal), 0) + 1 AS ordinal FROM books WHERE type='trans' AND source='local' AND lang='en'`);
		ordinal = Number(rows[0].ordinal);
	}
	if (!bookId) {
		const rows = await query(db, 'SELECT COALESCE(MAX(id), 0) + 1 AS id FROM books FOR UPDATE');
		bookId = Number(rows[0].id);
	}
	const metadata = bookMetadata(options, ordinal);
	await query(db, `
		INSERT INTO books
			(id, ordinal, alias, type, shortName_en, shortName, hidden, source, lang, format,
			 name_en, author_en, publisher, published_year, description, aqidah)
		VALUES
			(${Number(bookId)}, ${metadata.ordinal}, ${mysql.escape(options.alias)}, 'trans',
			 ${mysql.escape(metadata.shortName_en)}, ${mysql.escape(metadata.shortName)}, 0, 'local', 'en', 'md',
			 ${mysql.escape(metadata.name_en)}, ${mysql.escape(metadata.author_en)}, ${mysql.escape(metadata.publisher)},
			 ${mysql.escape(metadata.published_year)}, ${mysql.escape(metadata.description)}, ${mysql.escape(metadata.aqidah)})
		ON DUPLICATE KEY UPDATE
			ordinal=VALUES(ordinal), type=VALUES(type), shortName_en=VALUES(shortName_en), shortName=VALUES(shortName),
			hidden=VALUES(hidden), source=VALUES(source), lang=VALUES(lang), format=VALUES(format),
			name_en=VALUES(name_en), author_en=VALUES(author_en), publisher=VALUES(publisher),
			published_year=VALUES(published_year), description=VALUES(description), aqidah=VALUES(aqidah)`);
	return bookId;
}

async function upsertTranslationRows(db, bookId, quranRows, translations, options) {
	const istiadhaRows = await query(db, `SELECT id FROM hadiths WHERE bookId=0 AND num='1:0' LIMIT 2`);
	if (istiadhaRows.length !== 1)
		throw new Error(`Expected one local Quran 1:0 row, found ${istiadhaRows.length}.`);
	const passages = [{ hadithId: Number(istiadhaRows[0].id), surah: 1, ayah: 0, text: options.istiadhah, footnotes: '' }]
		.concat(quranRows.map(row => ({
			hadithId: row.id,
			surah: row.surah,
			ayah: row.ayah,
			text: translations[row.ref].t,
			footnotes: translations[row.ref].f
		})));
	for (let offset = 0; offset < passages.length; offset += options.batchSize) {
		const values = passages.slice(offset, offset + options.batchSize).map(row => `(
			${Number(bookId)}, ${row.hadithId}, ${row.surah}, ${row.ayah}, ${row.ayah}, ${row.ayah},
			${mysql.escape(row.text)}, ${mysql.escape(row.footnotes || null)}
		)`).join(',\n');
		await query(db, `
			INSERT INTO hadiths_commentary
				(bookId, hadithId, surah, ayahFrom, ayahTo, passageNum, text_en, footnotes_en)
			VALUES ${values}
			ON DUPLICATE KEY UPDATE
				hadithId=VALUES(hadithId), passageNum=VALUES(passageNum),
				text_en=VALUES(text_en), footnotes_en=VALUES(footnotes_en)`);
	}
}

async function verifyImportedRows(db, bookId, quranRows, translations, options) {
	const rows = await loadTranslationRows(db, bookId);
	if (rows.length !== EXPECTED_AYAHS + 1)
		throw new Error(`Expected ${EXPECTED_AYAHS + 1} imported rows, found ${rows.length}.`);
	const byRef = new Map(rows.map(row => [`${Number(row.surah)}:${Number(row.ayahFrom)}`, row]));
	if (byRef.get('1:0')?.text_en !== options.istiadhah)
		throw new Error(`Imported '${options.alias}' Quran 1:0 text did not match.`);
	for (const quranRow of quranRows) {
		const imported = byRef.get(quranRow.ref);
		const source = translations[quranRow.ref];
		if (!imported || imported.text_en !== source.t || String(imported.footnotes_en || '') !== source.f)
			throw new Error(`Imported '${options.alias}' Quran ${quranRow.ref} did not match the source.`);
	}
}

function readOptions(argv) {
	const options = {
		alias: '', url: '', shortName: '', name: '', author: '', publisher: '', publishedYear: null,
		description: '', aqidah: 'Translation', ordinal: null, istiadhah: DEFAULT_ISTIADHA,
		cacheFile: '', refresh: false, dryRun: true, buildIndex: true,
		batchSize: DEFAULT_BATCH_SIZE, concurrency: DEFAULT_CONCURRENCY,
		timeout: 30000, retries: 3, retryDelay: 1000, delay: 100
	};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--alias') options.alias = requiredValue(argv, ++i, arg);
		else if (arg === '--url') options.url = requiredValue(argv, ++i, arg);
		else if (arg === '--short-name') options.shortName = requiredValue(argv, ++i, arg);
		else if (arg === '--name') options.name = requiredValue(argv, ++i, arg);
		else if (arg === '--author') options.author = requiredValue(argv, ++i, arg);
		else if (arg === '--publisher') options.publisher = requiredValue(argv, ++i, arg);
		else if (arg === '--published-year') options.publishedYear = positiveInteger(requiredValue(argv, ++i, arg), arg);
		else if (arg === '--description') options.description = requiredValue(argv, ++i, arg);
		else if (arg === '--aqidah') options.aqidah = requiredValue(argv, ++i, arg);
		else if (arg === '--ordinal') options.ordinal = positiveInteger(requiredValue(argv, ++i, arg), arg);
		else if (arg === '--istiadha') options.istiadhah = requiredValue(argv, ++i, arg);
		else if (arg === '--cache-file') options.cacheFile = path.resolve(process.cwd(), requiredValue(argv, ++i, arg));
		else if (arg === '--batch-size') options.batchSize = positiveInteger(requiredValue(argv, ++i, arg), arg);
		else if (arg === '--concurrency') options.concurrency = positiveInteger(requiredValue(argv, ++i, arg), arg);
		else if (arg === '--timeout') options.timeout = positiveInteger(requiredValue(argv, ++i, arg), arg);
		else if (arg === '--retries') options.retries = nonNegativeInteger(requiredValue(argv, ++i, arg), arg);
		else if (arg === '--retry-delay') options.retryDelay = nonNegativeInteger(requiredValue(argv, ++i, arg), arg);
		else if (arg === '--delay') options.delay = nonNegativeInteger(requiredValue(argv, ++i, arg), arg);
		else if (arg === '--refresh') options.refresh = true;
		else if (arg === '--apply') options.dryRun = false;
		else if (arg === '--dry-run') options.dryRun = true;
		else if (arg === '--no-index') options.buildIndex = false;
		else if (arg === '--help' || arg === '-h') {
			console.log(usage());
			return null;
		} else throw new Error(`Unknown option '${arg}'.\n\n${usage()}`);
	}
	if (!options)
		return options;
	if (!/^[A-Za-z0-9_-]+$/.test(options.alias))
		throw new Error(`--alias is required and must be URL-safe.\n\n${usage()}`);
	if (!SOURCE_URL_PATTERN.test(options.url))
		throw new Error(`--url must be an mquran.org-style category URL.\n\n${usage()}`);
	for (const [option, value] of [['--short-name', options.shortName], ['--name', options.name], ['--author', options.author]]) {
		if (!value)
			throw new Error(`${option} is required.\n\n${usage()}`);
	}
	return options;
}

function usage() {
	return [
		'Usage: node bin/utils/import-mquran-translation.js --alias <alias> --url <category-url> [metadata] [options]',
		'',
		'Downloads and validates all 6,236 ayah translations from an mquran.org chapter',
		'category and its linked detail pages, preserving annotation references and bodies',
		'as Markdown footnotes. The Quran-ref-keyed source is cached and imported transactionally.',
		'Default mode is a read-only dry run. --apply also rebuilds the targeted commentary index.',
		'',
		'Required metadata:',
		'  --short-name <name>       Short display name',
		'  --name <title>            Translation title',
		'  --author <author>         Translator or author',
		'',
		'Optional metadata:',
		'  --publisher <publisher>   Publisher',
		'  --published-year <year>   Publication year',
		'  --description <markdown>  Book description',
		'  --aqidah <label>          Metadata label (default: Translation)',
		'  --ordinal <number>        Display order; defaults to the next English translation',
		'  --istiadha <text>         Quran 1:0 text',
		'',
		'Import options:',
		'  --apply                   Import, verify, and rebuild the targeted index',
		'  --dry-run                 Validate and report only (default)',
		'  --no-index                Skip index rebuilding after --apply',
		'  --refresh                 Ignore a valid local source cache and download again',
		'  --cache-file <json>       Override data/cache/mquran/<alias>.json',
		'  --concurrency <number>    Concurrent source downloads (default: 8)',
		'  --delay <ms>              Delay after each chapter request (default: 100)',
		'  --help                    Show this help'
	].join('\n');
}

function requiredValue(argv, index, option) {
	if (!argv[index] || argv[index].startsWith('--'))
		throw new Error(`${option} requires a value.`);
	return argv[index];
}

function positiveInteger(value, option) {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1)
		throw new Error(`${option} must be a positive integer.`);
	return parsed;
}

function nonNegativeInteger(value, option) {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 0)
		throw new Error(`${option} must be a non-negative integer.`);
	return parsed;
}

function connectDb() {
	const settings = require(path.join(os.homedir(), '.hadithdb', 'settings.json'));
	const db = mysql.createConnection(settings.mysql.connection);
	return new Promise((resolve, reject) => db.connect(err => err ? reject(err) : resolve(db)));
}

function query(db, sql) {
	return new Promise((resolve, reject) => db.query({ sql, timeout: 600000 }, (err, result) => err ? reject(err) : resolve(result)));
}

function closeDb(db) {
	return new Promise((resolve, reject) => db.end(err => err ? reject(err) : resolve()));
}

function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function displayPath(filename) {
	const relative = path.relative(process.cwd(), filename);
	return relative && !relative.startsWith('..') ? relative : filename;
}

function describeAxiosError(err) {
	if (!err)
		return 'unknown HTTP error';
	if (err.response)
		return `HTTP ${err.response.status}`;
	return err.message;
}

if (require.main === module) {
	run().catch(err => {
		console.error(`ERROR: ${err.stack || err.message}`);
		process.exitCode = 1;
	});
}

module.exports = {
	chapterPageUrl,
	contentPageUrl,
	inlineMarkdown,
	normalizeText,
	parseChapterPage,
	parseDetailPage,
	parseFootnotes,
	printPageUrl,
	readOptions,
	sortTranslations,
	validateSource
};
