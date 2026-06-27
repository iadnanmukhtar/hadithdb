#!/usr/bin/env node
require('dotenv').config();
require('../lib/Globals');

const MySQL = require('mysql');
const { Library } = require('../lib/Model');
const HadithRevision = require('../lib/HadithRevision');

const DEFAULT_BOOK = '16';
const DEFAULT_PROVIDER = 'ollama';
const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
const DEFAULT_OLLAMA_MODEL = 'hf.co/goodasdgood/SILMA-9B-Instruct-v1.0-IQ4_NL-GGUF:latest';

(async () => {
	var options = parseArgs(process.argv.slice(2));
	if (!options.ref)
		global.library = await Library.init();
	var items = await findItems(options);
	console.log(`Found ${items.length} hadith(s) to revise with ${revisionLabel(options)}.`);

	if (options.dryRun) {
		for (var item of items)
			console.log(`Would revise ${item.ref}`);
		process.exit();
	}

	for (var item of items)
		await revise(item, options);

	process.exit();
})().catch((e) => {
	console.log(e.message);
	process.exit(1);
});

async function findItems(options) {
	var where = [
		`body IS NOT NULL`,
		`body != ''`
	];

	if (options.ref) {
		where.push(`ref=${MySQL.escape(options.ref)}`);
	} else {
		var book = global.library.findBook(options.book);
		if (!book)
			throw new ReferenceError(`Not found: Book ${options.book}`);
		where.push(`book_id=${book.id}`);
		if (options.fromNum0 !== null)
			where.push(`num0 >= ${options.fromNum0}`);
	}

	var orderBy = options.ref ? 'ordinal' : 'num0, ordinal';
	var sql =
`SELECT * FROM v_hadiths
WHERE ${where.join('\n\tAND ')}
ORDER BY ${orderBy}`;
	if (options.limit !== null)
		sql += `\nLIMIT ${options.limit}`;

	return global.query(sql);
}

async function revise(item, options) {
	try {
		console.log(`Revising ${item.ref}...`);
		await HadithRevision.reviseHadith(item, {
			provider: options.provider,
			model: options.model,
			baseUrl: options.baseUrl,
			timeout: options.timeout,
			syncKnowledge: false
		});
		console.log(`Updated ${item.ref}`);
	} catch (e) {
		console.log(`${item.ref}: ${e.message}`);
	}
}

function parseArgs(argv) {
	var options = {
		book: DEFAULT_BOOK,
		fromNum0: null,
		limit: null,
		ref: null,
		provider: process.env.HADITH_REVISION_PROVIDER || DEFAULT_PROVIDER,
		model: null,
		baseUrl: process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_BASE_URL,
		timeout: Number(process.env.OLLAMA_TIMEOUT_MS) || 300000,
		dryRun: false
	};
	var positional = [];

	for (var i = 0; i < argv.length; i++) {
		var arg = argv[i];
		if (arg === '--help' || arg === '-h') {
			printUsage();
			process.exit(0);
		} else if (arg === '--book' || arg === '-b') {
			i++;
			if (!argv[i])
				throw new Error(`${arg} requires a book id or alias`);
			options.book = argv[i];
		} else if (arg === '--from' || arg === '-f') {
			i++;
			if (!argv[i])
				throw new Error(`${arg} requires a numeric hadith number`);
			options.fromNum0 = parseNum0(argv[i], arg);
		} else if (arg === '--limit' || arg === '-l') {
			i++;
			if (!argv[i])
				throw new Error(`${arg} requires a positive integer`);
			options.limit = parseLimit(argv[i], arg);
		} else if (arg === '--ref' || arg === '-r') {
			i++;
			if (!argv[i])
				throw new Error(`${arg} requires a hadith ref like bazzar:2`);
			options.ref = normalizeRef(argv[i]);
		} else if (arg === '--provider') {
			i++;
			if (!argv[i])
				throw new Error(`${arg} requires openai or ollama`);
			options.provider = normalizeProvider(argv[i]);
		} else if (arg === '--model') {
			i++;
			if (!argv[i])
				throw new Error(`${arg} requires a model name`);
			options.model = argv[i];
		} else if (arg === '--base-url') {
			i++;
			if (!argv[i])
				throw new Error(`${arg} requires an Ollama base URL`);
			options.baseUrl = argv[i];
		} else if (arg === '--timeout') {
			i++;
			if (!argv[i])
				throw new Error(`${arg} requires a timeout in milliseconds`);
			options.timeout = parseLimit(argv[i], arg);
		} else if (arg === '--dry-run') {
			options.dryRun = true;
		} else if (arg.startsWith('-')) {
			throw new Error(`Unknown argument: ${arg}`);
		} else {
			positional.push(arg);
		}
	}

	applyPositionalCompatibility(options, positional);

	if (options.ref && options.fromNum0 !== null)
		throw new Error('Use either an exact ref or a starting hadith number, not both');

	options.provider = normalizeProvider(options.provider);
	if (options.provider === 'ollama' && !options.model)
		options.model = process.env.OLLAMA_HADITH_REVISION_MODEL || process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL;

	return options;
}

