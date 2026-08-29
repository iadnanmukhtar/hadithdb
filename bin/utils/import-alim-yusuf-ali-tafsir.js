#!/usr/bin/env node
/* jslint node:true, esversion:9 */
'use strict';

require('dotenv').config();

const axios = require('axios');
const cheerio = require('cheerio');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const fs = require('fs');
const mysql = require('mysql');
const os = require('os');
const path = require('path');

const SOURCE_ROOT = 'https://www.alim.org/translation/yusuf-ali';
const CACHE_VERSION = 1;
const EXPECTED_SURAHS = 114;
const BOOK = Object.freeze({
	alias: 'yusuf-ali',
	shortName_en: 'Yusuf Ali',
	name_en: "The Meaning of the Holy Qur'an",
	author_en: 'Abdullah Yusuf Ali',
	description: "An English translation and commentary of the Qur'an by Abdullah Yusuf Ali, including the author's explanatory notes.",
	lang: 'en',
	format: 'md',
	size: 'md',
	properties: Object.freeze({
		quran: Object.freeze({ display_as: Object.freeze(['translation', 'tafsir']) })
	})
});

async function run(argv = process.argv.slice(2)) {
	const options = readOptions(argv);
	if (!options)
		return null;
	const passages = await loadSource(options);
	const db = await connectDb();
	let result;
	try {
		const verseCounts = await loadQuranVerseCounts(db);
		validatePassages(passages, verseCounts);
		result = await importPassages(db, passages, options);
	} finally {
		await closeDb(db);
	}
	if (!options.dryRun && options.buildIndex && result.changed) {
		console.log(`Rebuilding the commentary index for '${BOOK.alias}'...`);
		execFileSync(process.execPath, [
			path.resolve(__dirname, '../buildCommentariesIndex.js'),
			'--tafsir', BOOK.alias
		], {
			stdio: 'inherit',
			env: {
				...process.env,
				BULK_INDEX_GZIP: process.env.BULK_INDEX_GZIP || '1',
				COMMENTARY_INDEX_BATCH_SIZE: process.env.COMMENTARY_INDEX_BATCH_SIZE || '250'
			}
		});
	}
	return result;
}

async function loadSource(options) {
	const document = options.refresh ? emptyCache() : readCache(options.cacheFile);
	const missing = [];
	for (let surah = 1; surah <= EXPECTED_SURAHS; surah++) {
		if (!validCachedSurah(document.surahs[surah], surah))
			missing.push(surah);
	}
	if (missing.length) {
		console.log(`Downloading ${missing.length} Alim Yusuf Ali surah page(s) with concurrency ${Math.min(options.concurrency, missing.length)}...`);
		let next = 0;
		let completed = 0;
		const workers = Array.from({ length: Math.min(options.concurrency, missing.length) }, async () => {
			while (next < missing.length) {
				const surah = missing[next++];
				const url = sourceUrl(surah);
				const html = await fetchPage(url, options);
				const verses = parseSurahPage(html, surah, url);
				document.surahs[surah] = {
					surah,
					url,
					verses,
					sha256: passagesChecksum(verses)
				};
				document.fetchedAt = new Date().toISOString();
				writeCache(options.cacheFile, document);
				completed++;
				if (completed % 10 === 0 || completed === missing.length)
					console.log(`Downloaded ${completed}/${missing.length} surah page(s)...`);
				if (options.delay)
					await sleep(options.delay);
			}
		});
		await Promise.all(workers);
	} else {
		console.log(`Using cached Alim Yusuf Ali source: ${displayPath(options.cacheFile)}`);
	}
	const passages = Object.values(document.surahs)
		.sort((left, right) => Number(left.surah) - Number(right.surah))
		.flatMap(entry => entry.verses);
	console.log(`Loaded ${passages.length} cached Yusuf Ali ayah passage(s).`);
	return passages;
}

function emptyCache() {
	return { version: CACHE_VERSION, source: SOURCE_ROOT, alias: BOOK.alias, fetchedAt: null, surahs: {} };
}

