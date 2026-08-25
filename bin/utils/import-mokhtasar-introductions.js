#!/usr/bin/env node
/* jslint node:true, esversion:9 */
'use strict';

require('dotenv').config();

const axios = require('axios');
const cheerio = require('cheerio');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const shared = require('./import-alim-maududi-introductions');

const EXPECTED_SURAHS = 114;
const DEFAULT_ALIAS = 'mokhtasar';
const DEFAULT_BOOK_ID = 319;
const DEFAULT_API_URL = 'https://admin.mokhtasr.com/api/v1/book-contents';
const DEFAULT_SOURCE_URL = 'https://mokhtasr.com/en/books/319';
// This read-only token is published in mokhtasr.com's browser bundle.
const DEFAULT_API_TOKEN = '087c2dd4-e1b9-4a0f-9c1e-4ba6e07ed95a';

async function run(argv = process.argv.slice(2)) {
	const options = readOptions(argv);
	if (!options)
		return null;
	const introductions = await loadSource(options);
	const db = await shared.connectDb();
	let result;
	try {
		result = await shared.importIntroductions(db, options, introductions);
	} finally {
		await shared.closeDb(db);
	}
	if (!options.dryRun && options.buildIndex && result.changed) {
		console.log(`Rebuilding the toc index for '${options.alias}' (book ${result.bookId})...`);
		execFileSync(process.execPath, [path.resolve(__dirname, '../buildSearchIndex.js'), '--book-id', String(result.bookId), '--toc-only'], {
			stdio: 'inherit', env: process.env
		});
	}
	return result;
}

async function loadSource(options) {
	const document = options.refresh ? emptyCache(options) : readCache(options);
	const missing = [];
	for (let surah = 1; surah <= EXPECTED_SURAHS; surah++) {
		if (!validCachedIntroduction(document.surahs[surah], surah, options))
			missing.push(surah);
	}
	if (missing.length) {
		console.log(`Downloading ${missing.length} Mokhtasar surah introduction(s) with concurrency ${Math.min(options.concurrency, missing.length)}...`);
		let next = 0;
		let completed = 0;
		const workers = Array.from({ length: Math.min(options.concurrency, missing.length) }, async function () {
			while (next < missing.length) {
				const surah = missing[next++];
				const payload = await fetchIntroduction(surah, options);
				document.surahs[surah] = parseIntroductionResponse(payload, surah, options);
				document.fetchedAt = new Date().toISOString();
				writeCache(options.cacheFile, document);
				completed++;
				if (completed % 10 === 0 || completed === missing.length)
					console.log(`Downloaded ${completed}/${missing.length} missing introduction(s)...`);
				if (options.delay)
					await sleep(options.delay);
			}
		});
		await Promise.all(workers);
	} else {
		console.log(`Using cached Mokhtasar introductions: ${displayPath(options.cacheFile)}`);
	}
	const introductions = Object.values(document.surahs).sort((a, b) => a.surah - b.surah);
	validateSource(introductions, options);
	console.log(`Validated ${introductions.length} Mokhtasar surah introductions.`);
	return introductions;
}

async function fetchIntroduction(surah, options) {
	let lastError;
	for (let attempt = 1; attempt <= options.retries + 1; attempt++) {
		try {
			const response = await axios.get(options.apiUrl, {
				params: { sura: surah, aya: 1, books: options.sourceBookId, lang: 'en' },
				headers: { Authorization: `Bearer ${options.apiToken}`, 'Api-Lang': 'en', 'Device-Id': 'browser' },
				timeout: options.timeout,
				validateStatus: status => status === 200
			});
			return response.data;
		} catch (err) {
			lastError = err;
			if (attempt <= options.retries) {
				const retryAfter = Number(err.response && err.response.headers && err.response.headers['retry-after']);
				await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : options.retryDelay * attempt);
			}
		}
	}
	throw new Error(`Surah ${surah}: ${lastError && lastError.response ? `HTTP ${lastError.response.status}` : lastError.message}`);
}

function parseIntroductionResponse(payload, surah, options = defaultOptions()) {
	const ayah = payload && Array.isArray(payload.data) && payload.data.find(row => Number(row.sura) === Number(surah) && Number(row.aya) === 1);
	const book = ayah && Array.isArray(ayah.books) && ayah.books.find(row => Number(row.language_id) === 4);
	if (!payload || payload.status !== true || !ayah || !book)
		throw new Error(`Surah ${surah}: source response did not contain English book content for ayah 1.`);
	const html = String(book.surrah_intro || '').trim();
	if (!html)
		throw new Error(`Surah ${surah}: source response did not contain surrah_intro.`);
	const breakMarker = 'MOKHTASARINTRODUCTIONBREAK';
	const $ = cheerio.load(html.replace(/<br\s*\/?\s*>/gi, breakMarker), null, false);
	$('script, style, noscript').remove();
	const intro = shared.escapeUnescapedMarkdownBackticks(shared.normalizeMarkdown(
		shared.markdownChildren($, $.root()[0]).split(breakMarker).map(value => value.trim()).filter(Boolean).join('\n\n')
	));
	const sourceText = $.root().text().replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
	if (intro.length < 20 || sourceText.length < 20)
		throw new Error(`Surah ${surah}: introduction was unexpectedly short.`);
	return {
		surah: Number(surah),
		url: sourcePageUrl(options.sourceUrl, surah),
		intro_en: intro,
		sourceTextLength: sourceText.length,
		sha256: crypto.createHash('sha256').update(intro).digest('hex')
	};
}