function applyPositionalCompatibility(options, positional) {
	if (positional.length < 1)
		return;
	if (positional.length > 2)
		throw new Error(`Too many positional arguments: ${positional.join(' ')}`);

	var first = positional[0];
	if (looksLikeRef(first)) {
		options.ref = normalizeRef(first);
	} else {
		options.fromNum0 = parseNum0(first, 'first positional argument');
	}

	if (positional[1] !== undefined)
		options.limit = parseLimit(positional[1], 'second positional argument');
}

function looksLikeRef(value) {
	return typeof value === 'string' && value.includes(':');
}

function normalizeRef(value) {
	value = `${value}`.trim();
	if (!/^[^:\s]+:\S+$/.test(value))
		throw new Error(`Invalid hadith ref: ${value}`);
	return value;
}

function parseNum0(value, label) {
	var parsed = Number(value);
	if (!Number.isFinite(parsed))
		throw new Error(`${label} must be numeric, got: ${value}`);
	return parsed;
}

function parseLimit(value, label) {
	var parsed = parseInt(value, 10);
	if (!Number.isInteger(parsed) || parsed < 1)
		throw new Error(`${label} must be a positive integer, got: ${value}`);
	return parsed;
}

function normalizeProvider(value) {
	value = `${value}`.trim().toLowerCase();
	if (value !== 'ollama' && value !== 'openai')
		throw new Error(`Provider must be ollama or openai, got: ${value}`);
	return value;
}

function revisionLabel(options) {
	if (options.provider === 'ollama')
		return `Ollama model '${options.model}'`;
	return `OpenAI model '${options.model || 'configured default'}'`;
}

function printUsage() {
	console.log(
		'Usage:\n' +
		'  node bin/reviseHadith.js\n' +
		'  node bin/reviseHadith.js <from-num0> [limit]\n' +
		'  node bin/reviseHadith.js <book-alias:num>\n' +
		'  node bin/reviseHadith.js --book <id-or-alias> [--from <num0>] [--limit <n>]\n' +
		'  node bin/reviseHadith.js --ref <book-alias:num> [--dry-run]\n' +
		'\n' +
		`Defaults to revising all hadith in book 16 with local Ollama model ${DEFAULT_OLLAMA_MODEL} unless you specify a ref or range.\n` +
		'\n' +
		'Options:\n' +
		'  --provider <name>  ollama or openai (default: ollama)\n' +
		`  --model <name>     Model name (default for Ollama: ${DEFAULT_OLLAMA_MODEL})\n` +
		'  --base-url <url>   Ollama base URL (default: http://127.0.0.1:11434)\n' +
		'  --timeout <ms>     Ollama request timeout (default: 300000)\n' +
		'  --dry-run          List matching hadith without model calls or updates'
	);
}
