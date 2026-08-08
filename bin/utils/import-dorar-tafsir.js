#!/usr/bin/env node
/* jslint node:true, esversion:9 */
'use strict';

require('dotenv').config();
const fs = require('fs');
const os = require('os');
const path = require('path');
const mysql = require('mysql');
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');

const BASE_URL = 'https://dorar.net/tafseer';
const CACHE_FILE = path.resolve(__dirname, '../../data/tafsir/dorar.json');
const BOOK = {
	alias: 'dorar-t',
	shortName_en: 'Dorar',
	shortName: 'الدُّرَرُ السَّنِيَّةُ',
	name_en: 'al-Tafsir al-Muharrar',
	name: 'التَّفْسِيرُ المُحَرَّرُ',
	author_en: 'Dorar al-Saniyyah Foundation',
	author: 'مُؤَسَّسَةُ الدُّرَرِ السَّنِيَّةِ',
	description: 'A contemporary, research-based Quran encyclopedia prepared and reviewed by the Dorar al-Saniyyah Foundation. It presents vocabulary, grammar, overall meaning, detailed explanation, educational and scholarly benefits, and Quranic rhetoric.',
	lang: 'ar',
	format: 'md'
};

async function run(argv = process.argv.slice(2)) {
	const options = readOptions(argv);
	const document = readCache(options.cacheFile);
	const browser = await chromium.launch({ channel: options.channel, headless: false });
	try {
		for (let surah = options.fromSurah; surah <= options.toSurah; surah++) {
			if (!document.surahs[surah] || options.overwriteCache)
				document.surahs[surah] = await scrapeSurah(browser, surah, options);
			writeCache(options.cacheFile, document);
			console.log(`Cached surah ${surah}: ${document.surahs[surah].length} passage(s).`);
		}
	} finally {
		await browser.close();
	}

	const passages = Object.values(document.surahs).flat()
		.filter(passage => passage.surah >= options.fromSurah && passage.surah <= options.toSurah)
		.sort((a, b) => a.surah - b.surah || a.ayahFrom - b.ayahFrom);
	validatePassages(passages, options);
	console.log(`Parsed ${passages.length} Dorar passage(s) for surahs ${options.fromSurah}-${options.toSurah}.`);
	if (options.dryRun)
		return;

	const db = await connectDb();
	try {
		await query(db, 'START TRANSACTION');
		const bookId = await upsertBook(db);
		if (options.overwrite)
			await query(db, `DELETE FROM hadiths_commentary WHERE bookId=${bookId} AND surah BETWEEN ${options.fromSurah} AND ${options.toSurah}`);
		await upsertPassages(db, bookId, passages, options.batchSize);
		await query(db, 'COMMIT');
		console.log(`Imported ${passages.length} passage(s) into tafsir alias '${BOOK.alias}'.`);
	} catch (err) {
		try { await query(db, 'ROLLBACK'); } catch (rollbackErr) { /* Preserve original error. */ }
		throw err;
	} finally {
		await closeDb(db);
	}
	if (options.buildIndex)
		execFileSync(process.execPath, [path.resolve(__dirname, '../buildCommentariesIndex.js'), '--tafsir', BOOK.alias], { stdio: 'inherit' });
}

async function scrapeSurah(browser, surah, options) {
	const introPage = await openFreshPage(browser, `${BASE_URL}/${surah}`, options);
	const introduction = await extractArticles(introPage.page);
	await introPage.context.close();
	const firstPage = await openFreshPage(browser, `${BASE_URL}/${surah}/1`, options);
	try {
		const page = firstPage.page;
		const ranges = await page.locator('#sect option').evaluateAll(elements => elements
			.filter(element => Number(element.value) > 0)
			.sort((a, b) => Number(a.value) - Number(b.value))
			.map(element => (element.textContent || '').replace(/\s+/g, ' ').trim()));
		const parsedRanges = ranges.map(parseRangeLabel).filter(Boolean);
		if (!parsedRanges.length)
			throw new Error(`Surah ${surah}: no passage ranges found in #select-options-sect or #sect.`);

		const passages = new Array(parsedRanges.length);
		async function scrapeSection(section, source) {
			try {
				const sectionPage = source.page;
				const current = parseRangeLabel(await selectedRangeLabel(sectionPage));
				const expected = parsedRanges[section - 1];
				if (!current || current.ayahFrom !== expected.ayahFrom || current.ayahTo !== expected.ayahTo)
					throw new Error(`Surah ${surah}, section ${section}: selected range does not match range list.`);
				let text = await extractArticles(sectionPage);
				if (section === 1 && introduction)
					text = `## المقدمة\n\n${introduction}\n\n${text}`;
				passages[section - 1] = { surah, ayahFrom: current.ayahFrom, ayahTo: current.ayahTo, text };
				if (options.delay)
					await new Promise(resolve => setTimeout(resolve, options.delay));
			} finally {
				if (section > 1)
					await source.context.close();
			}
		}
		await scrapeSection(1, firstPage);
		let nextSection = 2;
		const workers = Array.from({ length: Math.min(options.concurrency, parsedRanges.length - 1) }, async () => {
			while (nextSection <= parsedRanges.length) {
				const section = nextSection++;
				const source = await openFreshPage(browser, `${BASE_URL}/${surah}/${section}`, options);
				await scrapeSection(section, source);
			}
		});
		await Promise.all(workers);
		return passages;
	} finally {
		await firstPage.context.close();
	}
}

