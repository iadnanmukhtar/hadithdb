#!/usr/bin/env node
/* jslint node:true, esversion:9 */
'use strict';

require('dotenv').config();
require('../../lib/Globals');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const MySQL = require('mysql');

const API_URL = 'https://tafsir.app/get.php';
const CACHE_DIR = path.resolve(__dirname, '../../data/tafsir/tafsir-app');
const DEFAULT_ALIASES = ['aysar-altafasir', 'muyassar', 'altasheel', 'zimneen'];
const ALIAS_MAP = {
	aysar: 'aysar-altafasir'
};
const options = readOptions(process.argv.slice(2));

(async () => {
	try {
		const quran = await loadQuranAyahs();
		for (const alias of options.aliases)
			await loadTafsir(alias, quran);
	} catch (err) {
		console.error(`ERROR: ${err.message}`);
		process.exitCode = 1;
	} finally {
		global.dbPool.end();
	}
})();

async function loadTafsir(alias, quran) {
	const commentary = await getCommentary(alias);
	const existing = await getExistingCounts(commentary.id);
	if (!options.overwrite && commentary.source === 'local' && existing.passageCount === quran.length && existing.textCount === quran.length) {
		console.log(`Skipping '${alias}': already local with ${existing.textCount} populated passage(s).`);
		return;
	}

	const cacheFile = path.join(CACHE_DIR, `${alias}.json`);
	const document = await loadOrDownload(alias, quran, cacheFile);
	const populatedRefs = countPopulatedRefs(document);
	if (!options.overwrite && commentary.source === 'local' && existing.passageCount === populatedRefs && existing.textCount === populatedRefs) {
		console.log(`Skipping '${alias}': already local with ${existing.textCount} populated passage(s).`);
		return;
	}
	if (options.dryRun) {
		console.log(`Checked '${alias}': ${Object.keys(document).length} cached passage(s), ${populatedRefs} populated.`);
		return;
	}

	await upsertLocalPassages(commentary, quran, document);
	await markCommentaryLocal(commentary.id);
	const updated = await getExistingCounts(commentary.id);
	console.log(`Loaded '${alias}' locally: ${updated.textCount}/${updated.passageCount} populated passage(s).`);
}

async function loadOrDownload(alias, quran, cacheFile) {
	ensureDirectory(CACHE_DIR);
	const document = readCache(cacheFile);
	const missing = quran.filter(ayah => !Object.prototype.hasOwnProperty.call(document, ayah.ref));
	if (missing.length === 0) {
		console.log(`Using cached '${alias}' source: ${cacheFile}`);
		return document;
	}

	console.log(`Downloading ${missing.length} '${alias}' passage(s) from tafsir.app...`);
	await downloadMissing(alias, missing, document, cacheFile);
	if (Object.keys(document).length !== quran.length)
		throw new Error(`Expected ${quran.length} cached '${alias}' passages, found ${Object.keys(document).length}.`);
	return document;
}

function readCache(cacheFile) {
	if (!fs.existsSync(cacheFile))
		return {};
	const document = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
	if (!document || Array.isArray(document) || typeof document !== 'object')
		throw new Error(`${cacheFile} must contain a reference keyed object.`);
	return document;
}

async function downloadMissing(alias, missing, document, cacheFile) {
	let next = 0;
	let completed = 0;
	const total = missing.length;
	const workers = [];
	const workerCount = Math.min(options.concurrency, missing.length);
	for (let i = 0; i < workerCount; i++) {
		workers.push((async () => {
			while (next < missing.length) {
				const ayah = missing[next++];
				const text = await getAyahText(alias, ayah.surah, ayah.ayah);
				document[ayah.ref] = { text };
				completed++;
				if (completed % options.saveEvery === 0 || completed === total) {
					writeCache(cacheFile, document);
					console.log(`Downloaded ${completed}/${total} '${alias}' passage(s)...`);
				}
				if (options.delay)
					await sleep(options.delay);
			}
		})());
	}
	await Promise.all(workers);
	writeCache(cacheFile, document);
}

