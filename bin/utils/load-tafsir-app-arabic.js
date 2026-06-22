#!/usr/bin/env node
/* jslint node:true, esversion:9 */
'use strict';

require('dotenv').config();
require('../../lib/Globals');
const axios = require('axios');
const MySQL = require('mysql');

const API_URL = 'https://tafsir.app/get.php';
const options = readOptions(process.argv.slice(2));

(async () => {
	try {
		const commentary = await getCommentary(options.target);
		const rows = await getRows(commentary.id, options);
		console.log(
			`${options.dryRun ? 'Checking' : 'Loading'} Arabic tafsir '${options.source}' ` +
			`into '${commentary.alias}' for ${rows.length} passage(s).`
		);

		const result = await processRows(rows, options);
		console.log(
			`${options.dryRun ? 'Would update' : 'Updated'} ${result.updated} passage(s), ` +
			`skipped ${result.skipped}, failed ${result.failed}.`
		);
		if (result.failed)
			process.exitCode = 1;
	} catch (err) {
		console.error(`ERROR: ${err.message}`);
		process.exitCode = 1;
	} finally {
		global.dbPool.end();
	}
})();

async function processRows(rows, options) {
	const result = {
		updated: 0,
		skipped: 0,
		failed: 0
	};
	let next = 0;
	const workerCount = Math.min(options.concurrency, rows.length);
	const workers = [];
	for (let i = 0; i < workerCount; i++) {
		workers.push((async () => {
			while (next < rows.length) {
				const row = rows[next++];
				await processRow(row, options, result);
			}
		})());
	}
	await Promise.all(workers);
	return result;
}

async function processRow(row, options, result) {
	const ref = formatRef(row);
	try {
		const text = await getPassageText(row, options);
		if (!text) {
			result.skipped++;
			console.log(`Skipped ${ref}: API returned no Arabic text.`);
			return;
		}
		if (!options.dryRun)
			await updateRow(row.id, text);
		result.updated++;
		console.log(`${options.dryRun ? 'Would update' : 'Updated'} ${ref}.`);
	} catch (err) {
		result.failed++;
		console.error(`ERROR ${ref}: ${err.message}`);
	}
}

async function getCommentary(alias) {
	const rows = await global.query(`
		SELECT id, alias
		FROM books
		WHERE alias=${MySQL.escape(alias)}
			AND source='local'
			AND type='tafsir'
		LIMIT 1`);
	if (rows.length !== 1)
		throw new Error(`Local commentary '${alias}' was not found.`);
	return rows[0];
}

async function getRows(bookId, options) {
	const where = [`bookId=${bookId}`];
	if (!options.overwrite)
		where.push(`(text IS NULL OR text='')`);
	if (options.fromSurah !== null)
		where.push(`surah >= ${options.fromSurah}`);
	const limit = options.limit === null ? '' : `LIMIT ${options.limit}`;
	return global.query(`
		SELECT id, surah, ayahFrom, ayahTo
		FROM hadiths_commentary
		WHERE ${where.join('\n\t\t\tAND ')}
		ORDER BY surah, ayahFrom, ayahTo
		${limit}`);
}

async function getPassageText(row, options) {
	const texts = [];
	for (let ayah = row.ayahFrom; ayah <= row.ayahTo; ayah++) {
		const text = await getAyahText(row.surah, ayah, options);
		if (text && texts.indexOf(text) < 0)
			texts.push(text);
		if (options.delay)
			await sleep(options.delay);
	}
	return texts.join('\n\n');
}

async function getAyahText(surah, ayah, options) {
	let lastError;
	const maxAttempts = Math.max(options.retries, options.emptyRetries) + 1;
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			const response = await axios.get(API_URL, {
				params: {
					src: options.source,
					s: surah,
					a: ayah,
					ver: 1
				},
				timeout: options.timeout
			});
			const text = String(response.data?.data || '').trim();
			if (text || attempt > options.emptyRetries)
				return text;
			await sleep(options.retryDelay);
		} catch (err) {
			lastError = err;
			if (attempt <= options.retries)
				await sleep(options.retryDelay);
		}
	}
	throw new Error(describeAxiosError(lastError));
}

