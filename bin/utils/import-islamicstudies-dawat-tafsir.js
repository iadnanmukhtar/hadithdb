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

const SOURCE_ROOT = 'https://islamicstudies.info/quran';
const CACHE_VERSION = 2;
const EXPECTED_SURAHS = 114;
const SOURCES = Object.freeze({
	dawat: Object.freeze({
		alias: 'dawat',
		label: 'Dawat',
		expectedPassages: 556,
		book: Object.freeze({
			alias: 'dawat',
			shortName_en: 'Dawat',
			name_en: 'Dawat ul Quran',
			author_en: 'Shams Pirzada',
			description: 'An English Quran translation and commentary by Shams Pirzada, translated into English by Abdul Karim Shaikh.',
			lang: 'en',
			format: 'md'
		})
	}),
	ishraq: Object.freeze({
		alias: 'ishraq',
		label: 'Ishraq',
		escapeMarkdownBackticks: true,
		expectedPassages: 556,
		book: Object.freeze({
			alias: 'ishraq',
			shortName_en: 'Ishraq',
			name_en: "Tafsir Ishraq al-Ma'ani",
			author_en: 'Syed Iqbal Zaheer',
			description: "*Tafsir Ishraq al-Ma'ani* is an English Quran translation and commentary by Syed Iqbal Zaheer.",
			lang: 'en',
			format: 'md'
		})
	})
});
const BOOK = SOURCES.dawat.book;

async function run(argv = process.argv.slice(2)) {
	const options = readOptions(argv);
	if (!options)
		return null;
	const passages = await loadSource(options);
	const db = await connectDb();
	let result;
	try {
		const quranVerseCounts = await loadQuranVerseCounts(db);
		validatePassages(passages, quranVerseCounts, options.profile);
		result = await importPassages(db, passages, options);
	} finally {
		await closeDb(db);
	}
	if (!options.dryRun && options.buildIndex && result.changed) {
		console.log(`Rebuilding the commentary index for '${options.profile.alias}'...`);
		execFileSync(process.execPath, [
			path.resolve(__dirname, '../buildCommentariesIndex.js'),
			'--tafsir', options.profile.alias
		], { stdio: 'inherit', env: process.env });
	}
	return result;
}

async function loadSource(options) {
	if (!options.refresh && fs.existsSync(options.cacheFile)) {
		const cached = readCache(options.cacheFile);
		validateCacheShape(cached, options.profile);
		console.log(`Using cached IslamicStudies.info source: ${displayPath(options.cacheFile)}`);
		return cached.passages;
	}
	const passages = await downloadSource(options);
	const document = {
		version: CACHE_VERSION,
		source: sourceUrl(options.profile.alias),
		alias: options.profile.alias,
		passages: passages
	};
	writeCache(options.cacheFile, document);
	console.log(`Cached ${passages.length} ${options.profile.label} passage(s) at ${displayPath(options.cacheFile)}.`);
	return passages;
}

async function downloadSource(options) {
	const ranges = [];
	let nextSurah = options.fromSurah;
	let completedSurahs = 0;
	const chapterWorkers = Array.from({ length: Math.min(options.concurrency, options.toSurah - options.fromSurah + 1) }, async () => {
		while (nextSurah <= options.toSurah) {
			const surah = nextSurah++;
			const html = await fetchPage(chapterUrl(surah, options.profile.alias), options);
			const chapterRanges = parseChapterRanges(html, surah, options.profile.alias);
			ranges.push(...chapterRanges);
			completedSurahs++;
			if (completedSurahs % 10 === 0 || completedSurahs === options.toSurah - options.fromSurah + 1)
				console.log(`Discovered ranges for ${completedSurahs}/${options.toSurah - options.fromSurah + 1} surah(s)...`);
			if (options.delay)
				await sleep(options.delay);
		}
	});
	await Promise.all(chapterWorkers);
	ranges.sort(comparePassages);

	const passages = new Array(ranges.length);
	let nextRange = 0;
	let completedRanges = 0;
	console.log(`Downloading ${ranges.length} ${options.profile.label} passage page(s) with concurrency ${options.concurrency}...`);
	const passageWorkers = Array.from({ length: Math.min(options.concurrency, ranges.length) }, async () => {
		while (nextRange < ranges.length) {
			const index = nextRange++;
			const range = ranges[index];
			const html = await fetchPage(passageUrl(range.surah, range.ayahFrom, range.ayahTo, options.profile.alias), options);
			passages[index] = parsePassagePage(html, range, options.profile);
			completedRanges++;
			if (completedRanges % 50 === 0 || completedRanges === ranges.length)
				console.log(`Downloaded ${completedRanges}/${ranges.length} passage page(s)...`);
			if (options.delay)
				await sleep(options.delay);
		}
	});
	await Promise.all(passageWorkers);
	return passages.sort(comparePassages);
}