async function getAyahText(alias, surah, ayah) {
	let lastError;
	for (let attempt = 1; attempt <= options.retries + 1; attempt++) {
		try {
			const response = await axios.get(API_URL, {
				params: {
					src: alias,
					s: surah,
					a: ayah,
					ver: 1
				},
				timeout: options.timeout
			});
			const text = String(response.data?.data || '').trim();
			return text;
		} catch (err) {
			lastError = err;
		}
		if (attempt <= options.retries)
			await sleep(options.retryDelay);
	}
	throw new Error(`${alias} ${surah}:${ayah}: ${describeAxiosError(lastError)}`);
}

async function getCommentary(alias) {
	const rows = await global.query(`
		SELECT *
		FROM books
		WHERE alias=${MySQL.escape(alias)}
			AND type='tafsir'
		LIMIT 1`);
	if (rows.length !== 1)
		throw new Error(`Commentary '${alias}' was not found in books.`);
	if (rows[0].lang !== 'ar')
		throw new Error(`Commentary '${alias}' is lang='${rows[0].lang}', expected 'ar'.`);
	return rows[0];
}

async function getExistingCounts(bookId) {
	const rows = await global.query(`
		SELECT
			COUNT(*) AS passageCount,
			SUM(CASE WHEN text IS NOT NULL AND text <> '' THEN 1 ELSE 0 END) AS textCount
		FROM hadiths_commentary
		WHERE bookId=${bookId}`);
	return {
		passageCount: Number(rows[0]?.passageCount || 0),
		textCount: Number(rows[0]?.textCount || 0)
	};
}

async function loadQuranAyahs() {
	const rows = await global.query(`
		SELECT id, num
		FROM hadiths
		WHERE bookId=0
			AND num REGEXP '^[0-9]+:[1-9][0-9]*$'
		ORDER BY id`);
	if (rows.length !== 6236)
		throw new Error(`Expected 6236 Quran ayahs, found ${rows.length}.`);
	return rows.map(row => {
		const location = parseRef(row.num);
		return {
			id: row.id,
			ref: row.num,
			surah: location.surah,
			ayah: location.ayah
		};
	});
}

async function upsertLocalPassages(commentary, quran, document) {
	const populated = quran.filter(ayah => {
		const text = document[ayah.ref]?.text;
		return typeof text === 'string' && text.trim();
	});
	if (populated.length === 0)
		throw new Error(`Cached '${commentary.alias}' source does not contain any populated text.`);
	const batchSize = options.batchSize;
	for (let offset = 0; offset < populated.length; offset += batchSize) {
		const values = populated.slice(offset, offset + batchSize).map(ayah => {
			const text = document[ayah.ref]?.text;
			return `(
				${commentary.id},
				${ayah.id},
				${ayah.surah},
				${ayah.ayah},
				${ayah.ayah},
				${ayah.ayah},
				${MySQL.escape(text.trim())},
				NULL
			)`;
		}).join(',\n');
		await global.query(`
			INSERT INTO hadiths_commentary
				(bookId, hadithId, surah, ayahFrom, ayahTo, passageNum, text, text_en)
			VALUES ${values}
			ON DUPLICATE KEY UPDATE
				hadithId=VALUES(hadithId),
				passageNum=VALUES(passageNum),
				text=VALUES(text),
				text_en=VALUES(text_en)`);
		console.log(`Stored ${Math.min(offset + batchSize, populated.length)}/${populated.length} populated '${commentary.alias}' passage(s)...`);
	}
}

async function markCommentaryLocal(bookId) {
	await global.query(`
		UPDATE books
		SET source='local',
			format='md',
			hidden=0
		WHERE id=${bookId}
			AND type='tafsir'`);
}

function writeCache(cacheFile, document) {
	fs.writeFileSync(cacheFile, `${JSON.stringify(sortRefs(document), null, 2)}\n`);
}

function sortRefs(document) {
	return Object.keys(document).sort(compareRefs).reduce((sorted, ref) => {
		sorted[ref] = document[ref];
		return sorted;
	}, {});
}

function countPopulatedRefs(document) {
	return Object.keys(document).filter(ref => {
		const text = document[ref]?.text;
		return typeof text === 'string' && text.trim();
	}).length;
}

