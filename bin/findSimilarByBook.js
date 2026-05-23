#!/usr/bin/env node
/* jslint node:true, esversion:9 */
'use strict';

require('dotenv').config();
require('../lib/Globals');

const Hadith = require('../lib/Hadith');
const { Library } = require('../lib/Model');

const DEFAULT_BOOK = '16';
const DEFAULT_TABLE = 'hadiths_sim_candidates';
const DELETE_CHUNK_SIZE = 500;

(async () => {
	try {
		var options = parseArgs(process.argv.slice(2));
		global.library = await Library.init();

		var book = null;
		var sourceHadiths = [];
		if (options.id !== null) {
			console.log(`Loading source hadith ${options.id}...`);
			sourceHadiths = await loadSourceHadithById(options.id);
			if (sourceHadiths.length < 1)
				throw new ReferenceError(`Not found: Hadith ${options.id}`);
			book = global.library.findBook(sourceHadiths[0].bookId);
		} else {
			book = global.library.findBook(options.book);
			if (!book)
				throw new ReferenceError(`Not found: Book ${options.book}`);
			console.log(`Loading source hadiths from ${book.alias} (${book.id})...`);
			sourceHadiths = await loadSourceHadiths(book.id, options);
		}
		console.log(`Loaded ${sourceHadiths.length} source hadith(s).`);
		if (sourceHadiths.length < 1) {
			console.log('Nothing to process.');
			return;
		}

		console.log('Loading candidate pool from all books...');
		var candidateHadiths = await loadCandidateHadiths();
		console.log(`Loaded ${candidateHadiths.length} candidate hadith(s).`);

		if (!options.dryRun) {
			var sourceLabel = options.id !== null ? `hadith ${options.id}` : `source book ${book.alias}`;
			console.log(`Clearing existing rows in ${options.table} for ${sourceLabel}...`);
			await deleteExistingRows(sourceHadiths, options.table);
		}

		var summary = await findMatches(sourceHadiths, candidateHadiths, options);
		console.log(
			`Done. Processed ${summary.processed} hadith(s), skipped ${summary.skipped}, ` +
			`found ${summary.matches} total match(es).`
		);
	} catch (err) {
		console.error(err.message);
		process.exitCode = 1;
	} finally {
		global.dbPool.end();
	}
})();

async function loadSourceHadiths(bookId, options) {
	var where = [
		`bookId=${bookId}`,
		`body IS NOT NULL`,
		`body != ''`
	];

	if (options.fromNum0 !== null)
		where.push(`num0 >= ${options.fromNum0}`);

	var sql =
`SELECT id, bookId, ordinal, num, num0, part, body, back_ref, lastmod
FROM hadiths
WHERE ${where.join('\n\tAND ')}
ORDER BY num0, ordinal`;

	if (options.limit !== null)
		sql += `\nLIMIT ${options.limit}`;

	return Hadith.a_dbGetDisemvoweledHadiths(sql);
}

async function loadSourceHadithById(hadithId) {
	var sql =
`SELECT id, bookId, ordinal, num, num0, part, body, back_ref, lastmod
FROM hadiths
WHERE id=${hadithId}
  AND body IS NOT NULL
  AND body != ''
LIMIT 1`;
	return Hadith.a_dbGetDisemvoweledHadiths(sql);
}

async function loadCandidateHadiths() {
	var sql =
`SELECT id, bookId, ordinal, num, num0, part, body, back_ref, lastmod
FROM hadiths
WHERE body IS NOT NULL
  AND body != ''
ORDER BY bookId, ordinal`;
	return Hadith.a_dbGetDisemvoweledHadiths(sql);
}

async function deleteExistingRows(sourceHadiths, tableName) {
	var ids = sourceHadiths.map(hadith => hadith.id);
	for (var i = 0; i < ids.length; i += DELETE_CHUNK_SIZE) {
		var batch = ids.slice(i, i + DELETE_CHUNK_SIZE);
		await global.query(
			`DELETE FROM ${tableName} ` +
			`WHERE hadithId1 IN (${batch.join(',')}) OR hadithId2 IN (${batch.join(',')})`
		);
	}
}

