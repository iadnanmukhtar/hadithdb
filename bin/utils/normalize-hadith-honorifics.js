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

const BATCH_SIZE = 500;

async function main() {
	const options = readOptions(process.argv.slice(2));
	const settings = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.hadithdb', 'settings.json'), 'utf8'));
	const connection = mysql.createConnection(settings.mysql.connection);
	const query = util.promisify(connection.query).bind(connection);
	const changedHadithIds = new Set();
	const changedTocBookIds = new Set();
	const changedTafsirBookIds = new Set();
	let hadithRows = 0;
	let sharhRows = 0;
	let headingRows = 0;
	let tafsirRows = 0;
	try {
		if (options.apply) {
			await query('START TRANSACTION');
			await query(`CREATE TEMPORARY TABLE normalized_hadith_honorifics (
				id INT NOT NULL PRIMARY KEY, chain LONGTEXT NULL, body LONGTEXT NULL,
				footnote LONGTEXT NULL, text LONGTEXT NULL
			)`);
			await query(`CREATE TEMPORARY TABLE normalized_sharh_honorifics (
				id INT NOT NULL PRIMARY KEY, text LONGTEXT NOT NULL
			)`);
			await query(`CREATE TEMPORARY TABLE normalized_heading_honorifics (
				id INT NOT NULL PRIMARY KEY, title LONGTEXT NULL, intro LONGTEXT NULL
			)`);
			await query(`CREATE TEMPORARY TABLE normalized_tafsir_honorifics (
				id INT NOT NULL PRIMARY KEY, text LONGTEXT NULL
			)`);
		}

		let lastId = 0;
		while (true) {
			const rows = await query('SELECT id, chain, body, footnote FROM hadiths WHERE id>? ORDER BY id LIMIT ?', [lastId, BATCH_SIZE]);
			if (!rows.length) break;
			lastId = Number(rows[rows.length - 1].id);
			const changes = rows.map(normalizeHadithRow).filter(Boolean);
			hadithRows += changes.length;
			changes.forEach(row => changedHadithIds.add(Number(row[0])));
			if (options.apply && changes.length) {
				await query('INSERT INTO normalized_hadith_honorifics (id, chain, body, footnote, text) VALUES ?', [changes]);
				await query(`UPDATE hadiths h JOIN normalized_hadith_honorifics n ON n.id=h.id
					SET h.chain=n.chain, h.body=n.body, h.footnote=n.footnote, h.text=n.text`);
				await query('DELETE FROM normalized_hadith_honorifics');
			}
		}

		lastId = 0;
		while (true) {
			const rows = await query('SELECT id, hadith_id, text FROM hdith_hadith_sharh WHERE id>? ORDER BY id LIMIT ?', [lastId, BATCH_SIZE]);
			if (!rows.length) break;
			lastId = Number(rows[rows.length - 1].id);
			const changes = rows.map(normalizeSharhRow).filter(Boolean);
			sharhRows += changes.length;
			changes.forEach(row => changedHadithIds.add(Number(row.hadithId)));
			if (options.apply && changes.length) {
				await query('INSERT INTO normalized_sharh_honorifics (id, text) VALUES ?', [changes.map(row => [row.id, row.text])]);
				await query(`UPDATE hdith_hadith_sharh hs JOIN normalized_sharh_honorifics n ON n.id=hs.id
					SET hs.text=n.text`);
				await query('DELETE FROM normalized_sharh_honorifics');
			}
		}

		lastId = 0;
		while (true) {
			const rows = await query('SELECT id, bookId, title, intro FROM toc WHERE id>? ORDER BY id LIMIT ?', [lastId, BATCH_SIZE]);
			if (!rows.length) break;
			lastId = Number(rows[rows.length - 1].id);
			const changes = rows.map(normalizeHeadingRow).filter(Boolean);
			headingRows += changes.length;
			changes.forEach(row => changedTocBookIds.add(Number(row.bookId)));
			if (options.apply && changes.length) {
				await query('INSERT INTO normalized_heading_honorifics (id, title, intro) VALUES ?', [changes.map(row => [row.id, row.title, row.intro])]);
				await query(`UPDATE toc t JOIN normalized_heading_honorifics n ON n.id=t.id
					SET t.title=n.title, t.intro=n.intro`);
				await query('DELETE FROM normalized_heading_honorifics');
			}
		}

		lastId = 0;
		while (true) {
			const rows = await query('SELECT id, bookId, text FROM hadiths_commentary WHERE id>? ORDER BY id LIMIT ?', [lastId, BATCH_SIZE]);
			if (!rows.length) break;
			lastId = Number(rows[rows.length - 1].id);
			const changes = rows.map(normalizeTafsirRow).filter(Boolean);
			tafsirRows += changes.length;
			changes.forEach(row => changedTafsirBookIds.add(Number(row.bookId)));
			if (options.apply && changes.length) {
				await query('INSERT INTO normalized_tafsir_honorifics (id, text) VALUES ?', [changes.map(row => [row.id, row.text])]);
				await query(`UPDATE hadiths_commentary hc JOIN normalized_tafsir_honorifics n ON n.id=hc.id
					SET hc.text=n.text`);
				await query('DELETE FROM normalized_tafsir_honorifics');
			}
		}

		if (options.apply) await query('COMMIT');
		console.log(`${options.apply ? 'Updated' : 'Would update'} ${hadithRows} hadith row(s), ${sharhRows} Arabic sharh row(s), ${headingRows} Arabic heading row(s), and ${tafsirRows} Arabic tafsir row(s).`);
	} catch (err) {
		if (options.apply) await query('ROLLBACK').catch(() => {});
		throw err;
	} finally {
		// Indexing below is synchronous and can starve mysql's asynchronous quit
		// callback. The transaction is already committed or rolled back here.
		connection.destroy();
	}

	if (options.apply && !options.skipIndex && changedHadithIds.size) indexHadiths([...changedHadithIds]);
	if (options.apply && !options.skipIndex && changedTocBookIds.size) {
		indexTocBooks([...changedTocBookIds]);
		await flushBookCaches(changedTocBookIds, settings);
	}
	if (options.apply && !options.skipIndex && changedTafsirBookIds.size) await indexTafsirBooks(changedTafsirBookIds, settings);
}

