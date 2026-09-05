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
const Tafsir = require('../lib/Tafsir');
const Books = require('../lib/Books');
const Utils = require('../lib/Utils');
const QuranTocSubdivisions = require('../lib/QuranTocSubdivisions');
const CommentaryTranslationIndexFields = require('../lib/CommentaryTranslationIndexFields');
const SearchHttp = require('../lib/SearchHttp');

const INDEX = 'commentaries';
const options = readOptions(process.argv.slice(2));
let dbPoolEnded = false;
let translationIndexFields = Object.freeze({ languages: [], columns: [], selectSql: '', joinSql: '' });

(async () => {
	try {
		// Globals starts this preload without exposing its promise. Awaiting the
		// idempotent preload here prevents this one-shot script from closing the
		// shared pool while the metadata queries are still in flight.
		await QuranTocSubdivisions.preload();
		await ensureIndexExists();
		translationIndexFields = await CommentaryTranslationIndexFields.loadIndexFields();
		if (options.alias) {
			await reindexCommentaryAlias(options.alias);
			return;
		}
		const rows = await getCommentaries(options.alias);
		rows.forEach(normalizeCommentaryRow);
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
	if (!options.noDelete)
		await deleteExistingDocumentsByAlias(alias);
	const batchSize = Number(process.env.COMMENTARY_INDEX_BATCH_SIZE || 250);
	let indexed = 0;
	let lastId = options.afterId || 0;
	while (true) {
		const rows = await getCommentaries(alias, batchSize, null, true, lastId);
		if (rows.length < 1)
			break;
		rows.forEach(normalizeCommentaryRow);
		await Index.updateBulk(INDEX, rows, false);
		indexed += rows.length;
		lastId = rows[rows.length - 1].id;
		console.log(`indexed ${Math.min(indexed, total)}/${total} '${alias}' passages on ${INDEX}`);
	}
	await endDbPool();
	await Index.refresh(INDEX);
	await Utils.flushCacheContaining(`tafsir:${alias}`);
	console.log('commentaries index complete');
}

function normalizeCommentaryRow(row) {
	['text', 'text_en', 'footnotes', 'footnotes_en', ...translationIndexFields.columns].forEach(column => {
		row[column] = Tafsir.stripPageMarkers(row[column]);
	});
	return row;
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
	const commentaryJoin = await Books.commentaryJoin('bc', 'hc');
	const sql = `
		SELECT COUNT(*) AS total
		FROM ${commentaryJoin.from}
		${commentaryJoin.join}
		WHERE bc.source='local'
			AND bc.hidden=0
			AND ${commentaryJoin.typePredicate}
			${options.changedSince ? `AND hc.lastmod>=${global.dbPool.escape(options.changedSince)}` : ''}
			AND bc.alias=${global.dbPool.escape(alias)}`;
	const rows = freshConnection ? await freshQuery(sql) : await global.query(sql);
	return rows[0]?.total || 0;
}

async function getCommentaries(alias, limit, offset, freshConnection, afterId) {
	if (Number.isInteger(afterId))
		return getCommentariesByIdBatch(alias, limit, afterId, freshConnection);
	const commentaryJoin = await Books.commentaryJoin('bc', 'hc');
	const sql = `
		SELECT
			hc.id,
			hc.id AS hId,
				'commentary' AS doctype,
				0 AS book_id,
				0 AS book_ordinal,
				'quran' AS book_alias,
				bc.ordinal AS ordinal,
				${commentaryJoin.bookIdSelect},
				bc.alias AS commentary_alias,
				bc.type AS commentary_type,
				bc.lang,
				bc.source,
				bc.format,
			hc.hadithId,
			hc.surah,
			hc.ayahFrom,
			hc.ayahTo,
			hc.passageNum,
			q.h1,
			q.h1_title_en,
			q.h1_title,
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
			hc.footnotes_en
			${translationIndexFields.selectSql ? `,\n\t\t\t${translationIndexFields.selectSql}` : ''},
			hc.created,
			hc.lastmod
		FROM ${commentaryJoin.from}
		${commentaryJoin.join}
		JOIN v_hadiths q ON q.id=hc.hadithId
		${translationIndexFields.joinSql}
		WHERE bc.source='local'
			AND bc.hidden=0
			AND ${commentaryJoin.typePredicate}
			${alias ? `AND bc.alias=${global.dbPool.escape(alias)}` : ''}
			${Number.isInteger(afterId) && afterId > 0 ? `AND hc.id>${afterId}` : ''}
		ORDER BY ${Number.isInteger(afterId) ? 'hc.id' : 'bc.id, hc.surah, hc.ayahFrom, hc.ayahTo'}
		${Number.isInteger(limit) ? `LIMIT ${limit}` : ''}
		${Number.isInteger(offset) ? `OFFSET ${offset}` : ''}`;
	return freshConnection ? await freshQuery(sql) : await global.query(sql);
}

async function getCommentariesByIdBatch(alias, limit, afterId, freshConnection) {
	const query = freshConnection ? freshQuery : global.query;
	const commentaryJoin = await Books.commentaryJoin('bc', 'hc');
	const rows = await query(`
		SELECT
			hc.id,
			hc.id AS hId,
				'commentary' AS doctype,
				0 AS book_id,
				0 AS book_ordinal,
				'quran' AS book_alias,
				bc.ordinal AS ordinal,
				${commentaryJoin.bookIdSelect},
				bc.alias AS commentary_alias,
				bc.type AS commentary_type,
				bc.lang,
				bc.source,
				bc.format,
			hc.hadithId,
			hc.surah,
			hc.ayahFrom,
			hc.ayahTo,
			hc.passageNum,
			CONCAT('quran:', hc.surah, ':', hc.ayahFrom,
				IF(hc.ayahTo > hc.ayahFrom, CONCAT('-', hc.ayahTo), '')) AS ref,
			CONCAT('quran:', hc.surah, ':', hc.ayahFrom,
				IF(hc.ayahTo > hc.ayahFrom, CONCAT('-', hc.ayahTo), '')) AS path,
			hc.text,
			hc.text_en,
			hc.footnotes,
			hc.footnotes_en
			${translationIndexFields.selectSql ? `,\n\t\t\t${translationIndexFields.selectSql}` : ''},
			hc.created,
			hc.lastmod
		FROM ${commentaryJoin.from}
		${commentaryJoin.join}
		${translationIndexFields.joinSql}
		WHERE bc.source='local'
			AND bc.hidden=0
			AND ${commentaryJoin.typePredicate}
			AND bc.alias=${global.dbPool.escape(alias)}
			${options.changedSince ? `AND hc.lastmod>=${global.dbPool.escape(options.changedSince)}` : ''}
			AND hc.id>${parseInt(afterId, 10)}
		ORDER BY hc.id
		${Number.isInteger(limit) ? `LIMIT ${limit}` : ''}`);
	if (rows.length < 1)
		return rows;
	const qRows = await query(`
		SELECT id AS qId, h1, h1_title_en, h1_title, h2, h2_id, h2_title_en, h2_title, path AS section_path
		FROM v_hadiths
		WHERE id IN (${rows.map(row => parseInt(row.hadithId, 10)).filter(Number.isFinite).join(',')})`);
	const qById = new Map(qRows.map(row => [row.qId, row]));
	rows.forEach(row => {
		const qRow = Object.assign({}, qById.get(row.hadithId) || {});
		delete qRow.qId;
		Object.assign(row, qRow);
	});
	return rows;
}

function freshQuery(sql) {
	const attempts = 3;
	return freshQueryWithRetry(sql, attempts);
}

async function freshQueryWithRetry(sql, attempts) {
	let lastError = null;
	for (let attempt = 1; attempt <= attempts; attempt++) {
		try {
			return await freshQueryOnce(sql);
		} catch (err) {
			lastError = err;
			if (attempt === attempts)
				break;
			console.warn(`fresh MySQL query failed attempt ${attempt}/${attempts}: ${err.message}; retrying`);
		}
	}
	throw lastError;
}

function freshQueryOnce(sql) {
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
		await axios.head(indexURL, SearchHttp.axiosConfig());
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
		await axios.put(indexURL, mappingDoc[INDEX], SearchHttp.axiosConfig());
	} catch (err) {
		throw describeAxiosError(err, `Unable to create index '${INDEX}'`);
	}
}

async function deleteExistingDocuments() {
	try {
		await axios.post(`${global.settings.search.domain}/${INDEX}/_delete_by_query`, {
			query: { match_all: {} }
		}, SearchHttp.axiosConfig());
	} catch (err) {
		throw describeAxiosError(err, `Unable to clear index '${INDEX}'`);
	}
}

async function deleteExistingDocumentsByAlias(alias) {
	try {
		await axios.post(`${global.settings.search.domain}/${INDEX}/_delete_by_query`, {
			query: { term: { commentary_alias: alias } }
		}, SearchHttp.axiosConfig());
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
	const options = { alias: null, noDelete: false, afterId: 0, changedSince: null };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--tafsir') {
			options.alias = argv[++i];
			if (!options.alias)
				throw new Error('--tafsir requires a commentary alias.');
		} else if (arg === '--no-delete') {
			options.noDelete = true;
		} else if (arg === '--after-id') {
			options.afterId = parseInt(argv[++i], 10);
			if (!Number.isFinite(options.afterId))
				throw new Error('--after-id requires a numeric hadiths_commentary id.');
		} else if (arg === '--changed-since') {
			options.changedSince = argv[++i];
			if (!options.changedSince || Number.isNaN(Date.parse(options.changedSince)))
				throw new Error('--changed-since requires an ISO date/time.');
			options.noDelete = true;
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
		'  --no-delete       Do not delete existing docs before indexing the alias',
		'  --after-id <id>   With --tafsir, resume rows after a hadiths_commentary id',
		'  --changed-since <date>  Reindex only passages modified since an ISO date/time',
		'  --help            Show this help'
	].join('\n');
}
