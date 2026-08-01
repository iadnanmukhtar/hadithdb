#!/usr/bin/env node
/* jslint node:true, esversion:9 */
'use strict';

require('dotenv').config();
const options = readOptions(process.argv.slice(2));

require('../lib/Globals');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const HadithTranslationIndexView = require('../lib/HadithTranslationIndexView');
const Index = require('../lib/Index');
const SearchHttp = require('../lib/SearchHttp');

(async () => {
	try {
		// Populate the in-memory surah cache so toc indexing can attach surah
		// search aliases (Index.appendQuranSurahSearchAliases -> Surahs.find).
		// This entry point does not call Library.init, so load explicitly.
		await require('../lib/Surahs').load();
		var indexNames = getIndexNames(options);
		var books;
		for (var i = 0; i < indexNames.length; i++)
			await ensureIndexExists(indexNames[i]);
		if (indexNames.includes('hadiths')) {
			var viewUpdate = await HadithTranslationIndexView.ensureBaseView();
			if (viewUpdate.updated)
				log('v_hadiths restored to base view without generated translation columns');
			var translationIndexFields = await HadithTranslationIndexView.loadIndexFields();
			log(`hadith translation index fields ready for ${translationIndexFields.languages.length} language(s)`);
		}
		if (options.all) {
			log(`retrieving data to index ${formatIndexNames(indexNames)}...`);
			books = await global.query(`SELECT * FROM books b ORDER BY id`);
		} else {
			books = await getBooks(options);
			log(`retrieving data to index ${formatIndexNames(indexNames)} ${formatBookScope(options)} (${books.length} book(s))...`);
		}
		await reindexBooks(books, indexNames);
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
	var orderBy = indexName === 'toc' ? 'ordinal' : 'book_id, h1, numInChapter';
	var rows = await global.query(`
		SELECT * FROM v_${indexName}
		WHERE
			book_id = ${book.id}
		ORDER BY 
			${orderBy}
		-- LIMIT 10`);
	return rows;
}

async function getHadithData(book) {
	// Index.updateBulk(..., true) derives prev/next refs from this ordered book-scoped row list.
	var rows = await global.query(`
		SELECT *
		FROM v_hadiths
		WHERE book_id = ${book.id}
		ORDER BY ordinal`);
	if (Number(book.id) === 0)
		await attachQuranScriptWords(rows);
	return rows;
}

async function attachQuranScriptWords(rows) {
	const byRef = new Map((rows || []).map(row => [row.num, row]));
	const words = await global.query(`
		SELECT script_slug, surah, ayah, word, text
		FROM quran_corpus_script_words
		WHERE script_slug IN ('indo-pak', 'warsh')
		ORDER BY script_slug, surah, ayah, word`);
	words.forEach(word => {
		const row = byRef.get(`${word.surah}:${word.ayah}`);
		if (!row)
			return;
		const field = word.script_slug === 'indo-pak' ? 'quran_words_indopak' : 'quran_words_warsh';
		if (!row[field])
			row[field] = [];
		row[field].push(word.text);
	});
}

async function reindexBooks(books, indexNames) {
	for (var i = 0; i < books.length; i++) {
		for (var j = 0; j < indexNames.length; j++) {
			var indexName = indexNames[j];
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

async function ensureIndexExists(indexName) {
	const indexURL = `${global.settings.search.domain}/${indexName}`;
	const mappingFile = path.join(__dirname, `elasticsearch-${indexName}-mapping.json`);
	const mappingDoc = JSON.parse(fs.readFileSync(mappingFile).toString());
	const payload = buildCreateIndexPayload(mappingDoc[indexName]);
	if (!payload)
		throw new Error(`Mapping file ${mappingFile} does not define index '${indexName}'`);
	try {
		await axios.head(indexURL, SearchHttp.axiosConfig({
			headers: {
				'Content-Type': 'application/json'
			}
		}));
		log(`${indexName} index already exists`);
		await ensureIndexMapping(indexName, mappingDoc[indexName]);
		return;
	} catch (err) {
		if (err.response?.status !== 404)
			throw describeAxiosError(err, `Unable to check index '${indexName}'`);
	}
	log(`\n*****\ncreating missing ${indexName} index from ${path.basename(mappingFile)}...`);
	try {
		await axios.put(indexURL, payload, SearchHttp.axiosConfig({
			headers: {
				'Content-Type': 'application/json'
			}
		}));
	} catch (err) {
		throw describeAxiosError(err, `Unable to create index '${indexName}'`);
	}
}

async function ensureIndexMapping(indexName, indexConfig) {
	const properties = indexConfig && indexConfig.mappings && indexConfig.mappings.properties;
	if (!properties)
		return;
	try {
		const mappingResponse = await axios.get(`${global.settings.search.domain}/${indexName}/_mapping`, SearchHttp.axiosConfig());
		const current = mappingResponse.data?.[indexName]?.mappings?.properties || {};
		const missing = {};
		Object.keys(properties).forEach(field => {
			if (!Object.prototype.hasOwnProperty.call(current, field))
				missing[field] = properties[field];
		});
		if (Object.keys(missing).length < 1)
			return;
		await axios.put(`${global.settings.search.domain}/${indexName}/_mapping`, { properties: missing }, SearchHttp.axiosConfig({
			headers: { 'Content-Type': 'application/json' }
		}));
		log(`added ${Object.keys(missing).length} field(s) to ${indexName} mapping`);
	} catch (err) {
		throw describeAxiosError(err, `Unable to update mapping for index '${indexName}'`);
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
		if (settings.index.mapping?.total_fields?.limit !== undefined)
			clean.index.mapping = { total_fields: { limit: settings.index.mapping.total_fields.limit } };
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

async function getBooks(options) {
	var operator = options.fromBookId ? '>=' : '=';
	var books = await global.query(`
		SELECT *
		FROM books
		WHERE id ${operator} ${options.bookId}
		ORDER BY id`);
	if (books.length < 1)
		throw new ReferenceError(`Not found: Book id ${options.bookId}${options.fromBookId ? ' or later' : ''}`);
	return books;
}

function formatBookScope(options) {
	return options.fromBookId ? `from book id ${options.bookId}` : `for book id ${options.bookId}`;
}

function parseArgs(argv) {
	var options = {
		all: false,
		bookId: null,
		fromBookId: false,
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
			options.fromBookId = arg === '--from-book-id';
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
		throw new Error(`Use either --all, --book-id, or --from-book-id`);
	if (!options.all && options.bookId === null)
		throw new Error(`Missing required argument: use --all, --book-id <id>, or --from-book-id <id>`);
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
		'  node bin/buildSearchIndex.js --from-book-id 16\n' +
		'  node bin/buildSearchIndex.js --all --toc-only\n' +
		'  node bin/buildSearchIndex.js --book-id 16 --toc-only\n' +
		'\n' +
		'Missing indexes are created from the checked-in mappings. Existing indexes are never deleted.\n' +
		'--all rebuilds each book independently.\n' +
		'--book-id rebuilds only the requested book id.\n' +
		'--from-book-id rebuilds the requested book id and every later book id.\n' +
		'--toc-only only rebuilds the toc index.'
	);
}
