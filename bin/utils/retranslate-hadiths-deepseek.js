#!/usr/bin/env node
'use strict';

require('dotenv').config();
require('../../lib/Globals');

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const Utils = require('../../lib/Utils');
const RuntimeRefresh = require('../../lib/RuntimeRefresh');

const AHMAD_ID = 8;
const DEFAULT_BATCH_SIZE = 12;
const DEFAULT_CONCURRENCY = 4;
const MAX_ATTEMPTS = 5;
const ARABIC = /[\u0621-\u064A]/u;
const EXCLUDED_ALIASES = new Set(['suyuti', 'ibnhisham']);
const PROGRESS_DIR = path.resolve('var/imports/retranslate-hadiths');

function readOptions(args) {
	const options = {
		dryRun: args.includes('--dry-run'),
		limit: 0,
		books: [],
		batchSize: DEFAULT_BATCH_SIZE,
		concurrency: DEFAULT_CONCURRENCY
	};
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === '--limit' && args[i + 1]) {
			options.limit = Number(args[i + 1]);
			i++;
		} else if (arg === '--books' && args[i + 1]) {
			options.books = String(args[i + 1]).split(',').map(value => value.trim()).filter(Boolean);
			i++;
		} else if (arg === '--batch-size' && args[i + 1]) {
			options.batchSize = Number(args[i + 1]);
			i++;
		} else if (arg === '--concurrency' && args[i + 1]) {
			options.concurrency = Number(args[i + 1]);
			i++;
		} else if (/^\d+$/.test(arg)) {
			options.limit = Number(arg);
		}
	}
	options.batchSize = Math.max(1, Number(options.batchSize) || DEFAULT_BATCH_SIZE);
	options.concurrency = Math.max(1, Number(options.concurrency) || DEFAULT_CONCURRENCY);
	return options;
}

async function loadTargetBooks(options) {
	if (options.books.length) {
		const wanted = options.books.slice();
		const rows = await global.query(
			`SELECT id, alias, type, hidden, shortName_en, name_en, author_en
			 FROM books WHERE alias IN (${wanted.map(alias => global.dbPool.escape(alias)).join(',')})`
		);
		const byAlias = new Map(rows.map(book => [book.alias, book]));
		return wanted.map(alias => byAlias.get(alias)).filter(Boolean);
	}
	const rows = await global.query(`
		SELECT id, alias, type, hidden, shortName_en, name_en, author_en
		FROM books
		WHERE id=${AHMAD_ID} OR (id>${AHMAD_ID} AND type='hadith' AND hidden=0)
		ORDER BY CASE WHEN id=${AHMAD_ID} THEN 0 ELSE 1 END, id`);
	return rows.filter(book => book && !EXCLUDED_ALIASES.has(book.alias));
}

function bookContext(book) {
	return {
		book_alias: book.alias,
		book_title: Utils.trimToEmpty(book.shortName_en || book.name_en || book.title_en || book.shortName || book.title),
		author: Utils.trimToEmpty(book.author_en || book.author || '')
	};
}

