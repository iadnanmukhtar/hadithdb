/* jslint node:true, esversion:9 */
'use strict';

require('dotenv').config();
require('../lib/Globals');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const Index = require('../lib/Index');

(async () => {
	try {
		await recreateIndex('hadiths');
		await recreateIndex('toc');
		log(`retreiving data to index...`);
		var books = await global.query(`SELECT * FROM books b ORDER BY id`);
		for (var i = 0; i < books.length; i++) {
			await indexDocs('hadiths', books[i]);
			await indexDocs('toc', books[i]);
		}
	} finally {
		global.dbPool.end();
		log('indexing complete');
	}
})();

async function getData(indexName, book) {
	var rows = await global.query(`
		SELECT * FROM v_${indexName}
		WHERE
			book_id = ${book.id}
		ORDER BY 
			book_id, h1, numInChapter
		-- LIMIT 10`);
	return rows;
}

async function indexDocs(indexName, book) {
	log(`\n*****\nindexing ${indexName} for ${book.shortName_en}...`);
	var rows = await getData(indexName, book);
	await Index.updateBulk(indexName, rows, true);
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