function validateSource(introductions, options = defaultOptions()) {
	if (!Array.isArray(introductions) || introductions.length !== EXPECTED_SURAHS)
		throw new Error(`Expected ${EXPECTED_SURAHS} Mokhtasar introductions, found ${introductions ? introductions.length : 0}.`);
	const seen = new Set();
	for (const introduction of introductions) {
		const surah = Number(introduction.surah);
		if (!Number.isInteger(surah) || surah < 1 || surah > EXPECTED_SURAHS || seen.has(surah))
			throw new Error(`Invalid or duplicate Mokhtasar introduction surah '${introduction.surah}'.`);
		seen.add(surah);
		if (!validCachedIntroduction(introduction, surah, options))
			throw new Error(`Invalid cached Mokhtasar introduction for surah ${surah}.`);
	}
}

function validCachedIntroduction(value, surah, options) {
	return Boolean(value && Number(value.surah) === Number(surah) && value.url === sourcePageUrl(options.sourceUrl, surah) &&
		typeof value.intro_en === 'string' && value.intro_en.length >= 20 && Number(value.sourceTextLength) >= 20 &&
		/^[a-f0-9]{64}$/.test(value.sha256 || '') && crypto.createHash('sha256').update(value.intro_en).digest('hex') === value.sha256);
}

function sourcePageUrl(baseUrl, surah) {
	return `${String(baseUrl).replace(/\/+$/, '')}?sura=${Number(surah)}&aya=1&lang=1`;
}

function defaultOptions() {
	return { sourceUrl: DEFAULT_SOURCE_URL, sourceBookId: DEFAULT_BOOK_ID };
}

function readOptions(argv) {
	const options = {
		alias: DEFAULT_ALIAS, sourceBookId: DEFAULT_BOOK_ID, apiUrl: DEFAULT_API_URL, sourceUrl: DEFAULT_SOURCE_URL,
		apiToken: process.env.MOKHTASAR_API_TOKEN || DEFAULT_API_TOKEN,
		cacheFile: path.resolve(__dirname, '../../data/tafsir/mokhtasar-introductions.json'),
		concurrency: 1, timeout: 30000, retries: 3, retryDelay: 1000, delay: 800,
		refresh: false, dryRun: true, buildIndex: true,
		importUser: 'import-mokhtasar-intros', lockName: 'hadithdb:import-mokhtasar:intros'
	};
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		if (arg === '--alias') options.alias = requiredValue(argv, ++index, arg);
		else if (arg === '--cache-file') options.cacheFile = path.resolve(process.cwd(), requiredValue(argv, ++index, arg));
		else if (arg === '--concurrency') options.concurrency = positiveInteger(requiredValue(argv, ++index, arg), arg);
		else if (arg === '--timeout') options.timeout = positiveInteger(requiredValue(argv, ++index, arg), arg);
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

function emptyCache(options) {
	return { schemaVersion: 1, source: options.sourceUrl, bookId: options.sourceBookId, fetchedAt: null, surahs: {} };
}

function readCache(options) {
	if (!fs.existsSync(options.cacheFile)) return emptyCache(options);
	try {
		const document = JSON.parse(fs.readFileSync(options.cacheFile, 'utf8'));
		if (document && document.schemaVersion === 1 && document.source === options.sourceUrl && Number(document.bookId) === options.sourceBookId && document.surahs)
			return document;
	} catch (err) {
		console.warn(`Ignoring unreadable Mokhtasar cache: ${err.message}`);
	}
	return emptyCache(options);
}

function writeCache(filename, document) {
	fs.mkdirSync(path.dirname(filename), { recursive: true });
	const temporary = `${filename}.${process.pid}.tmp`;
	fs.writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`);
	fs.renameSync(temporary, filename);
}

function requiredValue(argv, index, option) {
	if (!argv[index] || argv[index].startsWith('--')) throw new Error(`${option} requires a value.`);
	return argv[index];
}
function positiveInteger(value, option) {
	const number = Number(value); if (!Number.isInteger(number) || number < 1) throw new Error(`${option} must be positive.`); return number;
}
function nonNegativeInteger(value, option) {
	const number = Number(value); if (!Number.isInteger(number) || number < 0) throw new Error(`${option} must be non-negative.`); return number;
}
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function displayPath(filename) { const relative = path.relative(process.cwd(), filename); return relative && !relative.startsWith('..') ? relative : filename; }
function usage() {
	return [
		'Usage: node bin/utils/import-mokhtasar-introductions.js [options]', '',
		"Downloads the English surrah_intro preceding ayah 1 for all 114 surahs and imports it into mokhtasar's toc.intro_en.",
		'The default mode downloads, validates, and performs a read-only database dry run.', '',
		'  --apply                  Import, verify, and rebuild the targeted toc index',
		'  --dry-run                Report changes only (default)',
		'  --refresh                Download all 114 introductions again',
		'  --no-index               Skip the targeted toc index rebuild',
		'  --cache-file <json>      Override the ignored local source cache',
		'  --concurrency <number>   Concurrent downloads (default: 1)',
		'  --delay <ms>             Delay after each request (default: 800)'
	].join('\n');
}

if (require.main === module) run().catch(err => { console.error(`ERROR: ${err.stack || err.message}`); process.exitCode = 1; });

module.exports = { parseIntroductionResponse, readOptions, run, sourcePageUrl, validateSource };