function promptForBatch(rows, book) {
	const context = bookContext(book);
	const hadiths = {};
	for (const row of rows) {
		hadiths[String(row.id)] = {
			reference: `${book.alias}:${row.num}`,
			chapter: [row.h1_title_en, row.h2_title_en, row.h3_title_en]
				.map(value => Utils.trimToEmpty(value))
				.filter(Boolean)
				.join(' > '),
			matn: row.body
		};
	}
	return [
		{
			role: 'system',
			content: `Treat the source as classical Islamic hadith literature.
The content type is a hadith matn (the narrated text itself) from ${context.book_title}${context.author ? ` by ${context.author}` : ''}.
Translate each Arabic matn into clear, faithful, natural English.
Preserve every statement, name, honorific, qualification, uncertainty, repetition, and paragraph break. Do not summarize, abridge, modernize, harmonize, fact-check, or add interpretation.
Use conventional scholarly transliteration for names and key terms. Use Makkah and Madinah. In personal names, render ibn/bin as "b." and bint as "bt.".
Keep ﷺ and ؓ exactly as they are. Render عليه السلام as (peace be upon him).
Use the supplied book and chapter context only to disambiguate technical terminology, names, pronouns, and the scope of the matn; do not translate, summarize, or output the context unless that information appears in the matn.
Return only a JSON object whose keys are the supplied hadith IDs and whose values are the complete English translations.`
		},
		{
			role: 'user',
			content: JSON.stringify({ book: { title: context.book_title, author: context.author }, hadiths })
		}
	];
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
		const entry = parsed[id];
		let value = typeof entry === 'string'
			? entry
			: (entry && typeof entry === 'object' ? (entry.body_en || entry.translation || entry.text || entry.en) : '');
		value = Utils.trimToEmpty(value);
		if (!value)
			throw new Error(`DeepSeek omitted translation for hadith id ${id}`);
		if (ARABIC.test(value))
			throw new Error(`Translation still contains Arabic script for hadith id ${id}`);
		if (/\[(?:AI|Machine)\]/i.test(value))
			throw new Error(`Translation contains a raw AI marker for hadith id ${id}`);
		value = Utils.normalizeArabicHonorifics(`✧ ${value.replace(/^✧\s*/, '')}`);
		for (const mark of ['ﷺ', 'ؓ'])
			if (row.body.includes(mark) && !value.includes(mark))
				throw new Error(`Missing honorific ${mark} for hadith id ${id}`);
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

async function saveTranslations(book, translations) {
	const clauses = [];
	const ids = [];
	for (const [id, text] of translations) {
		ids.push(Number(id));
		clauses.push(`WHEN ${Number(id)} THEN ${global.dbPool.escape(text)}`);
	}
	await global.query(`
		UPDATE hadiths
		SET body_en=CASE id ${clauses.join(' ')} END,
			temp_trans=1,
			lastmod=NOW()
		WHERE id IN (${ids.join(',')})`);
}

function progressFilePath(alias) {
	return path.join(PROGRESS_DIR, `${alias}.done`);
}

function loadDone(alias) {
	try {
		if (!fs.existsSync(progressFilePath(alias)))
			return new Set();
		const content = fs.readFileSync(progressFilePath(alias), 'utf8');
		return new Set(content.split('\n').map(value => value.trim()).filter(Boolean).map(Number));
	} catch (error) {
		return new Set();
	}
}

function markDone(alias, ids) {
	fs.mkdirSync(PROGRESS_DIR, { recursive: true });
	fs.appendFileSync(progressFilePath(alias), `${ids.map(id => String(id)).join('\n')}\n`);
}

async function loadRows(book, options) {
	const sql = `
		SELECT h.id, h.num, h.body,
			b.alias AS book_alias, b.shortName_en AS book_shortName_en, b.name_en AS book_name_en, b.author_en AS book_author_en,
			t1.title_en AS h1_title_en, t1.title AS h1_title,
			t2.title_en AS h2_title_en, t2.title AS h2_title,
			t3.title_en AS h3_title_en, t3.title AS h3_title
		FROM hadiths h
		JOIN books b ON b.id=h.bookId
		LEFT JOIN toc t1 ON t1.bookId=h.bookId AND t1.level=1 AND t1.h1=h.h1
		LEFT JOIN toc t2 ON t2.bookId=h.bookId AND t2.level=2 AND t2.h1=h.h1 AND t2.h2=h.h2
		LEFT JOIN toc t3 ON t3.bookId=h.bookId AND t3.level=3 AND t3.h1=h.h1 AND t3.h2=h.h2 AND t3.h3=h.h3
		WHERE h.bookId=${Number(book.id)}
			AND h.lastfixed IS NULL
			AND h.body IS NOT NULL AND TRIM(h.body)<>''
		ORDER BY h.ordinal, h.id
		${options.limit > 0 ? `LIMIT ${options.limit}` : ''}`;
	return global.query(sql);
}

async function translateBatch(book, rows, progress, failures) {
	let lastError;
	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		try {
			const translations = await requestTranslations(rows, book);
			await saveTranslations(book, translations);
			markDone(book.alias, rows.map(row => Number(row.id)));
			progress.done += translations.size;
			console.log(`[${book.alias}] translated ${progress.done}/${progress.total} (ids ${rows[0].id}-${rows[rows.length - 1].id})`);
			return;
		} catch (error) {
			lastError = error;
			console.error(`[${book.alias}] attempt ${attempt}/${MAX_ATTEMPTS} failed ids ${rows[0].id}-${rows[rows.length - 1].id}: ${error.response?.data?.error?.message || error.message}`);
			if (attempt < MAX_ATTEMPTS)
				await new Promise(resolve => setTimeout(resolve, Math.min(30000, 1000 * (2 ** (attempt - 1)))));
		}
	}
	console.error(`[${book.alias}] batch failed after ${MAX_ATTEMPTS} attempts; retrying ids ${rows[0].id}-${rows[rows.length - 1].id} individually.`);
	for (const row of rows) {
		let saved = false;
		for (let attempt = 1; attempt <= 2 && !saved; attempt++) {
			try {
				const translations = await requestTranslations([row], book);
				await saveTranslations(book, translations);
				markDone(book.alias, [Number(row.id)]);
				progress.done += 1;
				console.log(`[${book.alias}] translated ${progress.done}/${progress.total} (id ${row.id})`);
				saved = true;
			} catch (error) {
				lastError = error;
				console.error(`[${book.alias}] individual attempt ${attempt}/2 failed id ${row.id}: ${error.response?.data?.error?.message || error.message}`);
				if (attempt < 2)
					await new Promise(resolve => setTimeout(resolve, 2000));
			}
		}
		if (!saved) {
			failures.push(row.id);
			console.error(`[${book.alias}] SKIPPED id ${row.id}: ${lastError.message}`);
		}
	}
}

