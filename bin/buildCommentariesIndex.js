#!/usr/bin/env node
/* jslint node:true, esversion:9 */
'use strict';

require('dotenv').config();
require('../lib/Globals');
const axios = require('axios');
const fs = require('fs');
const MySQL = require('mysql');
const path = require('path');
const Index = require('../lib/Index');

const INDEX = 'commentaries';
const options = readOptions(process.argv.slice(2));
let dbPoolEnded = false;

(async () => {
	try {
		await ensureIndexExists();
		if (options.alias) {
			await reindexCommentaryAlias(options.alias);
			return;
		}
		const rows = await getCommentaries(options.alias);
		await endDbPool();
		console.log(`indexing ${rows.length} local commentary passages${options.alias ? ` for '${options.alias}'` : ''}...`);
		await deleteExistingDocuments();
		await Index.updateBulk(INDEX, rows, false);
		await Index.refresh(INDEX);
		console.log('commentaries index complete');
	} catch (err) {
		console.error(`ERROR: ${err.message}`);
		process.exitCode = 1;
	} finally {
		if (!dbPoolEnded)
			await endDbPool();
	}
})();

async function reindexCommentaryAlias(alias) {
	const total = await countCommentaries(alias, true);
	console.log(`indexing ${total} local commentary passages for '${alias}'...`);
	await deleteExistingDocumentsByAlias(alias);
	const batchSize = 250;
	for (let offset = 0; offset < total; offset += batchSize) {
		const rows = await getCommentaries(alias, batchSize, offset, true);
		if (rows.length < 1)
			break;
		await Index.updateBulk(INDEX, rows, false);
		console.log(`indexed ${Math.min(offset + rows.length, total)}/${total} '${alias}' passages on ${INDEX}`);
	}
	await endDbPool();
	await Index.refresh(INDEX);
	console.log('commentaries index complete');
}

function endDbPool() {
	return new Promise((resolve, reject) => {
		global.dbPool.end(err => {
			if (err)
				reject(err);
			else {
				dbPoolEnded = true;
				resolve();
			}
		});
	});
}

async function countCommentaries(alias, freshConnection) {
	const sql = `
		SELECT COUNT(*) AS total
		FROM books_commentaries bc
		JOIN hadiths_commentary hc ON hc.bookCommentaryId=bc.id
		WHERE bc.source='local'
			AND bc.hidden=0
			AND bc.alias=${global.dbPool.escape(alias)}`;
	const rows = freshConnection ? await freshQuery(sql) : await global.query(sql);
	return rows[0]?.total || 0;
}

async function getCommentaries(alias, limit, offset, freshConnection) {
	const sql = `
		SELECT
			hc.id,
			hc.id AS hId,
			'commentary' AS doctype,
			0 AS book_id,
			0 AS book_ordinal,
			'quran' AS book_alias,
			bc.ordinal AS ordinal,
			bc.id AS bookCommentaryId,
			bc.alias AS commentary_alias,
			bc.shortName AS commentary_shortName,
			bc.shortName_en AS commentary_shortName_en,
			bc.name AS commentary_name,
			bc.name_en AS commentary_name_en,
			bc.author AS commentary_author,
			bc.author_en AS commentary_author_en,
			bc.death AS commentary_author_death,
			bc.lang,
			bc.source,
			bc.format,
			hc.hadithId,
			hc.surah,
			hc.ayahFrom,
			hc.ayahTo,
			hc.passageNum,
			q.h1,
			q.h2,
			q.h2_id,
			q.h2_title_en,
			q.h2_title,
			q.path AS section_path,
			CONCAT('quran:', hc.surah, ':', hc.ayahFrom,
				IF(hc.ayahTo > hc.ayahFrom, CONCAT('-', hc.ayahTo), '')) AS ref,
			CONCAT('quran:', hc.surah, ':', hc.ayahFrom,
				IF(hc.ayahTo > hc.ayahFrom, CONCAT('-', hc.ayahTo), '')) AS path,
			hc.text,
			hc.text_en,
			hc.footnotes,
			hc.footnotes_en,
			hc.created,
			hc.lastmod
		FROM books_commentaries bc
		JOIN hadiths_commentary hc ON hc.bookCommentaryId=bc.id
		JOIN v_hadiths q ON q.id=hc.hadithId
		WHERE bc.source='local'
			AND bc.hidden=0
			${alias ? `AND bc.alias=${global.dbPool.escape(alias)}` : ''}
		ORDER BY bc.id, hc.surah, hc.ayahFrom, hc.ayahTo
		${Number.isInteger(limit) ? `LIMIT ${limit}` : ''}
		${Number.isInteger(offset) ? `OFFSET ${offset}` : ''}`;
	return freshConnection ? await freshQuery(sql) : await global.query(sql);
}

function freshQuery(sql) {
	const connection = MySQL.createConnection(global.settings.mysql.connection);
	return new Promise((resolve, reject) => {
		connection.query({ sql, timeout: 600000 }, (err, result) => {
			connection.destroy();
			err ? reject(err) : resolve(result);
		});
	});
}

async function ensureIndexExists() {
	const indexURL = `${global.settings.search.domain}/${INDEX}`;
	try {
		await axios.head(indexURL);
		console.log(`${INDEX} index already exists`);
		return;
	} catch (err) {
		if (err.response?.status !== 404)
			throw describeAxiosError(err, `Unable to check index '${INDEX}'`);
	}
	const mappingFile = path.join(__dirname, `elasticsearch-${INDEX}-mapping.json`);
	const mappingDoc = JSON.parse(fs.readFileSync(mappingFile).toString());
	if (!mappingDoc[INDEX])
		throw new Error(`Mapping file ${mappingFile} does not define index '${INDEX}'`);
	console.log(`creating missing ${INDEX} index from ${path.basename(mappingFile)}...`);
	try {
		await axios.put(indexURL, mappingDoc[INDEX]);
	} catch (err) {
		throw describeAxiosError(err, `Unable to create index '${INDEX}'`);
	}
}

async function deleteExistingDocuments() {
	try {
		await axios.post(`${global.settings.search.domain}/${INDEX}/_delete_by_query`, {
			query: { match_all: {} }
		});
	} catch (err) {
		throw describeAxiosError(err, `Unable to clear index '${INDEX}'`);
	}
}

async function deleteExistingDocumentsByAlias(alias) {
	try {
		await axios.post(`${global.settings.search.domain}/${INDEX}/_delete_by_query`, {
			query: { term: { commentary_alias: alias } }
		});
	} catch (err) {
		throw describeAxiosError(err, `Unable to clear index '${INDEX}' for '${alias}'`);
	}
}

function describeAxiosError(err, prefix) {
	const reason = err.response?.data?.error?.root_cause?.[0]?.reason ||
		err.response?.data?.error?.reason ||
		err.response?.data?.message ||
		err.message;
	return new Error(`${prefix}: ${reason}`);
}

function readOptions(argv) {
	const options = { alias: null };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--tafsir') {
			options.alias = argv[++i];
			if (!options.alias)
				throw new Error('--tafsir requires a commentary alias.');
		} else if (arg === '--help' || arg === '-h') {
			console.log(usage());
			process.exit(0);
		} else
			throw new Error(`Unknown option '${arg}'.\n\n${usage()}`);
	}
	return options;
}

function usage() {
	return [
		'Usage: node bin/buildCommentariesIndex.js [options]',
		'',
		'Rebuilds the local Quran commentaries Elasticsearch index.',
		'',
		'Options:',
		'  --tafsir <alias>  Reindex only one local commentary alias',
		'  --help            Show this help'
	].join('\n');
}