function compareRefs(left, right) {
	const a = parseRef(left);
	const b = parseRef(right);
	return a.surah - b.surah || a.ayah - b.ayah;
}

function parseRef(ref) {
	const match = /^([0-9]+):([0-9]+)$/.exec(ref);
	if (!match)
		throw new Error(`Invalid Quran reference '${ref}'.`);
	return { surah: Number(match[1]), ayah: Number(match[2]) };
}

function ensureDirectory(directory) {
	fs.mkdirSync(directory, { recursive: true });
}

function readOptions(argv) {
	const options = {
		aliases: [],
		concurrency: 4,
		delay: 0,
		retries: 2,
		retryDelay: 1000,
		timeout: 20000,
		saveEvery: 100,
		batchSize: 250,
		overwrite: false,
		dryRun: false
	};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--tafsir')
			options.aliases.push(normalizeAlias(requiredValue(argv, ++i, arg)));
		else if (arg === '--concurrency')
			options.concurrency = positiveInteger(argv, ++i, arg);
		else if (arg === '--delay')
			options.delay = nonNegativeInteger(argv, ++i, arg);
		else if (arg === '--retries')
			options.retries = nonNegativeInteger(argv, ++i, arg);
		else if (arg === '--retry-delay')
			options.retryDelay = nonNegativeInteger(argv, ++i, arg);
		else if (arg === '--timeout')
			options.timeout = positiveInteger(argv, ++i, arg);
		else if (arg === '--save-every')
			options.saveEvery = positiveInteger(argv, ++i, arg);
		else if (arg === '--batch-size')
			options.batchSize = positiveInteger(argv, ++i, arg);
		else if (arg === '--overwrite')
			options.overwrite = true;
		else if (arg === '--dry-run')
			options.dryRun = true;
		else if (arg === '--help' || arg === '-h') {
			console.log(usage());
			process.exit(0);
		} else
			throw new Error(`Unknown option '${arg}'.\n\n${usage()}`);
	}
	if (options.aliases.length === 0)
		options.aliases = DEFAULT_ALIASES;
	return options;
}

function normalizeAlias(alias) {
	return ALIAS_MAP[alias] || alias;
}

function requiredValue(argv, index, option) {
	if (!argv[index] || argv[index].startsWith('--'))
		throw new Error(`${option} requires a value.`);
	return argv[index];
}

function nonNegativeInteger(argv, index, option) {
	const value = Number(requiredValue(argv, index, option));
	if (!Number.isInteger(value) || value < 0)
		throw new Error(`${option} requires a non-negative integer.`);
	return value;
}

function positiveInteger(argv, index, option) {
	const value = nonNegativeInteger(argv, index, option);
	if (value < 1)
		throw new Error(`${option} requires a positive integer.`);
	return value;
}

function describeAxiosError(err) {
	const status = err?.response?.status ? `HTTP ${err.response.status}: ` : '';
	return `${status}${err?.response?.data?.error || err?.message || 'Unknown error'}`;
}

function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function usage() {
	return [
		'Usage: node bin/utils/load-tafsir-app-local.js [options]',
		'',
		'Downloads tafsir.app Arabic sources, caches them, and converts their books rows to local tafsir rows.',
		'',
		'Options:',
		'  --tafsir <alias>       Tafsir alias to load; repeatable. Default: requested tafsirs',
		'  --concurrency <num>    Parallel API requests (default: 4)',
		'  --delay <ms>           Delay after each API request per worker (default: 0)',
		'  --retries <num>        Retries per API request (default: 2)',
		'  --retry-delay <ms>     Delay between retries (default: 1000)',
		'  --timeout <ms>         API timeout (default: 20000)',
		'  --save-every <num>     Cache checkpoint size (default: 100)',
		'  --batch-size <num>     MySQL insert batch size (default: 250)',
		'  --overwrite            Re-store rows even if the tafsir is already local',
		'  --dry-run              Download/validate cache without writing MySQL',
		'  --help                 Show this help'
	].join('\n');
}
