#!/usr/bin/env node
'use strict';

require('dotenv').config();
require('../../lib/Globals');

const axios = require('axios');
const childProcess = require('child_process');
const path = require('path');
const Utils = require('../../lib/Utils');
const Books = require('../../lib/Books');
const Tafsir = require('../../lib/Tafsir');
const RuntimeRefresh = require('../../lib/RuntimeRefresh');

const ALIAS = 'muyassar';
const DEFAULT_BATCH_SIZE = 15;
const DEFAULT_CONCURRENCY = 4;
const MAX_ATTEMPTS = 6;
const ARABIC_LETTERS = /[\u0621-\u064A]/u;

function readOptions(args) {
	return {
		dryRun: args.includes('--dry-run'),
		limit: Number((args.find(value => /^\d+$/.test(value)) || 0) || 0)
	};
}

function bookContext(book) {
	return {
		book_alias: book.alias || ALIAS,
		book_title: Utils.trimToEmpty(book.shortName_en || book.name_en || book.title_en || book.shortName || book.title || 'al-Tafsir al-Muyassar'),
		book_title_arabic: Utils.trimToEmpty(book.shortName || book.title || 'التفسير الميسّر'),
		author: Utils.trimToEmpty(book.author_en || book.author || 'a committee of scholars under the King Fahd Complex for the Printing of the Holy Quran'),
		author_arabic: Utils.trimToEmpty(book.author || '')
	};
}

function passageReference(row) {
	const from = Number(row.ayahFrom);
	const to = Number(row.ayahTo);
	return `${row.surah}:${from}${to > from ? `-${to}` : ''}`;
}

function promptForBatch(rows, book) {
	const context = bookContext(book);
	return [
		{
			role: 'system',
			content: `Treat the source as classical Islamic literature and translate it according to its genre and passage context.
The content type is a tafsir passage from al-Tafsir al-Muyassar (التفسير الميسّر), a concise contemporary tafsir of the Quran produced by a committee of scholars under the King Fahd Complex for the Printing of the Holy Quran.
Translate each Arabic tafsir passage into clear, faithful, natural English.
Preserve every statement, name, verse citation, honorific, doctrinal and legal nuance, and paragraph break. Do not summarize, abridge, modernize, harmonize, or add interpretation.
Preserve markdown formatting: headings (including asterisk/bold headings), bullet lists, numbered lists, and blank-line paragraph breaks exactly as in the source.
Translate Quranic words quoted between ﴿ ﴾ into English and keep them inside the same ﴿ ﴾ brackets.
Use conventional scholarly transliteration for names and key terms (including ʿ, ʾ, ā, ī, ū, ḥ, ṣ, ḍ, ṭ, ẓ). Use Makkah and Madinah. In personal names, render ibn/bin as "b." and bint as "bt.".
Keep ﷺ and ؓ exactly as they are.
Return only a JSON object whose keys are the supplied passage IDs and whose values are the complete English translations.`
		},
		{
			role: 'user',
			content: JSON.stringify({
				book: { title: context.book_title, title_arabic: context.book_title_arabic, author: context.author, author_arabic: context.author_arabic },
				passages: Object.fromEntries(rows.map(row => [String(row.id), {
					reference: `muyassar:${passageReference(row)}`,
					text: row.text
				}]))
			})
		}
	];
}

function translationValue(parsed, id) {
	const entry = parsed && parsed[String(id)];
	if (typeof entry === 'string')
		return Utils.trimToEmpty(entry);
	if (entry && typeof entry === 'object')
		return Utils.trimToEmpty(entry.text_en || entry.translation || entry.text || entry.en);
	return '';
}