async function fetchPage(url, options) {
	let lastError;
	for (let attempt = 1; attempt <= options.retries + 1; attempt++) {
		try {
			const response = await axios.get(url, {
				timeout: options.timeout,
				headers: { 'User-Agent': 'HadithDB source importer (+https://hadithunlocked.com)' },
				responseType: 'text'
			});
			if (response.status !== 200)
				throw new Error(`HTTP ${response.status}`);
			return response.data;
		} catch (err) {
			lastError = err;
			if (attempt <= options.retries)
				await sleep(options.retryDelay * attempt);
		}
	}
	throw new Error(`${url}: ${describeAxiosError(lastError)}`);
}

function sourceUrl(alias = 'dawat') {
	if (!SOURCES[alias])
		throw new Error(`Unsupported IslamicStudies.info tafsir alias '${alias}'.`);
	return `${SOURCE_ROOT}/${alias}.php`;
}

function chapterUrl(surah, alias = 'dawat') {
	return `${sourceUrl(alias)}?sura=${Number(surah)}`;
}

function passageUrl(surah, ayahFrom, ayahTo, alias = 'dawat') {
	return `${sourceUrl(alias)}?sura=${Number(surah)}&verse=${Number(ayahFrom)}&to=${Number(ayahTo)}`;
}

function parseChapterRanges(html, expectedSurah, alias = 'dawat') {
	const $ = cheerio.load(html);
	const byRange = new Map();
	$('a[href]').each(function () {
		let url;
		try { url = new URL($(this).attr('href'), sourceUrl(alias)); } catch (err) { return; }
		if (url.pathname !== new URL(sourceUrl(alias)).pathname)
			return;
		const surah = Number(url.searchParams.get('sura'));
		const ayahFrom = Number(url.searchParams.get('verse'));
		const ayahTo = Number(url.searchParams.get('to'));
		if (surah !== Number(expectedSurah) || !ayahFrom || !ayahTo)
			return;
		byRange.set(`${ayahFrom}-${ayahTo}`, { surah, ayahFrom, ayahTo });
	});
	const ranges = Array.from(byRange.values()).sort(comparePassages);
	if (!ranges.length)
		throw new Error(`Surah ${expectedSurah}: no ${SOURCES[alias].label} passage ranges found.`);
	return ranges;
}

function parsePassagePage(html, expected, profile = SOURCES.dawat) {
	const $ = cheerio.load(html);
	const sourceRange = normalizeText($('#page center b').filter(function () {
		return /Quran Text of Verse/i.test($(this).text());
	}).first().text());
	const rangeMatch = /Quran Text of Verse\s+([0-9]+)(?:\s*[-–—]\s*([0-9]+))?/i.exec(sourceRange);
	if (!rangeMatch || Number(rangeMatch[1]) !== expected.ayahFrom || Number(rangeMatch[2] || rangeMatch[1]) !== expected.ayahTo)
		throw new Error(`Surah ${expected.surah}:${expected.ayahFrom}-${expected.ayahTo}: source page range did not match.`);

	const translations = [];
	$('bism, p.tr').each(function () {
		const text = blockMarkdown($, this, true);
		if (text)
			translations.push(formatNumberedBlock(text));
	});
	if (!translations.length)
		throw new Error(`Surah ${expected.surah}:${expected.ayahFrom}-${expected.ayahTo}: translation was empty.`);

	const sourceFootnotes = [];
	$('#notes p.nt').each(function () {
		const text = blockMarkdown($, this, false);
		if (text)
			sourceFootnotes.push(parseSourceFootnote(text));
	});
	const converted = convertSourceFootnotes(translations.join('\n\n'), sourceFootnotes);
	if (converted.unresolved.length)
		console.warn(`Surah ${expected.surah}:${expected.ayahFrom}-${expected.ayahTo}: source commentary is missing note(s) ${converted.unresolved.join(', ')}; preserving those markers as superscript text.`);
	const text_en = ['### Translation', converted.text].join('\n\n');
	return {
		surah: expected.surah,
		ayahFrom: expected.ayahFrom,
		ayahTo: expected.ayahTo,
		text_en: normalizeSourceBackticks(text_en, profile),
		footnotes_en: normalizeSourceBackticks(converted.footnotes, profile)
	};
}

