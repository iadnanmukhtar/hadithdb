#!/usr/bin/env node
/* jslint node:true, esversion:11 */
'use strict';

require('dotenv').config();
const childProcess = require('child_process');
const fs = require('fs');
const mysql = require('mysql');
const os = require('os');
const path = require('path');
const util = require('util');
const Utils = require('../../lib/Utils');

async function main() {
	const options = readOptions(process.argv.slice(2));
	const settings = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.hadithdb', 'settings.json'), 'utf8'));
	const connection = mysql.createConnection(settings.mysql.connection);
	const query = util.promisify(connection.query).bind(connection);
	const changedHadithIds = new Set();
	const changedTocBookIds = new Set();
	const changedTafsirBookIds = new Set();
	let replacements = 0;
	try {
		const columns = await englishColumns(query);
		if (options.apply) await query('START TRANSACTION');
		for (const column of columns) {
			const table = mysql.escapeId(column.TABLE_NAME);
			const field = mysql.escapeId(column.COLUMN_NAME);
			const where = `${field} LIKE '%[Machine]%'`;
			const count = Number((await query(`SELECT COUNT(*) count FROM ${table} WHERE ${where}`))[0].count);
			if (!count) continue;
			replacements += count;
			console.log(`${options.apply ? 'Updating' : 'Would update'} ${column.TABLE_NAME}.${column.COLUMN_NAME}: ${count} row(s)`);
			await collectIndexScopes(query, column.TABLE_NAME, where, changedHadithIds, changedTocBookIds, changedTafsirBookIds);
			if (options.apply)
				await query(`UPDATE ${table} SET ${field}=REPLACE(${field}, '[Machine]', '[AI]') WHERE ${where}`);
		}
		if (options.apply) await query('COMMIT');
	} catch (err) {
		if (options.apply) await query('ROLLBACK').catch(() => {});
		throw err;
	} finally {
		connection.destroy();
	}
	console.log(`${options.apply ? 'Updated' : 'Would update'} ${replacements} English text row/column value(s).`);
	if (!options.apply || options.skipIndex || !replacements) return;
	indexHadiths(changedHadithIds);
	indexTocBooks(changedTocBookIds);
	await flushBookCaches(changedTocBookIds, settings);
	await indexTafsirBooks(changedTafsirBookIds, settings);
}

async function englishColumns(query) {
	return query(`SELECT c.TABLE_NAME, c.COLUMN_NAME
		FROM information_schema.COLUMNS c
		JOIN information_schema.TABLES t ON t.TABLE_SCHEMA=c.TABLE_SCHEMA AND t.TABLE_NAME=c.TABLE_NAME
		WHERE c.TABLE_SCHEMA=DATABASE() AND t.TABLE_TYPE='BASE TABLE'
			AND c.DATA_TYPE IN ('char','varchar','tinytext','text','mediumtext','longtext','json')
			AND c.COLUMN_NAME REGEXP '(^|_)en($|_)'
		ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION`);
}

async function collectIndexScopes(query, table, where, hadithIds, tocBookIds, tafsirBookIds) {
	if (table === 'hadiths')
		(await query(`SELECT id FROM hadiths WHERE ${where}`)).forEach(row => hadithIds.add(Number(row.id)));
	else if (table === 'hdith_hadith_sharh')
		(await query(`SELECT hadith_id FROM hdith_hadith_sharh WHERE ${where}`)).forEach(row => hadithIds.add(Number(row.hadith_id)));
	else if (table === 'toc')
		(await query(`SELECT DISTINCT bookId FROM toc WHERE ${where}`)).forEach(row => tocBookIds.add(Number(row.bookId)));
	else if (table === 'hadiths_commentary')
		(await query(`SELECT DISTINCT bookId FROM hadiths_commentary WHERE ${where}`)).forEach(row => tafsirBookIds.add(Number(row.bookId)));
}

function indexHadiths(ids) {
	const values = [...ids];
	const script = path.resolve(__dirname, '../indexEnrichedHadithBatch.js');
	for (let offset = 0; offset < values.length; offset += 1000)
		childProcess.execFileSync(process.execPath, [script, values.slice(offset, offset + 1000).join(',')], { stdio: 'inherit' });
}

function indexTocBooks(bookIds) {
	const script = path.resolve(__dirname, '../buildSearchIndex.js');
	for (const bookId of bookIds)
		childProcess.execFileSync(process.execPath, [script, '--book-id', String(bookId)], { stdio: 'inherit' });
}

async function indexTafsirBooks(bookIds, settings) {
	if (!bookIds.size) return;
	const connection = mysql.createConnection(settings.mysql.connection);
	const query = util.promisify(connection.query).bind(connection);
	let rows;
	try {
		rows = await query('SELECT alias FROM books WHERE id IN (?) ORDER BY id', [[...bookIds]]);
	} finally {
		connection.destroy();
	}
	const script = path.resolve(__dirname, '../buildCommentariesIndex.js');
	for (const row of rows) {
		const env = Object.assign({}, process.env);
		if (['rida', 'dorar-t'].includes(row.alias)) env.COMMENTARY_INDEX_BATCH_SIZE = '25';
		childProcess.execFileSync(process.execPath, [script, '--tafsir', row.alias], { stdio: 'inherit', env });
	}
}

async function flushBookCaches(bookIds, settings) {
	if (!bookIds.size) return;
	const connection = mysql.createConnection(settings.mysql.connection);
	const query = util.promisify(connection.query).bind(connection);
	let rows;
	try {
		rows = await query('SELECT alias FROM books WHERE id IN (?)', [[...bookIds]]);
	} finally {
		connection.destroy();
	}
	for (const row of rows) {
		await Utils.flushCacheContaining(row.alias);
		await Utils.flushCacheContaining(`book:${row.alias}`);
	}
}

function readOptions(args) {
	const options = { apply: false, skipIndex: false };
	for (const arg of args) {
		if (arg === '--apply') options.apply = true;
		else if (arg === '--skip-index') options.skipIndex = true;
		else throw new Error(`Unknown option: ${arg}`);
	}
	if (options.skipIndex && !options.apply) throw new Error('--skip-index requires --apply.');
	return options;
}

if (require.main === module)
	main().catch(err => {
		console.error(err.stack || err.message);
		process.exitCode = 1;
	});

module.exports = { englishColumns, readOptions };