function parseTranslations(content, rows) {
	const cleaned = Utils.trimToEmpty(content)
		.replace(/^```(?:json)?\s*/i, '')
		.replace(/\s*```$/, '');
	let parsed;
	try {
		parsed = JSON.parse(cleaned);
	} catch (error) {
		throw new Error(`DeepSeek returned invalid JSON: ${error.message}`);
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
		throw new Error('DeepSeek returned a non-object response');
	const translations = new Map();
	for (const row of rows) {
		const id = String(row.id);
		let value = translationValue(parsed, id);
		if (!value)
			throw new Error(`DeepSeek omitted translation for passage id ${id}`);
		if (ARABIC_LETTERS.test(value))
			throw new Error(`Translation still contains Arabic script for passage id ${id}`);
		if (/\[(?:AI|Machine)\]/i.test(value))
			throw new Error(`Translation contains a raw AI marker for passage id ${id}`);
		value = Utils.replacePBUH(`✧ ${value.replace(/^✧\s*/, '')}`);
		for (const mark of ['ﷺ', 'ؓ'])
			if (row.text.includes(mark) && !value.includes(mark))
				throw new Error(`Missing honorific ${mark} for passage id ${id}`);
		translations.set(row.id, value);
	}
	return translations;
}

async function requestTranslations(rows, book) {
	const settings = global.settings.deepSeek || {};
	if (!Utils.isTruthy(settings.key) || !Utils.isTruthy(settings.model))
		throw new Error('settings.deepSeek.key and settings.deepSeek.model are required');
	const response = await axios.post('https://api.deepseek.com/chat/completions', {
		model: settings.model,
		messages: promptForBatch(rows, book),
		response_format: { type: 'json_object' },
		thinking: { type: 'disabled' },
		reasoning_effort: 'none'
	}, {
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${settings.key}`
		},
		timeout: 240000
	});
	return parseTranslations(response.data.choices[0].message.content, rows);
}

async function saveTranslations(translations) {
	const clauses = [];
	const ids = [];
	for (const [id, text] of translations) {
		ids.push(Number(id));
		clauses.push(`WHEN ${Number(id)} THEN ${global.dbPool.escape(text)}`);
	}
	await global.query(`
		UPDATE hadiths_commentary
		SET text_en=CASE id ${clauses.join(' ')} END
		WHERE id IN (${ids.join(',')})
			AND (text_en IS NULL OR TRIM(text_en)='')`);
}

async function translateBatch(rows, book, progress, failures) {
	let lastError;
	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		try {
			const translations = await requestTranslations(rows, book);
			await saveTranslations(translations);
			progress.done += translations.size;
			console.log(`Translated ${progress.done}/${progress.total} (passages ${rows[0].id}-${rows[rows.length - 1].id})`);
			return;
		} catch (error) {
			lastError = error;
			console.error(`Attempt ${attempt}/${MAX_ATTEMPTS} failed for passages ${rows[0].id}-${rows[rows.length - 1].id}: ${error.response?.data?.error?.message || error.message}`);
			if (attempt < MAX_ATTEMPTS)
				await new Promise(resolve => setTimeout(resolve, Math.min(30000, 1000 * (2 ** (attempt - 1)))));
		}
	}
	// Batch failed after all attempts: fall back to one passage per request.
	console.error(`Batch failed after ${MAX_ATTEMPTS} attempts; retrying passages ${rows[0].id}-${rows[rows.length - 1].id} individually.`);
	for (const row of rows) {
		let saved = false;
		for (let attempt = 1; attempt <= 2 && !saved; attempt++) {
			try {
				const translations = await requestTranslations([row], book);
				await saveTranslations(translations);
				progress.done += 1;
				console.log(`Translated ${progress.done}/${progress.total} (passage ${row.id})`);
				saved = true;
			} catch (error) {
				lastError = error;
				console.error(`Individual attempt ${attempt}/2 failed for passage ${row.id}: ${error.response?.data?.error?.message || error.message}`);
				if (attempt < 2)
					await new Promise(resolve => setTimeout(resolve, 2000));
			}
		}
		if (!saved) {
			failures.push(row.id);
			console.error(`SKIPPED passage ${row.id}: ${lastError.message}`);
		}
	}
}

async function loadBook() {
	const rows = await global.query(`
		SELECT id, alias, lang, format, shortName, shortName_en, name, name_en, title, title_en, author, author_en
		FROM books WHERE alias='${Utils.escSQL(ALIAS)}' LIMIT 1`);
	if (!rows.length)
		throw new Error(`Book not found: ${ALIAS}`);
	return rows[0];
}

async function loadRows(limit) {
	const sql = `
		SELECT hc.id, hc.surah, hc.ayahFrom, hc.ayahTo, hc.text
		FROM hadiths_commentary hc
		JOIN books b ON b.id=hc.bookId AND b.alias='${Utils.escSQL(ALIAS)}'
		WHERE (hc.text_en IS NULL OR TRIM(hc.text_en)='')
			AND hc.text IS NOT NULL AND TRIM(hc.text)<>''
		ORDER BY hc.surah, hc.ayahFrom, hc.ayahTo
		${limit > 0 ? `LIMIT ${Number(limit)}` : ''}`;
	return global.query(sql);
}

async function main() {
	const options = readOptions(process.argv.slice(2));
	const book = await loadBook();
	const rows = await loadRows(options.limit);
	console.log(`Found ${rows.length} untranslated '${ALIAS}' passages${options.limit > 0 ? ` (limited to ${options.limit})` : ''}.`);
	const limited = options.limit > 0;
	if (!rows.length)
		return { failures: [], dryRun: options.dryRun, limited };
	if (options.dryRun) {
		console.log('Dry run: no translations requested and no changes applied.');
		return { failures: [], dryRun: true, limited };
	}
	const batchSize = Math.max(1, Number(process.env.MUYASSAR_TRANSLATION_BATCH_SIZE || DEFAULT_BATCH_SIZE));
	const concurrency = Math.max(1, Number(process.env.MUYASSAR_TRANSLATION_CONCURRENCY || DEFAULT_CONCURRENCY));
	const batches = [];
	for (let i = 0; i < rows.length; i += batchSize)
		batches.push(rows.slice(i, i + batchSize));
	const progress = { done: 0, total: rows.length };
	const failures = [];
	let next = 0;
	async function worker() {
		while (next < batches.length) {
			const batch = batches[next++];
			await translateBatch(batch, book, progress, failures);
		}
	}
	await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, worker));
	if (failures.length) {
		console.error(`Completed with ${failures.length} failed passage(s): ${failures.join(', ')}`);
	} else {
		console.log(`Completed all ${progress.done} '${ALIAS}' passage translations.`);
	}
	return { failures, dryRun: options.dryRun, limited: options.limit > 0 };
}

async function markBilingual() {
	await global.query(`UPDATE books SET lang='ar-en' WHERE alias='${Utils.escSQL(ALIAS)}'`);
	await Books.touchBookContentLastmodByAlias(ALIAS);
	console.log(`Marked '${ALIAS}' as bilingual (lang=ar-en).`);
}

function endDbPool() {
	return new Promise((resolve, reject) => {
		global.dbPool.end(err => {
			if (err)
				reject(err);
			else
				resolve();
		});
	});
}

function reindex() {
	const script = path.resolve(__dirname, '../buildCommentariesIndex.js');
	const env = Object.assign({}, process.env, { COMMENTARY_INDEX_BATCH_SIZE: '250' });
	console.log(`Rebuilding the commentary index for '${ALIAS}'...`);
	childProcess.execFileSync(process.execPath, [script, '--tafsir', ALIAS], { stdio: 'inherit', env });
}

async function flushCaches() {
	console.log(`Flushing disk and memory caches for '${ALIAS}'...`);
	Tafsir.invalidateMemoryCaches(ALIAS);
	await Utils.flushBookDiskCache(ALIAS, { strict: true });
	await Utils.flushCacheContaining('tafsirs');
	await Utils.flushCacheContaining('tafsir:books');
	await Utils.flushCacheContaining(`tafsir:${ALIAS}`);
	await Utils.flushCacheContaining(`translation:${ALIAS}`);
	await Utils.flushCacheContaining(ALIAS);
	await Utils.flushCacheContaining(`book:${ALIAS}`);
	const cacheDir = `${require('os').homedir()}/.hadithdb/cache`;
	await Utils.flushCachedFile(`${cacheDir}/_books.html`);
	await Utils.flushCachedFile(`${cacheDir}/_books`);
	const generation = await RuntimeRefresh.publish();
	console.log(`Cache flush complete (runtime generation ${generation}).`);
}

if (require.main === module) {
	(async () => {
		let failures = [];
		let dryRun = false;
		let limited = false;
		try {
			const result = await main();
			failures = result.failures;
			dryRun = result.dryRun;
			limited = result.limited;
		} catch (error) {
			console.error(error.response?.data || error.stack || error);
			process.exit(1);
		}
		if (dryRun || limited) {
			await endDbPool();
			console.log(limited ? 'Limited run complete; skipping bilingual marking, reindex, and cache flush.' : 'Dry run complete; no changes applied.');
			process.exit(0);
		}
		try {
			if (!failures.length)
				await markBilingual();
			await endDbPool();
			reindex();
			await flushCaches();
		} catch (error) {
			console.error(error.stack || error);
			process.exit(1);
		}
	})().catch(error => {
		console.error(error.stack || error);
		process.exit(1);
	});
}

module.exports = { bookContext, parseTranslations, passageReference, promptForBatch, translationValue };