function normalizeField(value) {
	if (value === null || value === undefined) return value;
	const source = String(value);
	const normalized = Utils.normalizeArabicHonorifics(source);
	if (normalized === source) return value;
	return normalized.replace(/[ \t]{2,}/g, ' ').trim();
}

function normalizeHadithRow(row) {
	const chain = normalizeField(row.chain);
	const body = normalizeField(row.body);
	const footnote = normalizeField(row.footnote);
	if (chain === row.chain && body === row.body && footnote === row.footnote) return null;
	return [row.id, chain, body, footnote, [chain, body].filter(Boolean).join(' ').trim()];
}

function normalizeSharhRow(row) {
	const text = normalizeField(row.text);
	return text === row.text ? null : { id: row.id, hadithId: row.hadith_id, text };
}

function normalizeHeadingRow(row) {
	const title = normalizeField(row.title);
	const intro = normalizeField(row.intro);
	return title === row.title && intro === row.intro ? null : { id: row.id, bookId: row.bookId, title, intro };
}

function normalizeTafsirRow(row) {
	const text = normalizeField(row.text);
	return text === row.text ? null : { id: row.id, bookId: row.bookId, text };
}

function indexHadiths(ids) {
	const script = path.resolve(__dirname, '../indexEnrichedHadithBatch.js');
	for (let offset = 0; offset < ids.length; offset += 1000)
		childProcess.execFileSync(process.execPath, [script, ids.slice(offset, offset + 1000).join(',')], { stdio: 'inherit' });
}

function indexTocBooks(bookIds) {
	const script = path.resolve(__dirname, '../buildSearchIndex.js');
	for (const bookId of bookIds)
		childProcess.execFileSync(process.execPath, [script, '--book-id', String(bookId)], { stdio: 'inherit' });
}

async function indexTafsirBooks(bookIds, settings) {
	const connection = mysql.createConnection(settings.mysql.connection);
	const query = util.promisify(connection.query).bind(connection);
	let rows;
	try {
		rows = await query('SELECT id, alias FROM books WHERE id IN (?) ORDER BY id', [[...bookIds]]);
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
		else if (arg === '--help') usage(0);
		else usage(1, `Unknown option: ${arg}`);
	}
	if (options.skipIndex && !options.apply) usage(1, '--skip-index requires --apply.');
	return options;
}

function usage(code, message) {
	if (message) console.error(message);
	console.error('Usage: node bin/utils/normalize-hadith-honorifics.js [--apply] [--skip-index]');
	process.exit(code);
}

if (require.main === module)
	main().catch(err => {
		console.error(err.stack || err.message);
		process.exitCode = 1;
	});

module.exports = { normalizeField, normalizeHadithRow, normalizeSharhRow, normalizeHeadingRow, normalizeTafsirRow, readOptions };