function normalizeSourceBackticks(value, profile) {
	if (!profile.escapeMarkdownBackticks)
		return value;
	let backslashes = 0;
	let escaped = '';
	for (const character of String(value || '')) {
		if (character === '`' && backslashes % 2 === 0)
			escaped += '\\';
		escaped += character;
		backslashes = character === '\\' ? backslashes + 1 : 0;
	}
	return escaped;
}

function hasUnescapedSourceBackticks(value) {
	return normalizeSourceBackticks(value, { escapeMarkdownBackticks: true }) !== String(value || '');
}

function blockMarkdown($, element, preserveSup) {
	const clone = $(element).clone();
	clone.find('script, style').remove();
	clone.find('br').replaceWith('\n');
	clone.find('sup').each(function () {
		const label = normalizeText($(this).text());
		$(this).replaceWith(preserveSup && label ? `@@SOURCE_SUP_${label}@@` : label);
	});
	return normalizeText(clone.text());
}

function parseSourceFootnote(text) {
	const match = /^\s*([0-9]+(?:[lI])?)\s*(?:[.,:)]\s*)?([\s\S]*)$/.exec(text);
	return {
		label: normalizeFootnoteLabel(match && match[1]),
		body: normalizeText(match ? match[2] : text)
	};
}

function convertSourceFootnotes(text, sourceFootnotes) {
	const references = Array.from(text.matchAll(/@@SOURCE_SUP_([^@]+)@@/g), match => ({
		raw: normalizeText(match[1]),
		label: normalizeFootnoteLabel(match[1])
	}));
	const referenceLabels = unique(references.map(row => row.label).filter(Boolean));
	const definitionCounts = new Map();
	for (const note of sourceFootnotes) {
		if (note.label)
			definitionCounts.set(note.label, (definitionCounts.get(note.label) || 0) + 1);
	}
	const missing = referenceLabels.filter(label => !definitionCounts.has(label));
	const retainedDefinitionIndexes = new Set();
	for (const label of referenceLabels) {
		const indexes = sourceFootnotes.map((note, index) => note.label === label ? index : -1).filter(index => index >= 0);
		if (!indexes.length)
			continue;
		const expectedIndex = referenceLabels.indexOf(label);
		indexes.sort((left, right) => Math.abs(left - expectedIndex) - Math.abs(right - expectedIndex));
		retainedDefinitionIndexes.add(indexes[0]);
	}
	const surplusIndexes = sourceFootnotes.map((note, index) => index)
		.filter(index => !retainedDefinitionIndexes.has(index));
	if (missing.length && missing.length === surplusIndexes.length) {
		missing.forEach((label, index) => {
			sourceFootnotes[surplusIndexes[index]].label = label;
		});
	}

	const targetBySourceLabel = new Map();
	const usedLabels = new Map();
	const definitions = sourceFootnotes.map((note, index) => {
		const sourceLabel = note.label || `note-${index + 1}`;
		const occurrence = (usedLabels.get(sourceLabel) || 0) + 1;
		usedLabels.set(sourceLabel, occurrence);
		const label = occurrence === 1 ? sourceLabel : `${sourceLabel}-${occurrence}`;
		if (note.label && !targetBySourceLabel.has(note.label))
			targetBySourceLabel.set(note.label, label);
		return `[^${label}]: ${markdownFootnoteBody(note.body)}`;
	});
	const unresolved = [];
	text = text.replace(/@@SOURCE_SUP_([^@]+)@@/g, function (marker, rawLabel) {
		const normalized = normalizeFootnoteLabel(rawLabel);
		const target = targetBySourceLabel.get(normalized);
		if (target)
			return `[^${target}]`;
		if (normalized && !unresolved.includes(normalized))
			unresolved.push(normalized);
		return `<sup>${normalizeText(rawLabel)}</sup>`;
	});
	return { text, footnotes: definitions.join('\n\n'), unresolved };
}

function normalizeFootnoteLabel(value) {
	const match = /([0-9]+(?:[lI])?)/.exec(String(value || ''));
	return match ? match[1].replace(/[lI]$/, '1') : '';
}