async function findMatches(sourceHadiths, candidateHadiths, options) {
	var summary = {
		processed: 0,
		skipped: 0,
		matches: 0
	};

	for (var i = 0; i < sourceHadiths.length; i++) {
		var sourceHadith = sourceHadiths[i];
		var sourceRef = formatRef(sourceHadith);
		summary.processed++;

		if (shouldSkipSource(sourceHadith)) {
			summary.skipped++;
			console.log(`[${summary.processed}/${sourceHadiths.length}] skipping ${sourceRef}`);
			continue;
		}

		var inserts = [];
		var localMatches = 0;
		for (var j = 0; j < candidateHadiths.length; j++) {
			var candidateHadith = candidateHadiths[j];
			if (sourceHadith.id === candidateHadith.id)
				continue;

			try {
				var match = Hadith.findBestMatch(sourceHadith, candidateHadith);
				if (!match.isMatch)
					continue;

				localMatches++;
				summary.matches++;
				inserts.push(`(${sourceHadith.id}, ${candidateHadith.id}, ${match.bestMatch.rating})`);
				if (options.verbose)
					console.log(`${sourceRef} ~ ${formatRef(candidateHadith)} (${match.bestMatch.rating.toFixed(3)})`);
			} catch (err) {
				console.error(`${sourceRef} ~ ${formatRef(candidateHadith)}\t${err.message}`);
			}
		}

		if (!options.dryRun && inserts.length > 0) {
			await global.query(
				`INSERT INTO ${options.table} (hadithId1, hadithId2, rating) VALUES ${inserts.join(',')}`
			);
		}

		console.log(`[${summary.processed}/${sourceHadiths.length}] ${sourceRef}: ${localMatches} match(es)`);
	}

	return summary;
}

function shouldSkipSource(hadith) {
	return Boolean(
		hadith.body &&
		hadith.body.length < 100 &&
		(
			hadith.body.match(/مثله/) ||
			hadith.body.match(/نحوه/) ||
			hadith.body.match(/الإسناد/) ||
			hadith.back_ref
		)
	);
}

function formatRef(hadith) {
	var book = global.library.findBook(hadith.bookId);
	var bookRef = book ? book.alias : hadith.bookId;
	return `${bookRef}:${hadith.num || hadith.num0}`;
}

function parseArgs(argv) {
	var options = {
		id: null,
		book: DEFAULT_BOOK,
		fromNum0: null,
		limit: null,
		table: DEFAULT_TABLE,
		dryRun: false,
		verbose: false
	};

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
		} else if (arg === '--id') {
			i++;
			if (!argv[i])
				throw new Error(`${arg} requires a hadith id`);
			options.id = parsePositiveInteger(argv[i], arg);
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
		} else if (arg === '--table' || arg === '-t') {
			i++;
			if (!argv[i])
				throw new Error(`${arg} requires a table name`);
			options.table = parseTableName(argv[i]);
		} else if (arg === '--dry-run') {
			options.dryRun = true;
		} else if (arg === '--verbose' || arg === '-v') {
			options.verbose = true;
		} else {
			throw new Error(`Unknown argument: ${arg}`);
		}
	}

	return options;
}

function parseNum0(value, label) {
	var parsed = Number(value);
	if (!Number.isFinite(parsed))
		throw new Error(`${label} must be numeric, got: ${value}`);
	return parsed;
}

function parseLimit(value, label) {
	return parsePositiveInteger(value, label);
}

function parsePositiveInteger(value, label) {
	var parsed = parseInt(value, 10);
	if (!Number.isInteger(parsed) || parsed < 1)
		throw new Error(`${label} must be a positive integer, got: ${value}`);
	return parsed;
}

function parseTableName(value) {
	if (!/^[A-Za-z0-9_]+$/.test(value))
		throw new Error(`Invalid table name: ${value}`);
	return value;
}

function printUsage() {
	console.log(
		'Usage:\n' +
		'  node bin/findSimilarByBook.js\n' +
		'  node bin/findSimilarByBook.js --id 12345\n' +
		'  node bin/findSimilarByBook.js --book 16\n' +
		'  node bin/findSimilarByBook.js --book bazzar --from 1 --limit 100 --dry-run\n' +
		'  node bin/findSimilarByBook.js --book 16 --table hadiths_sim_candidates --verbose\n' +
		'\n' +
		'Defaults to book 16 and searches each source hadith against all hadiths,\n' +
		'including the same book, while excluding the hadith itself.'
	);
}
