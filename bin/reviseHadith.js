require('dotenv').config();
require('../lib/Globals');

const MySQL = require('mysql');
const { Library } = require('../lib/Model');
const HadithRevision = require('../lib/HadithRevision');

const DEFAULT_BOOK = '16';

(async () => {
	global.library = await Library.init();

	var options = parseArgs(process.argv.slice(2));
	var items = await findItems(options);
	console.log(`Found ${items.length} hadith(s) to revise.`);

	if (options.dryRun) {
		for (var item of items)
			console.log(`Would revise ${item.ref}`);
		process.exit();
	}

	for (var item of items)
		await revise(item);

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

async function revise(item) {
	try {
		console.log(`Revising ${item.ref}...`);
		await HadithRevision.reviseHadith(item);
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

function printUsage() {
	console.log(
		'Usage:\n' +
		'  node bin/reviseHadith.js\n' +
		'  node bin/reviseHadith.js <from-num0> [limit]\n' +
		'  node bin/reviseHadith.js <book-alias:num>\n' +
		'  node bin/reviseHadith.js --book <id-or-alias> [--from <num0>] [--limit <n>]\n' +
		'  node bin/reviseHadith.js --ref <book-alias:num> [--dry-run]\n' +
		'\n' +
		'Defaults to revising all hadith in book 16 unless you specify a ref or range.'
	);
}