async function openFreshPage(browser, url, options) {
	let lastError;
	for (let attempt = 1; attempt <= options.retries + 1; attempt++) {
		const context = await browser.newContext({ locale: 'ar-SA' });
		const page = await context.newPage();
		try {
			await openPage(page, url, options.timeout);
			if (/\/tafseer\/[0-9]+\/[1-9][0-9]*$/.test(new URL(url).pathname))
				await page.locator('#sect option:checked').waitFor({ state: 'attached', timeout: options.timeout });
			return { context, page };
		} catch (err) {
			lastError = err;
			await context.close();
			if (attempt <= options.retries)
				await new Promise(resolve => setTimeout(resolve, options.retryDelay * attempt));
		}
	}
	throw lastError;
}

async function openPage(page, url, timeout) {
	const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
	if (!response || response.status() !== 200)
		throw new Error(`${url}: HTTP ${response ? response.status() : 'no response'}.`);
	await page.locator('article').first().waitFor({ state: 'attached', timeout });
}

async function selectedRangeLabel(page) {
	return page.locator('#sect option:checked').evaluate(option => (option.textContent || '').replace(/\s+/g, ' ').trim());
}

async function extractArticles(page) {
	return page.locator('.row.amiri_custom_content article').evaluateAll(articles => articles.map(article => {
		const clone = article.cloneNode(true);
		for (const note of clone.querySelectorAll('[data-content]')) {
			const text = (note.getAttribute('data-content') || '').replace(/\s+/g, ' ').trim();
			note.replaceWith(text ? ` (${text})` : '');
		}
		for (const br of clone.querySelectorAll('br'))
			br.replaceWith('\n');
		for (const element of clone.querySelectorAll('script, style, i, a.sharh, [class*="fa-"]'))
			element.remove();
		const heading = clone.querySelector('h1,h2,h3,h4,h5,h6');
		const title = heading ? (heading.textContent || '').replace(/\s+/g, ' ').trim().replace(/:$/, '') : '';
		if (heading)
			heading.remove();
		const body = (clone.innerText || clone.textContent || '')
			.replace(/\u00a0/g, ' ')
			.replace(/[ \t]+\n/g, '\n')
			.replace(/\n[ \t]+/g, '\n')
			.replace(/[ \t]{2,}/g, ' ')
			.replace(/\n{3,}/g, '\n\n')
			.trim();
		return [title ? `### ${title}` : '', body].filter(Boolean).join('\n\n');
	}).filter(Boolean)).then(blocks => blocks.join('\n\n'));
}

function parseRangeLabel(label) {
	const normalized = toWesternDigits(String(label || '')).replace(/\s+/g, ' ');
	if (/مقدمات? السورة/.test(normalized))
		return null;
	const match = /\(\s*([0-9]+)\s*(?:[-–—]\s*([0-9]+))?\s*\)/.exec(normalized);
	if (!match)
		return null;
	return { ayahFrom: Number(match[1]), ayahTo: Number(match[2] || match[1]) };
}

function toWesternDigits(value) {
	return value.replace(/[٠-٩۰-۹]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit) >= 0
		? '٠١٢٣٤٥٦٧٨٩'.indexOf(digit)
		: '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)));
}