function readCache(filename) {
	if (!fs.existsSync(filename))
		return emptyCache();
	try {
		const document = JSON.parse(fs.readFileSync(filename, 'utf8'));
		if (document && Number(document.version) === CACHE_VERSION && document.source === SOURCE_ROOT &&
				document.alias === BOOK.alias && document.surahs && typeof document.surahs === 'object' && !Array.isArray(document.surahs))
			return document;
		console.warn(`Ignoring incompatible Alim Yusuf Ali cache: ${displayPath(filename)}`);
	} catch (err) {
		console.warn(`Ignoring unreadable Alim Yusuf Ali cache ${displayPath(filename)}: ${err.message}`);
	}
	return emptyCache();
}

function writeCache(filename, document) {
	fs.mkdirSync(path.dirname(filename), { recursive: true });
	const temporary = `${filename}.${process.pid}.tmp`;
	fs.writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`);
	fs.renameSync(temporary, filename);
}

function validCachedSurah(entry, surah) {
	return Boolean(entry && Number(entry.surah) === Number(surah) && entry.url === sourceUrl(surah) &&
		Array.isArray(entry.verses) && entry.verses.length > 0 && /^[a-f0-9]{64}$/.test(entry.sha256 || '') &&
		passagesChecksum(entry.verses) === entry.sha256);
}

function passagesChecksum(passages) {
	return crypto.createHash('sha256').update(JSON.stringify(passages)).digest('hex');
}

async function fetchPage(url, options) {
	let lastError;
	for (let attempt = 1; attempt <= options.retries + 1; attempt++) {
		try {
			const response = await axios.get(url, {
				headers: {
					'Accept': 'text/html,application/xhtml+xml',
					'Accept-Language': 'en-US,en;q=0.9',
					'User-Agent': 'Mozilla/5.0 (compatible; HadithDB Alim Yusuf Ali importer)'
				},
				maxRedirects: 5,
				timeout: options.timeout,
				responseType: 'text',
				validateStatus: status => status === 200
			});
			return response.data;
		} catch (err) {
			lastError = err;
			if (attempt <= options.retries)
				await sleep(options.retryDelay * attempt);
		}
	}
	throw new Error(`${url}: ${describeAxiosError(lastError)}`);
}

function sourceUrl(surah) {
	return `${SOURCE_ROOT}/${Number(surah)}/`;
}

function parseSurahPage(html, expectedSurah, expectedUrl = sourceUrl(expectedSurah)) {
	const $ = cheerio.load(html);
	const canonical = $('link[rel="canonical"]').attr('href');
	if (canonical && normalizeUrl(canonical) !== normalizeUrl(expectedUrl))
		throw new Error(`Surah ${expectedSurah}: canonical URL '${canonical}' did not match '${expectedUrl}'.`);
	const heading = normalizeInline($('h1').first().text());
	if (!new RegExp(`^Surah\\s+${Number(expectedSurah)}\\.`).test(heading))
		throw new Error(`Surah ${expectedSurah}: source heading did not identify the expected surah.`);
	const containers = $('#translation-content .trans-ayah-container');
	if (!containers.length)
		throw new Error(`Surah ${expectedSurah}: no Yusuf Ali ayah containers found.`);
	const passages = [];
	containers.each(function (index) {
		const container = $(this);
		const idMatch = /^translation([0-9]+)$/.exec(container.attr('id') || '');
		const ayah = Number(idMatch && idMatch[1]);
		if (!ayah || ayah !== index + 1)
			throw new Error(`Surah ${expectedSurah}: expected sequential ayah ${index + 1}, found '${container.attr('id') || ''}'.`);
		const translationRoot = container.find(`#yatTranslation${ayah}`).first();
		const translationHeading = translationRoot.children('h5').first();
		if (!translationRoot.length || !translationHeading.length)
			throw new Error(`Surah ${expectedSurah}:${ayah}: translation content was missing.`);
		const translation = normalizeInline(markdownChildren($, translationHeading[0]))
			.replace(/\s+(\[\^[A-Za-z0-9-]+\])/g, '$1');
		if (!translation)
			throw new Error(`Surah ${expectedSurah}:${ayah}: translation was empty.`);
		const definitions = [];
		translationRoot.children('p.footnotes').each(function () {
			const labelMatch = /^yatFNote([0-9]+(?:-[A-Za-z0-9]+)?)$/.exec($(this).attr('id') || '');
			if (!labelMatch)
				throw new Error(`Surah ${expectedSurah}:${ayah}: malformed Yusuf Ali footnote id '${$(this).attr('id') || ''}'.`);
			const text = normalizeBlock(markdownChildren($, this));
			if (!text)
				throw new Error(`Surah ${expectedSurah}:${ayah}: footnote ${labelMatch[1]} was empty.`);
			definitions.push({ label: labelMatch[1], text });
		});
		reconcileFootnoteLabels(translation, definitions, `${expectedSurah}:${ayah}`);
		const passage = {
			surah: Number(expectedSurah),
			ayahFrom: ayah,
			ayahTo: ayah,
			text_en: translation,
			footnotes_en: definitions.map(definition => markdownFootnoteDefinition(definition.label, definition.text)).join('\n\n')
		};
		validateMarkdownFootnotes(passage);
		passages.push(passage);
	});
	return passages;
}