function markdownFootnoteBody(value) {
	return normalizeText(value).split('\n').map((line, index) => index === 0 || !line ? line : `    ${line}`).join('\n');
}

function unique(values) {
	return Array.from(new Set(values));
}

function formatNumberedBlock(text) {
	const match = /^\s*([0-9]+(?:[lI])?)\s*([.,:)])?\s+([\s\S]+)$/.exec(text);
	if (!match)
		return text;
	return `**${match[1]}${match[2] || '.'}** ${match[3]}`;
}

function normalizeText(value) {
	return String(value || '')
		.replace(/\u00a0/g, ' ')
		.replace(/\r\n?/g, '\n')
		.replace(/[ \t]+\n/g, '\n')
		.replace(/\n[ \t]+/g, '\n')
		.replace(/[ \t]{2,}/g, ' ')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

function validatePassages(passages, verseCounts, profile = SOURCES.dawat) {
	if (!Array.isArray(passages) || !passages.length)
		throw new Error(`${profile.label} source contains no passages.`);
	const sorted = passages.slice().sort(comparePassages);
	if (verseCounts && sorted.length !== profile.expectedPassages)
		throw new Error(`Expected ${profile.expectedPassages} ${profile.label} passages, found ${sorted.length}.`);
	for (let surah = 1; surah <= EXPECTED_SURAHS; surah++) {
		const rows = sorted.filter(row => Number(row.surah) === surah);
		if (!rows.length)
			throw new Error(`Surah ${surah}: no ${profile.label} passages.`);
		if (Number(rows[0].ayahFrom) !== 1)
			throw new Error(`Surah ${surah}: first ${profile.label} passage starts at ayah ${rows[0].ayahFrom}.`);
		for (let index = 1; index < rows.length; index++) {
			if (Number(rows[index].ayahFrom) !== Number(rows[index - 1].ayahTo) + 1)
				throw new Error(`Surah ${surah}: gap or overlap between ${rows[index - 1].ayahTo} and ${rows[index].ayahFrom}.`);
		}
		if (verseCounts && Number(rows[rows.length - 1].ayahTo) !== Number(verseCounts.get(surah)))
			throw new Error(`Surah ${surah}: ${profile.label} ends at ayah ${rows[rows.length - 1].ayahTo}, expected ${verseCounts.get(surah)}.`);
		for (const row of rows) {
			if (!normalizeText(row.text_en))
				throw new Error(`Surah ${surah}:${row.ayahFrom}-${row.ayahTo}: empty ${profile.label} text.`);
			if (profile.escapeMarkdownBackticks && (hasUnescapedSourceBackticks(row.text_en) || hasUnescapedSourceBackticks(row.footnotes_en)))
				throw new Error(`${profile.label} ${passageKey(row)} contains unescaped Markdown backticks.`);
			validateMarkdownFootnotes(row, profile);
		}
	}
	return true;
}

function validateMarkdownFootnotes(row, profile) {
	const references = Array.from(String(row.text_en || '').matchAll(/\[\^([^\]]+)\]/g), match => match[1]);
	const definitions = Array.from(String(row.footnotes_en || '').matchAll(/^\[\^([^\]]+)\]:/gm), match => match[1]);
	const definitionSet = new Set(definitions);
	if (definitionSet.size !== definitions.length)
		throw new Error(`${profile.label} ${passageKey(row)} has duplicate Markdown footnote definitions.`);
	const missing = unique(references).filter(label => !definitionSet.has(label));
	if (missing.length)
		throw new Error(`${profile.label} ${passageKey(row)} has Markdown references without definitions: ${missing.join(', ')}.`);
	return true;
}

async function loadQuranVerseCounts(db) {
	const rows = await query(db, `
		SELECT CAST(SUBSTRING_INDEX(num, ':', 1) AS UNSIGNED) AS surah,
			MAX(CAST(SUBSTRING_INDEX(num, ':', -1) AS UNSIGNED)) AS ayahTo,
			COUNT(*) AS ayahs
		FROM hadiths
		WHERE bookId=0 AND num REGEXP '^[0-9]+:[1-9][0-9]*$'
		GROUP BY CAST(SUBSTRING_INDEX(num, ':', 1) AS UNSIGNED)
		ORDER BY surah`);
	if (rows.length !== EXPECTED_SURAHS)
		throw new Error(`Expected ${EXPECTED_SURAHS} local Quran surahs, found ${rows.length}.`);
	const counts = new Map();
	for (const row of rows) {
		if (Number(row.ayahs) !== Number(row.ayahTo))
			throw new Error(`Local Quran surah ${row.surah} is not contiguous.`);
		counts.set(Number(row.surah), Number(row.ayahTo));
	}
	return counts;
}