function validatePassages(passages, options) {
	for (let surah = options.fromSurah; surah <= options.toSurah; surah++) {
		const rows = passages.filter(passage => passage.surah === surah);
		if (!rows.length)
			throw new Error(`Surah ${surah}: no cached passages.`);
		if (rows[0].ayahFrom !== 1)
			throw new Error(`Surah ${surah}: first passage starts at ayah ${rows[0].ayahFrom}.`);
		if (!rows[0].text.includes('## المقدمة'))
			throw new Error(`Surah ${surah}: introduction is not part of the first passage.`);
		for (let i = 1; i < rows.length; i++) {
			if (rows[i].ayahFrom !== rows[i - 1].ayahTo + 1)
				throw new Error(`Surah ${surah}: gap or overlap between ${rows[i - 1].ayahTo} and ${rows[i].ayahFrom}.`);
		}
	}
}

async function upsertBook(db) {
	const existing = await query(db, `SELECT id FROM books WHERE alias=${mysql.escape(BOOK.alias)} AND type='tafsir' LIMIT 1`);
	const ordinalRows = await query(db, "SELECT COALESCE(MAX(ordinal), 0) + 1 AS ordinal FROM books WHERE type='tafsir'");
	const ordinal = Number(ordinalRows[0].ordinal);
	if (existing.length) {
		await query(db, `UPDATE books SET type='tafsir', shortName_en=${mysql.escape(BOOK.shortName_en)},
			shortName=${mysql.escape(BOOK.shortName)}, hidden=0, source='local', lang=${mysql.escape(BOOK.lang)},
			format=${mysql.escape(BOOK.format)}, name_en=${mysql.escape(BOOK.name_en)}, author_en=${mysql.escape(BOOK.author_en)},
			title=${mysql.escape(BOOK.name)}, author=${mysql.escape(BOOK.author)}, description=${mysql.escape(BOOK.description)}
			WHERE id=${Number(existing[0].id)}`);
	} else {
		const idRows = await query(db, 'SELECT COALESCE(MAX(id), 0) + 1 AS id FROM books');
		await query(db, `INSERT INTO books
			(id, ordinal, alias, type, shortName_en, shortName, hidden, source, lang, format, name_en, author_en, title, author, description)
			VALUES (${Number(idRows[0].id)}, ${ordinal}, ${mysql.escape(BOOK.alias)}, 'tafsir', ${mysql.escape(BOOK.shortName_en)},
			${mysql.escape(BOOK.shortName)}, 0, 'local', ${mysql.escape(BOOK.lang)}, ${mysql.escape(BOOK.format)},
			${mysql.escape(BOOK.name_en)}, ${mysql.escape(BOOK.author_en)}, ${mysql.escape(BOOK.name)},
			${mysql.escape(BOOK.author)}, ${mysql.escape(BOOK.description)})`);
	}
	const rows = await query(db, `SELECT id FROM books WHERE alias=${mysql.escape(BOOK.alias)} AND type='tafsir' LIMIT 1`);
	if (rows.length !== 1)
		throw new Error(`Unable to create tafsir alias '${BOOK.alias}'.`);
	return rows[0].id;
}

async function upsertPassages(db, bookId, passages, batchSize) {
	const refs = passages.map(passage => `${passage.surah}:${passage.ayahFrom}`);
	const quranRows = await query(db, `SELECT id, num FROM hadiths WHERE bookId=0 AND num IN (${refs.map(mysql.escape).join(',')})`);
	const hadithByRef = new Map(quranRows.map(row => [row.num, row.id]));
	for (let offset = 0; offset < passages.length; offset += batchSize) {
		const batch = passages.slice(offset, offset + batchSize);
		const values = batch.map(passage => {
			const hadithId = hadithByRef.get(`${passage.surah}:${passage.ayahFrom}`);
			if (!hadithId)
				throw new Error(`Missing local Quran row ${passage.surah}:${passage.ayahFrom}.`);
			return `(${bookId}, ${hadithId}, ${passage.surah}, ${passage.ayahFrom}, ${passage.ayahTo}, ${passage.ayahFrom}, ${mysql.escape(passage.text)}, NULL)`;
		});
		await query(db, `INSERT INTO hadiths_commentary
			(bookId, hadithId, surah, ayahFrom, ayahTo, passageNum, text, text_en)
			VALUES ${values.join(',\n')}
			ON DUPLICATE KEY UPDATE hadithId=VALUES(hadithId), passageNum=VALUES(passageNum), text=VALUES(text)`);
	}
}

function readCache(filename) {
	if (!fs.existsSync(filename))
		return { source: BASE_URL, alias: BOOK.alias, surahs: {} };
	const document = JSON.parse(fs.readFileSync(filename, 'utf8'));
	if (!document || !document.surahs)
		throw new Error(`Invalid Dorar cache: ${filename}`);
	document.alias = BOOK.alias;
	return document;
}