function reconcileFootnoteLabels(text, definitions, ref) {
	const referenceLabels = Array.from(new Set(Array.from(String(text || '').matchAll(/\[\^([A-Za-z0-9-]+)\]/g), match => match[1])));
	const retainedDefinitionIndexes = new Set();
	for (const label of referenceLabels) {
		const index = definitions.findIndex((definition, definitionIndex) => definition.label === label && !retainedDefinitionIndexes.has(definitionIndex));
		if (index >= 0)
			retainedDefinitionIndexes.add(index);
	}
	const missing = referenceLabels.filter(label => !definitions.some(definition => definition.label === label));
	const surplusIndexes = definitions.map((definition, index) => index).filter(index => !retainedDefinitionIndexes.has(index));
	if (missing.length && missing.length === surplusIndexes.length) {
		missing.forEach((label, index) => {
			const sourceLabel = definitions[surplusIndexes[index]].label;
			definitions[surplusIndexes[index]].label = label;
			console.warn(`Yusuf Ali ${ref}: reconciled source footnote marker ${label} with definition ${sourceLabel}.`);
		});
	}
}

function markdownChildren($, element) {
	return $(element).contents().map((index, node) => markdownNode($, node)).get().join('');
}

function markdownNode($, node) {
	if (node.type === 'text')
		return escapeMarkdownText(String(node.data || '').replace(/\u00a0/g, ' '));
	if (node.type !== 'tag')
		return '';
	const tag = String(node.name || '').toLowerCase();
	if (tag === 'br')
		return '\n';
	if (tag === 'sup' && $(node).hasClass('fn')) {
		const label = normalizeInline($(node).text());
		if (!/^[0-9]+(?:-[A-Za-z0-9]+)?$/.test(label))
			throw new Error(`Malformed Yusuf Ali footnote marker '${label}'.`);
		return `[^${label}]`;
	}
	const content = markdownChildren($, node);
	if ((tag === 'strong' || tag === 'b') && normalizeInline(content))
		return `**${normalizeInline(content)}**`;
	if ((tag === 'em' || tag === 'i') && normalizeInline(content))
		return `*${normalizeInline(content)}*`;
	if (tag === 'a') {
		const label = normalizeInline(content);
		const href = $(node).attr('href');
		if (!label || !href || /^javascript:/i.test(href || ''))
			return label;
		return `[${label}](${new URL(href, 'https://www.alim.org').href})`;
	}
	return content;
}