async function importPassages(db, passages, options) {
	const profile = options.profile;
	const book = profile.book;
	const books = await query(db, `SELECT * FROM books WHERE alias=${mysql.escape(book.alias)} LIMIT 2`);
	if (books.length > 1)
		throw new Error(`Expected at most one book with alias '${book.alias}', found ${books.length}.`);
	if (books[0] && (books[0].type !== 'tafsir' || books[0].source !== 'local'))
		throw new Error(`Alias '${book.alias}' belongs to a non-local tafsir book.`);
	const existingRows = books[0] ? await loadExistingRows(db, books[0].id) : [];
	const changes = countChanges(existingRows, passages);
	const metadataChanged = !books[0] || bookMetadataChanged(books[0], book);
	console.log(`Validated ${passages.length} ${profile.label} passages across ${EXPECTED_SURAHS} surahs.`);
	console.log(`${options.dryRun ? 'Would apply' : 'Applying'} ${changes.inserts} insert(s), ${changes.updates} update(s), and ${changes.deletes} stale-row deletion(s).`);
	if (options.dryRun)
		return { changed: metadataChanged || changes.inserts > 0 || changes.updates > 0 || changes.deletes > 0,
			bookId: books[0] ? Number(books[0].id) : null, ...changes };

	let lockHeld = false;
	try {
		const lockName = `hadithdb:import-${profile.alias}-tafsir`;
		const lockRows = await query(db, `SELECT GET_LOCK(${mysql.escape(lockName)}, 30) AS acquired`);
		if (Number(lockRows[0]?.acquired) !== 1)
			throw new Error(`Could not acquire the ${profile.label} tafsir import lock.`);
		lockHeld = true;
		await query(db, 'START TRANSACTION');
		try {
			const bookId = await upsertBook(db, books[0], book);
			await upsertPassages(db, bookId, passages, options.batchSize);
			await deleteStaleRows(db, bookId, passages);
			await verifyImportedRows(db, bookId, passages, profile);
			await query(db, `UPDATE books SET content_lastmod=CURRENT_TIMESTAMP() WHERE id=${Number(bookId)}`);
			await query(db, 'COMMIT');
			console.log(`Imported and verified ${passages.length} passage(s) into tafsir alias '${book.alias}'.`);
			return { changed: metadataChanged || changes.inserts > 0 || changes.updates > 0 || changes.deletes > 0,
				bookId: Number(bookId), ...changes };
		} catch (err) {
			await query(db, 'ROLLBACK');
			throw err;
		}
	} finally {
		if (lockHeld)
			await query(db, `SELECT RELEASE_LOCK(${mysql.escape(`hadithdb:import-${profile.alias}-tafsir`)})`);
	}
}

function countChanges(existingRows, passages) {
	const existing = new Map(existingRows.map(row => [passageKey(row), row]));
	let inserts = 0;
	let updates = 0;
	for (const passage of passages) {
		const row = existing.get(passageKey(passage));
		if (!row)
			inserts++;
		else if (String(row.text_en || '') !== passage.text_en || String(row.footnotes_en || '') !== passage.footnotes_en)
			updates++;
		existing.delete(passageKey(passage));
	}
	return { inserts, updates, deletes: existing.size };
}

async function loadExistingRows(db, bookId) {
	return query(db, `SELECT id, surah, ayahFrom, ayahTo, text_en, footnotes_en
		FROM hadiths_commentary WHERE bookId=${Number(bookId)} ORDER BY surah, ayahFrom, ayahTo`);
}

function bookMetadataChanged(existing, book) {
	return String(existing.type || '') !== 'tafsir' || String(existing.source || '') !== 'local' ||
		String(existing.lang || '') !== book.lang || String(existing.format || '') !== book.format ||
		String(existing.shortName_en || '') !== book.shortName_en || String(existing.shortName || '') !== '' ||
		String(existing.name_en || '') !== book.name_en || String(existing.author_en || '') !== book.author_en ||
		String(existing.description || '') !== book.description || Number(existing.hidden) !== 0;
}