function writeCache(filename, document) {
	fs.mkdirSync(path.dirname(filename), { recursive: true });
	fs.writeFileSync(filename, `${JSON.stringify(document, null, 2)}\n`);
}

function readOptions(argv) {
	const options = { fromSurah: 1, toSurah: 114, delay: 100, timeout: 30000, retries: 3, retryDelay: 1500, concurrency: 4, batchSize: 50,
		cacheFile: CACHE_FILE, channel: 'chrome', dryRun: false, overwrite: false, overwriteCache: false, buildIndex: true };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--from-surah') options.fromSurah = numberValue(argv, ++i, arg);
		else if (arg === '--to-surah') options.toSurah = numberValue(argv, ++i, arg);
		else if (arg === '--delay') options.delay = numberValue(argv, ++i, arg, true);
		else if (arg === '--timeout') options.timeout = numberValue(argv, ++i, arg);
		else if (arg === '--retries') options.retries = numberValue(argv, ++i, arg, true);
		else if (arg === '--retry-delay') options.retryDelay = numberValue(argv, ++i, arg, true);
		else if (arg === '--concurrency') options.concurrency = numberValue(argv, ++i, arg);
		else if (arg === '--batch-size') options.batchSize = numberValue(argv, ++i, arg);
		else if (arg === '--cache') options.cacheFile = path.resolve(requiredValue(argv, ++i, arg));
		else if (arg === '--channel') options.channel = requiredValue(argv, ++i, arg);
		else if (arg === '--dry-run') options.dryRun = true;
		else if (arg === '--overwrite') options.overwrite = true;
		else if (arg === '--overwrite-cache') options.overwriteCache = true;
		else if (arg === '--no-index') options.buildIndex = false;
		else if (arg === '--help' || arg === '-h') { console.log(usage()); process.exit(0); }
		else throw new Error(`Unknown option '${arg}'.\n\n${usage()}`);
	}
	if (options.fromSurah < 1 || options.toSurah > 114 || options.fromSurah > options.toSurah)
		throw new Error('Surah range must be within 1-114.');
	return options;
}

function requiredValue(argv, index, option) {
	if (!argv[index] || argv[index].startsWith('--')) throw new Error(`${option} requires a value.`);
	return argv[index];
}

function numberValue(argv, index, option, allowZero = false) {
	const value = Number(requiredValue(argv, index, option));
	if (!Number.isInteger(value) || value < (allowZero ? 0 : 1)) throw new Error(`${option} requires an integer.`);
	return value;
}

function usage() {
	return [
		'Usage: node bin/utils/import-dorar-tafsir.js [options]', '',
		"Scrapes Dorar's range-aware tafsir pages into local alias 'dorar-t'. The surah introduction is prepended to its first passage.", '',
		'  --from-surah <n>    First surah (default: 1)',
		'  --to-surah <n>      Last surah (default: 114)',
		'  --delay <ms>        Delay between passage pages (default: 100)',
		'  --cache <path>      Resumable source cache',
		'  --overwrite-cache   Download already cached surahs again',
		'  --overwrite         Replace imported rows in the selected surahs',
		'  --dry-run           Scrape and validate without writing MySQL',
		'  --no-index          Skip targeted Elasticsearch indexing'
	].join('\n');
}

function appMysqlConnection() {
	try { return require(path.join(os.homedir(), '.hadithdb', 'settings.json')).mysql.connection || {}; }
	catch (err) { return {}; }
}

function connectDb() {
	const configured = appMysqlConnection();
	const db = mysql.createConnection({ host: process.env.MYSQL_HOST || configured.host || '127.0.0.1',
		port: Number(process.env.MYSQL_PORT || configured.port || 3306), user: process.env.MYSQL_USER || configured.user || process.env.USER,
		password: process.env.MYSQL_PASSWORD || configured.password || '', database: process.env.MYSQL_DATABASE || configured.database || 'hadithdb' });
	return new Promise((resolve, reject) => db.connect(err => err ? reject(err) : resolve(db)));
}

function query(db, sql) {
	return new Promise((resolve, reject) => db.query({ sql, timeout: 600000 }, (err, result) => err ? reject(err) : resolve(result)));
}

function closeDb(db) {
	return new Promise((resolve, reject) => db.end(err => err ? reject(err) : resolve()));
}

if (require.main === module)
	run().catch(err => { console.error(`ERROR: ${err.stack || err.message}`); process.exitCode = 1; });

module.exports = { run, parseRangeLabel, validatePassages };