function escapeMarkdownText(value) {
	return String(value || '').replace(/([\\`*_[\]])/g, '\\$1');
}

function normalizeInline(value) {
	return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeBlock(value) {
	return String(value || '')
		.replace(/\r\n?/g, '\n')
		.split('\n')
		.map(line => line.replace(/[ \t]+/g, ' ').trim())
		.join('\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

function markdownFootnoteDefinition(label, text) {
	return normalizeBlock(text).split('\n').map((line, index) => {
		if (index === 0)
			return `[^${label}]: ${line}`;
		return line ? `    ${line}` : '';
	}).join('\n');
}

function validateMarkdownFootnotes(row) {
	const references = Array.from(String(row.text_en || '').matchAll(/\[\^([^\]]+)\]/g), match => match[1]);
	const definitions = Array.from(String(row.footnotes_en || '').matchAll(/^\[\^([^\]]+)\]:/gm), match => match[1]);
	const referenceSet = new Set(references);
	const definitionSet = new Set(definitions);
	if (definitionSet.size !== definitions.length)
		throw new Error(`Yusuf Ali ${passageKey(row)} has duplicate footnote definitions.`);
	const missing = Array.from(referenceSet).filter(label => !definitionSet.has(label));
	const unused = Array.from(definitionSet).filter(label => !referenceSet.has(label));
	if (missing.length || unused.length)
		throw new Error(`Yusuf Ali ${passageKey(row)} footnote mismatch; missing definitions: ${missing.join(', ') || 'none'}; unused definitions: ${unused.join(', ') || 'none'}.`);
	return true;
}

function validatePassages(passages, verseCounts) {
	if (!Array.isArray(passages) || !passages.length)
		throw new Error('No Yusuf Ali passages were loaded.');
	const bySurah = new Map();
	const keys = new Set();
	for (const row of passages) {
		const key = passageKey(row);
		if (keys.has(key))
			throw new Error(`Duplicate Yusuf Ali passage ${key}.`);
		keys.add(key);
		if (Number(row.ayahFrom) !== Number(row.ayahTo))
			throw new Error(`Yusuf Ali ${key} was not a single-ayah passage.`);
		if (!String(row.text_en || '').trim())
			throw new Error(`Yusuf Ali ${key} had invalid or empty translation Markdown.`);
		if (hasUnescapedMarkdownBackticks(row.text_en) || hasUnescapedMarkdownBackticks(row.footnotes_en))
			throw new Error(`Yusuf Ali ${key} contains unescaped Markdown backticks.`);
		validateMarkdownFootnotes(row);
		if (!bySurah.has(Number(row.surah)))
			bySurah.set(Number(row.surah), []);
		bySurah.get(Number(row.surah)).push(row);
	}
	if (bySurah.size !== EXPECTED_SURAHS)
		throw new Error(`Expected ${EXPECTED_SURAHS} Yusuf Ali surahs, found ${bySurah.size}.`);
	for (let surah = 1; surah <= EXPECTED_SURAHS; surah++) {
		const rows = (bySurah.get(surah) || []).sort(comparePassages);
		const expectedCount = verseCounts ? Number(verseCounts.get(surah)) : rows.length;
		if (!expectedCount || rows.length !== expectedCount)
			throw new Error(`Surah ${surah}: found ${rows.length} Yusuf Ali ayahs, expected ${expectedCount || 0}.`);
		for (let index = 0; index < rows.length; index++) {
			if (Number(rows[index].ayahFrom) !== index + 1)
				throw new Error(`Surah ${surah}: expected Yusuf Ali ayah ${index + 1}, found ${rows[index].ayahFrom}.`);
		}
	}
	return true;
}

function hasUnescapedMarkdownBackticks(value) {
	value = String(value || '');
	for (let index = 0; index < value.length; index++) {
		if (value[index] !== '`')
			continue;
		let backslashes = 0;
		for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor--)
			backslashes++;
		if (backslashes % 2 === 0)
			return true;
	}
	return false;
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
	const books = await query(db, `SELECT * FROM books WHERE alias=${mysql.escape(BOOK.alias)} LIMIT 2`);
	if (books.length > 1)
		throw new Error(`Expected at most one book with alias '${BOOK.alias}', found ${books.length}.`);
	if (books[0] && (books[0].type !== 'tafsir' || books[0].source !== 'local'))
		throw new Error(`Alias '${BOOK.alias}' belongs to a non-local tafsir book.`);
	const existingRows = books[0] ? await loadExistingRows(db, books[0].id) : [];
	const changes = countChanges(existingRows, passages);
	const metadataChanged = !books[0] || bookMetadataChanged(books[0]);
	const footnoted = passages.filter(row => row.footnotes_en).length;
	console.log(`Validated ${passages.length} Yusuf Ali ayah passages across ${EXPECTED_SURAHS} surahs (${footnoted} with commentary notes).`);
	console.log(`${options.dryRun ? 'Would apply' : 'Applying'} ${changes.inserts} insert(s), ${changes.updates} update(s), and ${changes.deletes} stale-row deletion(s).`);
	if (options.dryRun)
		return { changed: metadataChanged || changes.inserts > 0 || changes.updates > 0 || changes.deletes > 0,
			bookId: books[0] ? Number(books[0].id) : null, ...changes };

	let lockHeld = false;
	const lockName = `hadithdb:import-${BOOK.alias}-tafsir`;
	try {
		const lockRows = await query(db, `SELECT GET_LOCK(${mysql.escape(lockName)}, 30) AS acquired`);
		if (Number(lockRows[0]?.acquired) !== 1)
			throw new Error('Could not acquire the Yusuf Ali tafsir import lock.');
		lockHeld = true;
		await query(db, 'START TRANSACTION');
		try {
			const bookId = await upsertBook(db, books[0]);
			await upsertPassages(db, bookId, passages, options.batchSize);
			await deleteStaleRows(db, bookId, passages);
			await verifyImportedRows(db, bookId, passages);
			await query(db, `UPDATE books SET content_lastmod=CURRENT_TIMESTAMP() WHERE id=${Number(bookId)}`);
			await query(db, 'COMMIT');
			console.log(`Imported and verified ${passages.length} passage(s) into tafsir alias '${BOOK.alias}'.`);
			return { changed: metadataChanged || changes.inserts > 0 || changes.updates > 0 || changes.deletes > 0,
				bookId: Number(bookId), ...changes };
		} catch (err) {
			await query(db, 'ROLLBACK');
			throw err;
		}
	} finally {
		if (lockHeld)
			await query(db, `SELECT RELEASE_LOCK(${mysql.escape(lockName)})`);
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

function bookMetadataChanged(existing) {
	return String(existing.type || '') !== 'tafsir' || String(existing.source || '') !== 'local' ||
		String(existing.lang || '') !== BOOK.lang || String(existing.format || '') !== BOOK.format ||
		String(existing.size || '') !== BOOK.size ||
		!bookHasDisplayRoles(existing, BOOK.properties.quran.display_as) ||
		String(existing.shortName_en || '') !== BOOK.shortName_en || String(existing.shortName || '') !== '' ||
		String(existing.name_en || '') !== BOOK.name_en || String(existing.author_en || '') !== BOOK.author_en ||
		String(existing.description || '') !== BOOK.description || Number(existing.hidden) !== 0;
}

function bookHasDisplayRoles(book, expectedRoles) {
	let properties = book && book.properties;
	if (Buffer.isBuffer(properties))
		properties = properties.toString();
	if (typeof properties === 'string') {
		try {
			properties = JSON.parse(properties);
		} catch (_err) {
			return false;
		}
	}
	const roles = properties && properties.quran && Array.isArray(properties.quran.display_as)
		? properties.quran.display_as
		: [];
	return expectedRoles.every(role => roles.includes(role));
}

async function upsertBook(db, existing) {
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
		(id, ordinal, alias, type, shortName_en, shortName, hidden, source, lang, format, size, name_en, author_en, description, properties)
		VALUES (${Number(bookId)}, ${ordinal}, ${mysql.escape(BOOK.alias)}, 'tafsir', ${mysql.escape(BOOK.shortName_en)}, '',
			0, 'local', ${mysql.escape(BOOK.lang)}, ${mysql.escape(BOOK.format)}, ${mysql.escape(BOOK.size)}, ${mysql.escape(BOOK.name_en)},
			${mysql.escape(BOOK.author_en)}, ${mysql.escape(BOOK.description)}, ${mysql.escape(JSON.stringify(BOOK.properties))})
		ON DUPLICATE KEY UPDATE ordinal=VALUES(ordinal), type='tafsir', shortName_en=VALUES(shortName_en), shortName='',
			hidden=0, source='local', lang=VALUES(lang), format=VALUES(format), size=VALUES(size), name_en=VALUES(name_en),
			author_en=VALUES(author_en), description=VALUES(description),
			properties=JSON_SET(COALESCE(properties, JSON_OBJECT()), '$.quran',
				JSON_OBJECT('display_as', JSON_ARRAY('translation', 'tafsir')))`);
	return bookId;
}

async function upsertPassages(db, bookId, passages, batchSize) {
	const quranRows = await query(db, "SELECT id, num FROM hadiths WHERE bookId=0 AND num REGEXP '^[0-9]+:[1-9][0-9]*$'");
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
	for (let offset = 0; offset < staleIds.length; offset += 500)
		await query(db, `DELETE FROM hadiths_commentary WHERE bookId=${Number(bookId)} AND id IN (${staleIds.slice(offset, offset + 500).join(',')})`);
}

async function verifyImportedRows(db, bookId, passages) {
	const rows = await loadExistingRows(db, bookId);
	if (rows.length !== passages.length)
		throw new Error(`Expected ${passages.length} imported Yusuf Ali rows, found ${rows.length}.`);
	const expected = new Map(passages.map(row => [passageKey(row), row]));
	for (const row of rows) {
		const passage = expected.get(passageKey(row));
		if (!passage || String(row.text_en || '') !== passage.text_en || String(row.footnotes_en || '') !== passage.footnotes_en)
			throw new Error(`Imported Yusuf Ali row ${passageKey(row)} did not match the source cache.`);
	}
}

function passageKey(row) {
	return `${Number(row.surah)}:${Number(row.ayahFrom)}-${Number(row.ayahTo)}`;
}

function comparePassages(left, right) {
	return Number(left.surah) - Number(right.surah) || Number(left.ayahFrom) - Number(right.ayahFrom) || Number(left.ayahTo) - Number(right.ayahTo);
}

function readOptions(argv) {
	const options = {
		cacheFile: path.resolve(__dirname, '../../data/cache/alim/yusuf-ali.json'),
		concurrency: 8,
		batchSize: 200,
		timeout: 30000,
		retries: 3,
		retryDelay: 1000,
		delay: 50,
		refresh: false,
		dryRun: true,
		buildIndex: true
	};
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		if (arg === '--cache-file') options.cacheFile = path.resolve(process.cwd(), requiredValue(argv, ++index, arg));
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
	return options;
}

function usage() {
	return [
		'Usage: node bin/utils/import-alim-yusuf-ali-tafsir.js [options]', '',
		'Downloads all 114 Abdullah Yusuf Ali translation pages from Alim.org, preserves',
		'each ayah translation and its numbered commentary as Markdown, validates complete',
		'Quran coverage, and imports it transactionally as local tafsir alias yusuf-ali.',
		'Default mode is a read-only DB dry run. --apply rebuilds the targeted commentary index.', '',
		'  --apply                 Import, verify, and rebuild the commentary index',
		'  --dry-run               Validate source and report DB changes only (default)',
		'  --refresh               Redownload all source pages instead of using the cache',
		'  --cache-file <json>     Override data/cache/alim/yusuf-ali.json',
		'  --concurrency <number>  Concurrent source requests (default: 8)',
		'  --batch-size <number>   MySQL insert batch size (default: 200)',
		'  --delay <ms>            Delay after each source request (default: 50)',
		'  --no-index              Skip targeted Elasticsearch indexing after --apply',
		'  --help                  Show this help'
	].join('\n');
}

function normalizeUrl(value) {
	return String(value || '').replace(/\/+$/, '');
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
	countChanges,
	hasUnescapedMarkdownBackticks,
	parseSurahPage,
	reconcileFootnoteLabels,
	readOptions,
	run,
	sourceUrl,
	validateMarkdownFootnotes,
	validatePassages
};