async function updateRow(id, text) {
	const result = await global.query(`
		UPDATE hadiths_commentary
		SET text=${MySQL.escape(text)}
		WHERE id=${id}`);
	if (result.affectedRows !== 1)
		throw new Error(`Expected to update one row, updated ${result.affectedRows}.`);
}

function readOptions(argv) {
	const options = {
		target: 'en-ibnkathir',
		source: 'ibn-katheer',
		delay: 100,
		retries: 2,
		emptyRetries: 0,
		retryDelay: 1000,
		timeout: 15000,
		concurrency: 1,
		fromSurah: null,
		limit: null,
		dryRun: false,
		overwrite: false
	};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--target')
			options.target = requiredValue(argv, ++i, arg);
		else if (arg === '--source')
			options.source = requiredValue(argv, ++i, arg);
		else if (arg === '--delay')
			options.delay = nonNegativeInteger(argv, ++i, arg);
		else if (arg === '--retries')
			options.retries = nonNegativeInteger(argv, ++i, arg);
		else if (arg === '--empty-retries')
			options.emptyRetries = nonNegativeInteger(argv, ++i, arg);
		else if (arg === '--retry-delay')
			options.retryDelay = nonNegativeInteger(argv, ++i, arg);
		else if (arg === '--timeout')
			options.timeout = positiveInteger(argv, ++i, arg);
		else if (arg === '--concurrency')
			options.concurrency = positiveInteger(argv, ++i, arg);
		else if (arg === '--from-surah')
			options.fromSurah = integerInRange(argv, ++i, arg, 1, 114);
		else if (arg === '--limit')
			options.limit = positiveInteger(argv, ++i, arg);
		else if (arg === '--dry-run')
			options.dryRun = true;
		else if (arg === '--overwrite')
			options.overwrite = true;
		else if (arg === '--help' || arg === '-h') {
			console.log(usage());
			process.exit(0);
		} else
			throw new Error(`Unknown option '${arg}'.\n\n${usage()}`);
	}
	return options;
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

function integerInRange(argv, index, option, min, max) {
	const value = nonNegativeInteger(argv, index, option);
	if (value < min || value > max)
		throw new Error(`${option} requires an integer from ${min} to ${max}.`);
	return value;
}

function describeAxiosError(err) {
	const status = err.response?.status ? `HTTP ${err.response.status}: ` : '';
	return `${status}${err.response?.data?.error || err.message}`;
}

function formatRef(row) {
	return `${row.surah}:${row.ayahFrom}${row.ayahTo > row.ayahFrom ? `-${row.ayahTo}` : ''}`;
}

function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function usage() {
	return [
		'Usage: node bin/utils/load-tafsir-app-arabic.js [options]',
		'',
		"Loads tafsir.app Arabic Ibn Kathir text into missing 'en-ibnkathir' local passages.",
		'',
		'Options:',
		'  --target <alias>       Local tafsir book alias (default: en-ibnkathir)',
		'  --source <alias>       tafsir.app source alias (default: ibn-katheer)',
		'  --from-surah <number>  Start at this surah',
		'  --limit <number>       Process at most this many passages',
		'  --delay <ms>           Delay between API requests (default: 100)',
		'  --retries <number>     Retries per API request (default: 2)',
		'  --empty-retries <num>  Retries for empty API data responses (default: 0)',
		'  --retry-delay <ms>     Delay between retries (default: 1000)',
		'  --timeout <ms>         API timeout (default: 15000)',
		'  --concurrency <number> Parallel passage workers (default: 1)',
		'  --overwrite            Reload rows that already have Arabic text',
		'  --dry-run              Fetch and report without updating MySQL',
		'  --help                 Show this help'
	].join('\n');
}