async function upsertBook(db, existing, book) {
	let bookId = existing?.id;
	let ordinal = Number(existing?.ordinal);
	if (!ordinal) {
		const rows = await query(db, "SELECT COALESCE(MAX(ordinal), 0) + 1 AS ordinal FROM books WHERE type='tafsir'");
		ordinal = Number(rows[0].ordinal);
	}
	if (!bookId) {
		const rows = await query(db, 'SELECT COALESCE(MAX(id), 0) + 1 AS id FROM books FOR UPDATE');
		bookId = Number(rows[0].id);
	}
	await query(db, `INSERT INTO books
		(id, ordinal, alias, type, shortName_en, shortName, hidden, source, lang, format, name_en, author_en, description)
		VALUES (${Number(bookId)}, ${ordinal}, ${mysql.escape(book.alias)}, 'tafsir', ${mysql.escape(book.shortName_en)}, '',
			0, 'local', ${mysql.escape(book.lang)}, ${mysql.escape(book.format)}, ${mysql.escape(book.name_en)},
			${mysql.escape(book.author_en)}, ${mysql.escape(book.description)})
		ON DUPLICATE KEY UPDATE ordinal=VALUES(ordinal), type='tafsir', shortName_en=VALUES(shortName_en), shortName='',
			hidden=0, source='local', lang=VALUES(lang), format=VALUES(format), name_en=VALUES(name_en),
			author_en=VALUES(author_en), description=VALUES(description)`);
	return bookId;
}

async function upsertPassages(db, bookId, passages, batchSize) {
	const refs = Array.from(new Set(passages.map(row => `${row.surah}:${row.ayahFrom}`)));
	const quranRows = await query(db, `SELECT id, num FROM hadiths WHERE bookId=0 AND num IN (${refs.map(mysql.escape).join(',')})`);
	const hadithIds = new Map(quranRows.map(row => [row.num, Number(row.id)]));
	for (let offset = 0; offset < passages.length; offset += batchSize) {
		const values = passages.slice(offset, offset + batchSize).map(row => {
			const hadithId = hadithIds.get(`${row.surah}:${row.ayahFrom}`);
			if (!hadithId)
				throw new Error(`Missing local Quran row ${row.surah}:${row.ayahFrom}.`);
			return `(${Number(bookId)}, ${hadithId}, ${row.surah}, ${row.ayahFrom}, ${row.ayahTo}, ${row.ayahFrom}, ${mysql.escape(row.text_en)}, ${mysql.escape(row.footnotes_en || null)})`;
		});
		await query(db, `INSERT INTO hadiths_commentary
			(bookId, hadithId, surah, ayahFrom, ayahTo, passageNum, text_en, footnotes_en)
			VALUES ${values.join(',\n')}
			ON DUPLICATE KEY UPDATE hadithId=VALUES(hadithId), passageNum=VALUES(passageNum),
				text_en=VALUES(text_en), footnotes_en=VALUES(footnotes_en)`);
	}
}

async function deleteStaleRows(db, bookId, passages) {
	const keys = new Set(passages.map(passageKey));
	const rows = await loadExistingRows(db, bookId);
	const staleIds = rows.filter(row => !keys.has(passageKey(row))).map(row => Number(row.id));
	if (staleIds.length)
		await query(db, `DELETE FROM hadiths_commentary WHERE bookId=${Number(bookId)} AND id IN (${staleIds.join(',')})`);
}

async function verifyImportedRows(db, bookId, passages, profile) {
	const rows = await loadExistingRows(db, bookId);
	if (rows.length !== passages.length)
		throw new Error(`Expected ${passages.length} imported ${profile.label} rows, found ${rows.length}.`);
	const expected = new Map(passages.map(row => [passageKey(row), row]));
	for (const row of rows) {
		const passage = expected.get(passageKey(row));
		if (!passage || String(row.text_en || '') !== passage.text_en || String(row.footnotes_en || '') !== passage.footnotes_en)
			throw new Error(`Imported ${profile.label} row ${passageKey(row)} did not match the source cache.`);
	}
}

function passageKey(row) {
	return `${Number(row.surah)}:${Number(row.ayahFrom)}-${Number(row.ayahTo)}`;
}

function comparePassages(left, right) {
	return Number(left.surah) - Number(right.surah) || Number(left.ayahFrom) - Number(right.ayahFrom) || Number(left.ayahTo) - Number(right.ayahTo);
}

