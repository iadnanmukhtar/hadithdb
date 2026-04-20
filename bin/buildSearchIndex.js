/* jslint node:true, esversion:9 */
'use strict';

require('dotenv').config();
require('../lib/Globals');
const axios = require('axios');
const fs = require('fs');
const MySQL = require('mysql');
const path = require('path');
const Index = require('../lib/Index');

const options = parseArgs(process.argv.slice(2));

(async () => {
	try {
		var books;
		if (options.bookRefs.length > 0) {
			books = await getSpecifiedBooks(options.bookRefs);
			log(`retrieving data to index for ${books.length} specified book(s)...`);
			await reindexSpecifiedBooks('hadiths', books);
			await reindexSpecifiedBooks('toc', books);
		} else {
			await recreateIndex('hadiths');
			await recreateIndex('toc');
			log(`retrieving data to index...`);
			books = await global.query(`SELECT * FROM books b ORDER BY id`);
			for (var i = 0; i < books.length; i++) {
				await indexDocs('hadiths', books[i]);
				await indexDocs('toc', books[i]);
			}
		}
	} finally {
		global.dbPool.end();
		log('indexing complete');
	}
})();

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
		   OR vh.ordinal = (
				SELECT MIN(v0.ordinal) - 1
				FROM v_hadiths v0
				WHERE v0.book_id = ${book.id}
			)
		   OR vh.ordinal = (
				SELECT MAX(v1.ordinal) + 1
				FROM v_hadiths v1
				WHERE v1.book_id = ${book.id}
			)
		ORDER BY vh.ordinal`);
	return rows;
}

async function indexDocs(indexName, book) {
	log(`\n*****\nindexing ${indexName} for ${book.shortName_en}...`);
	var rows = await getData(indexName, book);
	await Index.updateBulk(indexName, rows, true);
}

async function reindexSpecifiedBooks(indexName, books) {
	for (var i = 0; i < books.length; i++) {
		log(`\n*****\nreindexing ${indexName} for ${books[i].shortName_en}...`);
		await Index.deleteByBook(indexName, books[i]);
		var rows = await getData(indexName, books[i]);
		await Index.updateBulk(indexName, rows, true);
	}
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

async function getSpecifiedBooks(bookRefs) {
	var conditions = bookRefs.map(function (ref) {
		var num = Number(ref);
		if (Number.isInteger(num))
			return `id=${parseInt(ref, 10)}`;
		return `alias=${MySQL.escape(ref)}`;
	});
	var books = await global.query(`
		SELECT *
		FROM books
		WHERE ${conditions.join(' OR ')}
		ORDER BY id`);
	var foundRefs = new Set(books.map(function (book) {
		return `${book.id}`;
	}).concat(books.map(function (book) {
		return `${book.alias}`;
	})));
	var missing = bookRefs.filter(function (ref) {
		return !foundRefs.has(`${ref}`);
	});
	if (missing.length > 0)
		throw new ReferenceError(`Not found: Book ${missing.join(', ')}`);
	return books;
}

function parseArgs(argv) {
	var options = {
		bookRefs: []
	};
	for (var i = 0; i < argv.length; i++) {
		var arg = argv[i];
		if (arg === '--book' || arg === '-b') {
			i++;
			if (!argv[i])
				throw new Error(`${arg} requires one or more book ids or aliases`);
			pushBookRefs(options.bookRefs, argv[i]);
		} else if (arg === '--help' || arg === '-h') {
			printUsage();
			process.exit(0);
		} else if (arg.startsWith('-')) {
			throw new Error(`Unknown argument: ${arg}`);
		} else {
			pushBookRefs(options.bookRefs, arg);
		}
	}
	options.bookRefs = Array.from(new Set(options.bookRefs));
	return options;
}

function pushBookRefs(bookRefs, value) {
	value.split(',').forEach(function (part) {
		part = `${part}`.trim();
		if (part)
			bookRefs.push(part);
	});
}

function printUsage() {
	console.log(
		'Usage:\n' +
		'  node bin/buildSearchIndex.js\n' +
		'  node bin/buildSearchIndex.js --book 16\n' +
		'  node bin/buildSearchIndex.js --book 16,17\n' +
		'  node bin/buildSearchIndex.js --book bazzar --book muslim\n' +
		'\n' +
		'Without --book, recreates the full hadiths and toc indexes.\n' +
		'With --book, deletes and rebuilds only those books in both indexes.'
	);
}
