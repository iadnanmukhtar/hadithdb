#!/usr/bin/env node
/* jslint node:true, esversion:9 */
'use strict';

require('dotenv').config();
const os = require('os');
const path = require('path');
const mysql = require('mysql');
const { execFileSync } = require('child_process');
const { extractDorarFootnotes } = require('./import-dorar-tafsir');

const ALIAS = 'dorar-t';

async function run(argv = process.argv.slice(2)) {
	const options = readOptions(argv);
	const db = await connectDb();
	try {
		const rows = await query(db, `SELECT hc.id, hc.surah, hc.ayahFrom, hc.ayahTo, hc.text, hc.footnotes
			FROM hadiths_commentary hc JOIN books b ON b.id=hc.bookId
			WHERE b.alias=${mysql.escape(ALIAS)} ORDER BY hc.surah, hc.ayahFrom`);
		if (rows.length !== 1231)
			throw new Error(`Expected 1231 '${ALIAS}' passages, found ${rows.length}.`);
		let noteCount = 0;
		let changed = 0;
		const updates = [];
		for (const row of rows) {
			if (String(row.footnotes || '').trim())
				throw new Error(`Passage ${row.surah}:${row.ayahFrom}-${row.ayahTo} already has footnotes; refusing to overwrite.`);
			const converted = extractDorarFootnotes(row.text);
			noteCount += converted.count;
			if (!converted.count)
				continue;
			changed++;
			updates.push({ id: row.id, text: converted.text, footnotes: converted.footnotes });
		}
		console.log(`${options.dryRun ? 'Would convert' : 'Converting'} ${noteCount} citation(s) in ${changed}/${rows.length} '${ALIAS}' passage(s).`);
		if (options.dryRun)
			return;
		await query(db, 'START TRANSACTION');
		const backup = `hadiths_commentary_backup_dorar_footnotes_${timestamp()}`;
		await query(db, `CREATE TABLE ${backup} LIKE hadiths_commentary`);
		await query(db, `INSERT INTO ${backup} SELECT hc.* FROM hadiths_commentary hc JOIN books b ON b.id=hc.bookId WHERE b.alias=${mysql.escape(ALIAS)}`);
		for (let offset = 0; offset < updates.length; offset += options.batchSize) {
			const batch = updates.slice(offset, offset + options.batchSize);
			const values = batch.map(row => `SELECT ${row.id} id, ${mysql.escape(row.text)} text, ${mysql.escape(row.footnotes)} footnotes`).join('\nUNION ALL\n');
			await query(db, `UPDATE hadiths_commentary hc JOIN (${values}) vals ON vals.id=hc.id
				SET hc.text=vals.text, hc.footnotes=vals.footnotes`);
		}
		await query(db, 'COMMIT');
		console.log(`Updated ${updates.length} passage(s); backup: ${backup}.`);
	} catch (err) {
		try { await query(db, 'ROLLBACK'); } catch (rollbackErr) { /* Preserve original error. */ }
		throw err;
	} finally {
		await closeDb(db);
	}
	if (options.buildIndex)
		execFileSync(process.execPath, [path.resolve(__dirname, '../buildCommentariesIndex.js'), '--tafsir', ALIAS], { stdio: 'inherit' });
}

function readOptions(argv) {
	const options = { dryRun: false, buildIndex: true, batchSize: 25 };
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === '--dry-run') options.dryRun = true;
		else if (argv[i] === '--no-index') options.buildIndex = false;
		else if (argv[i] === '--batch-size') options.batchSize = Number(argv[++i]);
		else throw new Error(`Unknown option '${argv[i]}'.`);
	}
	if (!Number.isInteger(options.batchSize) || options.batchSize < 1)
		throw new Error('--batch-size requires a positive integer.');
	return options;
}

function timestamp() {
	return new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
}

function appMysqlConnection() {
	return require(path.join(os.homedir(), '.hadithdb', 'settings.json')).mysql.connection;
}

function connectDb() {
	const db = mysql.createConnection(appMysqlConnection());
	return new Promise((resolve, reject) => db.connect(err => err ? reject(err) : resolve(db)));
}

function query(db, sql) {
	return new Promise((resolve, reject) => db.query({ sql, timeout: 600000 }, (err, result) => err ? reject(err) : resolve(result)));
}

function closeDb(db) {
	return new Promise((resolve, reject) => db.end(err => err ? reject(err) : resolve()));
}

if (require.main === module)
	run().catch(err => { console.error(`ERROR: ${err.stack || err.message}`); process.exitCode = 1; });

module.exports = { run };
