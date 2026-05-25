/* jslint node:true, esversion:9 */
'use strict';

require('dotenv').config();
const options = readOptions(process.argv.slice(2));

require('../lib/Globals');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const Index = require('../lib/Index');

(async () => {
	try {
		var indexNames = getIndexNames(options);
		var books;
		if (options.all) {
			for (var i = 0; i < indexNames.length; i++)
				await recreateIndex(indexNames[i]);
			log(`retrieving data to index ${formatIndexNames(indexNames)}...`);
			books = await global.query(`SELECT * FROM books b ORDER BY id`);
			await indexBooks(books, indexNames);
		} else {
			books = await getBooksFromId(options.bookId);
			log(`retrieving data to index ${formatIndexNames(indexNames)} from book id ${options.bookId} (${books.length} book(s))...`);
			for (var j = 0; j < indexNames.length; j++)
				await reindexBooks(indexNames[j], books);
		}
	} finally {
		global.dbPool.end();
		log('indexing complete');
	}
})();

function readOptions(argv) {
	try {
		return parseArgs(argv);
	} catch (err) {
		console.error(`Error: ${err.message}\n`);
		printUsage();
		process.exit(1);
	}
}

async function getData(indexName, book) {
	if (indexName === 'hadiths')
		return await getHadithData(book);
	var rows = await global.query(`
		SELECT * FROM v_${indexName}
		WHERE
			book_id = ${book.id}
		ORDER BY 
			book_id, h1, numInChapter
		-- LIMIT 10`);
	return rows;
}

async function getHadithData(book) {
	var rows = await global.query(`
		SELECT
			vh.*,
			p.hId AS prevId,
			p.ref AS prev_ref,
			p.path AS prev_path,
			n.hId AS nextId,
			n.ref AS next_ref,
			n.path AS next_path
		FROM v_hadiths vh
		LEFT JOIN v_hadiths p
			ON p.ordinal = vh.ordinal - 1
		LEFT JOIN v_hadiths n
			ON n.ordinal = vh.ordinal + 1
		WHERE vh.book_id = ${book.id}
		ORDER BY vh.ordinal`);
	return rows;
}

async function indexDocs(indexName, book) {
	var skipReason = getSkipIndexReason(indexName, book);
	if (skipReason) {
		log(`\n*****\nskipping ${indexName} for ${book.shortName_en}; ${skipReason}...`);
		return;
	}
	log(`\n*****\nindexing ${indexName} for ${book.shortName_en}...`);
	var rows = await getData(indexName, book);
	await Index.updateBulk(indexName, rows, true);
}

async function indexBooks(books, indexNames) {
	for (var i = 0; i < books.length; i++) {
		for (var j = 0; j < indexNames.length; j++)
			await indexDocs(indexNames[j], books[i]);
	}
}

async function reindexBooks(indexName, books) {
	for (var i = 0; i < books.length; i++) {
		log(`\n*****\nreindexing ${indexName} for ${books[i].shortName_en}...`);
		await Index.deleteByBook(indexName, books[i]);
		var skipReason = getSkipIndexReason(indexName, books[i]);
		if (skipReason) {
			log(`skipping ${indexName} for ${books[i].shortName_en}; ${skipReason}`);
			continue;
		}
		var rows = await getData(indexName, books[i]);
		await Index.updateBulk(indexName, rows, true);
	}
}

function getSkipIndexReason(indexName, book) {
	if (book.hidden == 1)
		return 'hidden books are not indexed';
	if (indexName === 'hadiths' && book.virtual == 1)
		return 'virtual books only index toc';
	return null;
}

function getIndexNames(options) {
	if (options.tocOnly)
		return ['toc'];
	return ['hadiths', 'toc'];
}

function formatIndexNames(indexNames) {
	return indexNames.join(' and ');
}

