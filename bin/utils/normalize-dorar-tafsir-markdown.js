#!/usr/bin/env node
/* jslint node:true, esversion:9 */
'use strict';

require('dotenv').config();
const os = require('os');
const path = require('path');
const mysql = require('mysql');
const { execFileSync } = require('child_process');
const cheerio = require('cheerio');
const { extractDorarFootnotes } = require('./import-dorar-tafsir');

const ALIAS = 'dorar-t';
const MARKS = '[\\u064B-\\u065F\\u0670\\u06D6-\\u06ED]*';
const SPACE = '[\\s\\u00a0]+';
const word = value => Array.from(value).join(MARKS) + MARKS;
const BLESSING_RE = new RegExp(`${word('صل')}[ىي]${MARKS}${SPACE}${word('الله')}${SPACE}${word('عليه')}${SPACE}${word('وسلم')}`, 'gu');
const PLEASURE_RE = new RegExp(`${word('رض')}[ىي]${MARKS}${SPACE}${word('الله')}(?:${SPACE}${word('تعالى')})?${SPACE}${word('عن')}(?:${word('هما')}|${word('هن')}|${word('هم')}|${word('ها')}|${word('ه')})`, 'gu');

async function run(argv = process.argv.slice(2)) {
	const options = readOptions(argv);
	const db = await connectDb();
	try {
		const rows = await query(db, `SELECT hc.id, hc.surah, hc.ayahFrom, hc.ayahTo, hc.text, hc.footnotes
			FROM hadiths_commentary hc JOIN books b ON b.id=hc.bookId
			WHERE b.alias=${mysql.escape(ALIAS)} ORDER BY hc.surah, hc.ayahFrom`);
		if (rows.length !== 1231)
			throw new Error(`Expected 1231 '${ALIAS}' passages, found ${rows.length}.`);
		const updates = [];
		let htmlRows = 0;
		let blessingCount = 0;
		let pleasureCount = 0;
		let recoveredNotes = 0;
		for (const row of rows) {
			let text = row.text || '';
			let footnotes = row.footnotes || '';
			if (/<[A-Za-z][^>]*>/.test(text)) {
				htmlRows++;
				text = htmlToMarkdown(text);
			}
			const normalizedText = normalizeHonorifics(text);
			const normalizedFootnotes = normalizeHonorifics(footnotes);
			blessingCount += countMatches(text, BLESSING_RE) + countMatches(footnotes, BLESSING_RE);
			pleasureCount += countMatches(text, PLEASURE_RE) + countMatches(footnotes, PLEASURE_RE);
			text = normalizedText;
			footnotes = normalizedFootnotes;
			const lastNumber = maximumFootnoteNumber(text, footnotes);
			const recovered = extractDorarFootnotes(text, lastNumber);
			if (recovered.count) {
				text = recovered.text;
				footnotes = [footnotes.trim(), recovered.footnotes].filter(Boolean).join('\n\n');
				recoveredNotes += recovered.count;
			}
			if (text !== row.text || footnotes !== row.footnotes)
				updates.push({ id: row.id, text, footnotes });
		}
		console.log(`${options.dryRun ? 'Would update' : 'Updating'} ${updates.length}/${rows.length} '${ALIAS}' passage(s): ${htmlRows} with HTML, ${blessingCount} blessings, ${pleasureCount} companion invocations, ${recoveredNotes} recovered footnote(s).`);
		if (options.dryRun)
			return;
		await query(db, 'START TRANSACTION');
		const backup = `hadiths_commentary_backup_dorar_markdown_${timestamp()}`;
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

function htmlToMarkdown(text) {
	return String(text || '')
		.replace(/<i\b[^>]*>[\s\S]*?<\/i>/gi, '')
		.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (match, attrs, body) => {
			const label = plainText(body).trim().replace(/^\[([\s\S]*)\]$/, '$1');
			const hrefMatch = /\bhref\s*=\s*["']([^"']+)["']/i.exec(attrs);
			if (!label || !hrefMatch)
				return label;
			const href = hrefMatch[1].startsWith('/') ? `https://dorar.net${hrefMatch[1]}` : hrefMatch[1];
			return `[${label}](${href})`;
		})
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/?(?:span|b|strong|em)\b[^>]*>/gi, '')
		.replace(/&nbsp;|&#160;/gi, ' ')
		.replace(/[ \t]+\n/g, '\n')
		.replace(/\n[ \t]+/g, '\n')
		.replace(/[ \t]{2,}/g, ' ')
		.replace(/\n{3,}/g, '\n\n');
}

function plainText(html) {
	return cheerio.load(html, null, false).text().replace(/\u00a0/g, ' ');
}

function normalizeHonorifics(text) {
	return String(text || '').replace(BLESSING_RE, 'ﷺ').replace(PLEASURE_RE, 'ؓ');
}

function countMatches(text, regex) {
	regex.lastIndex = 0;
	return Array.from(String(text || '').matchAll(regex)).length;
}

function maximumFootnoteNumber(...values) {
	let maximum = 0;
	for (const value of values) {
		for (const match of String(value || '').matchAll(/\[\^([0-9]+)\]/g))
			maximum = Math.max(maximum, Number(match[1]));
	}
	return maximum;
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

module.exports = { htmlToMarkdown, normalizeHonorifics, run };
