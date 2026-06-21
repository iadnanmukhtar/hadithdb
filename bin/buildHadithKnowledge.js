#!/usr/bin/env node
/* jslint node:true, esversion:9 */
'use strict';

require('dotenv').config();
const options = readOptions(process.argv.slice(2));

require('../lib/Globals');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const HadithKnowledge = require('../lib/HadithKnowledge');

(async () => {
	try {
		await HadithKnowledge.ensureTable();
		if (options.createIndex)
			await recreateIndex(HadithKnowledge.INDEX);
		if (options.indexOnly) {
			var docs = await HadithKnowledge.indexStored(options);
			log(`indexed ${docs.length} stored knowledge docs`);
			return;
		}
		var rows = await HadithKnowledge.getHadithRows(options);
		log(`building Arabic-rooted knowledge for ${rows.length} hadith(s)`);
		for (var i = 0; i < rows.length; i++) {
			var row = rows[i];
			log(`[${i + 1}/${rows.length}] ${row.ref}`);
			try {
				await HadithKnowledge.buildForHadith(row, {
					model: options.model
				});
			} catch (err) {
				log(`ERROR: unable to build knowledge for ${row.ref}: ${err.message}`);
			}
		}
	} finally {
		global.dbPool.end();
		log('hadith knowledge build complete');
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

function parseArgs(argv) {
	var options = {
		createIndex: false,
		force: false,
		indexOnly: false,
		limit: 100,
		bookId: null,
		fromId: null,
		id: null,
		model: null
	};
	for (var i = 0; i < argv.length; i++) {
		var arg = argv[i];
		if (arg === '--create-index') {
			options.createIndex = true;
		} else if (arg === '--force') {
			options.force = true;
		} else if (arg === '--index-only') {
			options.indexOnly = true;
		} else if (arg === '--limit') {
			options.limit = parsePositiveInt(nextValue(argv, ++i, arg), arg);
		} else if (arg === '--book-id' || arg === '-b') {
			options.bookId = parsePositiveInt(nextValue(argv, ++i, arg), arg);
		} else if (arg === '--from-id') {
			options.fromId = parsePositiveInt(nextValue(argv, ++i, arg), arg);
		} else if (arg === '--id') {
			options.id = parsePositiveInt(nextValue(argv, ++i, arg), arg);
		} else if (arg === '--model') {
			options.model = nextValue(argv, ++i, arg);
		} else if (arg === '--help' || arg === '-h') {
			printUsage();
			process.exit(0);
		} else {
			throw new Error(`Unknown argument: ${arg}`);
		}
	}
	return options;
}

function nextValue(argv, index, arg) {
	if (!argv[index])
		throw new Error(`${arg} requires a value`);
	return argv[index];
}

function parsePositiveInt(value, arg) {
	var num = parseInt(value, 10);
	if (!Number.isInteger(num) || num < 1 || `${num}` !== `${value}`.trim())
		throw new Error(`${arg} requires a positive integer`);
	return num;
}

async function recreateIndex(indexName) {
	const indexURL = `${global.settings.search.domain}/${indexName}`;
	const mappingFile = path.join(__dirname, `elasticsearch-${indexName}-mapping.json`);
	const mappingDoc = JSON.parse(fs.readFileSync(mappingFile).toString());
	const payload = buildCreateIndexPayload(mappingDoc[indexName]);
	if (!payload)
		throw new Error(`Mapping file ${mappingFile} does not define index '${indexName}'`);
	log(`recreating ${indexName} index from ${path.basename(mappingFile)}...`);
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

function buildCreateIndexPayload(indexConfig) {
	if (!indexConfig)
		return null;
	var payload = {
		mappings: indexConfig.mappings || {}
	};
	if (indexConfig.aliases)
		payload.aliases = indexConfig.aliases;
	if (indexConfig.settings)
		payload.settings = indexConfig.settings;
	return payload;
}

function describeAxiosError(err, prefix) {
	var reason = err.response?.data?.error?.root_cause?.[0]?.reason ||
		err.response?.data?.error?.reason ||
		err.response?.data?.message ||
		err.message;
	return new Error(`${prefix}: ${reason}`);
}

function printUsage() {
	console.log(`
Usage:
  node bin/buildHadithKnowledge.js [options]

Build an Arabic-rooted, question-friendly knowledge layer for the hadith chatbot.

Options:
  --create-index       Recreate the Elasticsearch hadith_knowledge index
  --index-only         Index existing rows from MySQL hadiths_knowledge without calling OpenAI
  --force             Rebuild rows even when the Arabic source hash has not changed
  --limit <n>          Number of hadiths to process (default: 100)
  --book-id, -b <id>   Restrict to a book id
  --from-id <id>       Start from a hadith id
  --id <id>            Build one hadith id
  --model <name>       Override OPENAI_KNOWLEDGE_MODEL / OPENAI_MODEL
  --help, -h           Show this help

Examples:
  node bin/buildHadithKnowledge.js --create-index --limit 25
  node bin/buildHadithKnowledge.js --book-id 1 --limit 100
  node bin/buildHadithKnowledge.js --index-only --limit 1000
`.trim());
}

function log(message) {
	console.log(message);
	fs.appendFileSync('buildHadithKnowledge.log', message + '\n');
}