function validateCacheShape(document, profile) {
	if (!document || Number(document.version) !== CACHE_VERSION || document.source !== sourceUrl(profile.alias) || document.alias !== profile.alias || !Array.isArray(document.passages))
		throw new Error(`The ${profile.label} source cache is invalid or obsolete; rerun with --refresh.`);
}

function readCache(filename) {
	return JSON.parse(fs.readFileSync(filename, 'utf8'));
}

function writeCache(filename, document) {
	fs.mkdirSync(path.dirname(filename), { recursive: true });
	fs.writeFileSync(filename, `${JSON.stringify(document, null, 2)}\n`);
}

function readOptions(argv) {
	const options = {
		alias: 'dawat', cacheFile: '', fromSurah: 1, toSurah: 114, concurrency: 8,
		batchSize: 100, timeout: 30000, retries: 3, retryDelay: 1000, delay: 50,
		refresh: false, dryRun: true, buildIndex: true
	};
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		if (arg === '--alias') options.alias = requiredValue(argv, ++index, arg);
		else if (arg === '--cache-file') options.cacheFile = path.resolve(process.cwd(), requiredValue(argv, ++index, arg));
		else if (arg === '--from-surah') options.fromSurah = positiveInteger(requiredValue(argv, ++index, arg), arg);
		else if (arg === '--to-surah') options.toSurah = positiveInteger(requiredValue(argv, ++index, arg), arg);
		else if (arg === '--concurrency') options.concurrency = positiveInteger(requiredValue(argv, ++index, arg), arg);
		else if (arg === '--batch-size') options.batchSize = positiveInteger(requiredValue(argv, ++index, arg), arg);
		else if (arg === '--timeout') options.timeout = positiveInteger(requiredValue(argv, ++index, arg), arg);
		else if (arg === '--retries') options.retries = nonNegativeInteger(requiredValue(argv, ++index, arg), arg);
		else if (arg === '--retry-delay') options.retryDelay = nonNegativeInteger(requiredValue(argv, ++index, arg), arg);
		else if (arg === '--delay') options.delay = nonNegativeInteger(requiredValue(argv, ++index, arg), arg);
		else if (arg === '--refresh') options.refresh = true;
		else if (arg === '--apply') options.dryRun = false;
		else if (arg === '--dry-run') options.dryRun = true;
		else if (arg === '--no-index') options.buildIndex = false;
		else if (arg === '--help' || arg === '-h') { console.log(usage()); return null; }
		else throw new Error(`Unknown option '${arg}'.\n\n${usage()}`);
	}
	if (!SOURCES[options.alias])
		throw new Error(`--alias must be one of: ${Object.keys(SOURCES).join(', ')}.`);
	if (options.fromSurah !== 1 || options.toSurah !== 114)
		throw new Error(`${SOURCES[options.alias].label} imports must cover all surahs 1-114.`);
	options.profile = SOURCES[options.alias];
	if (!options.cacheFile)
		options.cacheFile = path.resolve(__dirname, `../../data/cache/islamicstudies/${options.alias}.json`);
	return options;
}

function usage() {
	return [
		'Usage: node bin/utils/import-islamicstudies-dawat-tafsir.js --alias <dawat|ishraq> [options]', '',
		"Downloads a configured tafsir's source-defined verse ranges from IslamicStudies.info,",
		"preserves each range's translation and numbered commentary as Markdown, validates",
		'complete Quran coverage, and imports it transactionally under its configured local alias.',
		'Default mode is a read-only dry run. --apply also rebuilds the targeted commentary index.', '',
		'  --alias <name>          Source profile: dawat or ishraq (default: dawat)',
		'  --apply                 Import, verify, and rebuild the commentary index',
		'  --dry-run               Validate and report only (default)',
		'  --refresh               Redownload the source instead of using the cache',
		'  --cache-file <json>     Override data/cache/islamicstudies/<alias>.json',
		'  --concurrency <number>  Concurrent source requests (default: 8)',
		'  --delay <ms>            Delay after each request (default: 50)',
		'  --no-index              Skip targeted Elasticsearch indexing after --apply',
		'  --help                  Show this help'
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
	BOOK,
	SOURCES,
	chapterUrl,
	formatNumberedBlock,
	normalizeText,
	parseChapterRanges,
	parsePassagePage,
	passageUrl,
	readOptions,
	run,
	sourceUrl,
	validatePassages
};