async function processBook(book, options) {
	const done = loadDone(book.alias);
	const rows = await loadRows(book, options);
	const pending = rows.filter(row => !done.has(Number(row.id)));
	console.log(`[${book.alias}] ${pending.length} hadiths to translate${options.dryRun ? ' (dry run)' : ''}${options.limit > 0 ? ` (limited to ${options.limit})` : ''}.`);
	if (!pending.length || options.dryRun)
		return { alias: book.alias, id: book.id, total: pending.length, translated: 0, failed: [] };
	const batches = [];
	for (let i = 0; i < pending.length; i += options.batchSize)
		batches.push(pending.slice(i, i + options.batchSize));
	const progress = { done: 0, total: pending.length };
	const failures = [];
	let next = 0;
	async function worker() {
		while (next < batches.length) {
			const batch = batches[next++];
			await translateBatch(book, batch, progress, failures);
		}
	}
	await Promise.all(Array.from({ length: Math.min(options.concurrency, batches.length) }, worker));
	return { alias: book.alias, id: book.id, total: pending.length, translated: progress.done, failed: failures };
}

async function flushCaches(touchedAliases) {
	console.log('Flushing caches for touched books...');
	for (const alias of touchedAliases) {
		await Utils.flushCacheContaining(alias, { strict: false });
		await Utils.flushCacheContaining(`book:${alias}`, { strict: false });
	}
	await RuntimeRefresh.publish();
}

async function main() {
	const options = readOptions(process.argv.slice(2));
	const books = await loadTargetBooks(options);
	console.log(`Target books (${books.length}): ${books.map(book => `${book.alias}#${book.id}`).join(', ')}`);
	const touched = [];
	let grand = { total: 0, translated: 0, failed: [] };
	for (const book of books) {
		const result = await processBook(book, options);
		grand.total += result.total;
		grand.translated += result.translated;
		for (const id of result.failed)
			grand.failed.push(`${book.alias}:${id}`);
		if (!options.dryRun && result.translated > 0) {
			touched.push(book.alias);
			await global.query(`UPDATE books SET content_lastmod=NOW() WHERE id=${Number(book.id)}`);
		}
	}
	console.log(`\nSummary: ${grand.total} hadiths scanned, ${grand.translated} translated, ${grand.failed.length} failed.`);
	if (grand.failed.length)
		console.error(`Failed ids:\n${grand.failed.join('\n')}`);
	if (!options.dryRun && touched.length) {
		await flushCaches(touched);
		console.log('Done. Rebuild the hadith search index before serving the new translations.');
	}
	return { options, grand };
}

function endDbPool() {
	return new Promise((resolve, reject) => {
		global.dbPool.end(error => (error ? reject(error) : resolve()));
	});
}

if (require.main === module) {
	(async () => {
		try {
			const result = await main();
			await endDbPool();
			process.exit(result.options.dryRun || result.grand.failed.length ? (result.grand.failed.length ? 2 : 0) : 0);
		} catch (error) {
			console.error(error.response?.data || error.stack || error);
			await endDbPool().catch(() => {});
			process.exit(1);
		}
	})();
}