async function recreateIndex(indexName) {
	const indexURL = `${global.settings.search.domain}/${indexName}`;
	const mappingFile = path.join(__dirname, `elasticsearch-${indexName}-mapping.json`);
	const mappingDoc = JSON.parse(fs.readFileSync(mappingFile).toString());
	const payload = buildCreateIndexPayload(mappingDoc[indexName]);
	if (!payload)
		throw new Error(`Mapping file ${mappingFile} does not define index '${indexName}'`);
	log(`\n*****\nrecreating ${indexName} index from ${path.basename(mappingFile)}...`);
	try {
		await axios.delete(indexURL, {
			headers: {
				'Content-Type': 'application/json'
			}
		});
	} catch (err) {
		if (err.response?.status !== 404)
			throw describeAxiosError(err, `Unable to delete index '${indexName}'`);
	}
	try {
		await axios.put(indexURL, payload, {
			headers: {
				'Content-Type': 'application/json'
			}
		});
	} catch (err) {
		throw describeAxiosError(err, `Unable to create index '${indexName}'`);
	}
}

function log(message) {
	console.log(message);
	fs.appendFileSync('buildSearchIndex.log', message + '\n');
}

function buildCreateIndexPayload(indexConfig) {
	if (!indexConfig)
		return null;
	var payload = {
		mappings: indexConfig.mappings || {}
	};
	if (indexConfig.aliases)
		payload.aliases = indexConfig.aliases;
	var settings = sanitizeIndexSettings(indexConfig.settings);
	if (Object.keys(settings).length > 0)
		payload.settings = settings;
	return payload;
}

function sanitizeIndexSettings(settings) {
	if (!settings)
		return {};
	var clean = {};
	if (settings.analysis)
		clean.analysis = settings.analysis;
	if (settings.index) {
		clean.index = {};
		if (settings.index.number_of_shards !== undefined)
			clean.index.number_of_shards = settings.index.number_of_shards;
		if (settings.index.number_of_replicas !== undefined)
			clean.index.number_of_replicas = settings.index.number_of_replicas;
		if (settings.index.routing)
			clean.index.routing = settings.index.routing;
		if (Object.keys(clean.index).length < 1)
			delete clean.index;
	}
	return clean;
}

function describeAxiosError(err, prefix) {
	var reason = err.response?.data?.error?.root_cause?.[0]?.reason ||
		err.response?.data?.error?.reason ||
		err.response?.data?.message ||
		err.message;
	return new Error(`${prefix}: ${reason}`);
}

async function getBooksFromId(bookId) {
	var books = await global.query(`
		SELECT *
		FROM books
		WHERE id >= ${bookId}
		ORDER BY id`);
	if (books.length < 1)
		throw new ReferenceError(`Not found: Book id ${bookId} or later`);
	return books;
}

function parseArgs(argv) {
	var options = {
		all: false,
		bookId: null,
		tocOnly: false
	};
	for (var i = 0; i < argv.length; i++) {
		var arg = argv[i];
		if (arg === '--all') {
			options.all = true;
		} else if (arg === '--toc-only' || arg === '--toc') {
			options.tocOnly = true;
		} else if (arg === '--book-id' || arg === '--from-book-id' || arg === '-b') {
			i++;
			if (!argv[i])
				throw new Error(`${arg} requires a book id`);
			options.bookId = parseBookId(argv[i], arg);
		} else if (arg === '--help' || arg === '-h') {
			printUsage();
			process.exit(0);
		} else if (arg.startsWith('-')) {
			throw new Error(`Unknown argument: ${arg}`);
		} else {
			throw new Error(`Unexpected positional argument: ${arg}`);
		}
	}
	if (options.all && options.bookId !== null)
		throw new Error(`Use either --all or --book-id, not both`);
	if (!options.all && options.bookId === null)
		throw new Error(`Missing required argument: use --all or --book-id <id>`);
	return options;
}

function parseBookId(value, arg) {
	var bookId = parseInt(value, 10);
	if (!Number.isInteger(bookId) || bookId < 0 || `${bookId}` !== `${value}`.trim())
		throw new Error(`${arg} requires a non-negative integer book id`);
	return bookId;
}

function printUsage() {
	console.log(
		'Usage:\n' +
		'  node bin/buildSearchIndex.js --all\n' +
		'  node bin/buildSearchIndex.js --book-id 16\n' +
		'  node bin/buildSearchIndex.js --all --toc-only\n' +
		'  node bin/buildSearchIndex.js --book-id 16 --toc-only\n' +
		'\n' +
		'--all recreates the full hadiths and toc indexes, then indexes every book.\n' +
		'--book-id deletes and rebuilds both indexes for that book id and every later book id.\n' +
		'--toc-only only recreates or rebuilds the toc index.'
	);
}
