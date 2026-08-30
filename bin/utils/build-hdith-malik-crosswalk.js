#!/usr/bin/env node
/* jslint node:true, esversion:11 */
'use strict';

require('dotenv').config();
const cheerio = require('cheerio');
const fs = require('fs');
const mysql = require('mysql');
const os = require('os');
const path = require('path');
const util = require('util');
const zlib = require('zlib');
const { hadithTextSimilarity, normalizeHadithForComparison } = require('./import-hdith-six-books-enrichment');

const BASE_URL = 'https://hdith.com';
const SOURCE_BOOK_ID = 7;
const LOCAL_BOOK_ID = 7;
const LOCAL_ALIAS = 'malik';
const CACHE_DIR = '/tmp/hadithdb-hdith-book-crosswalk/b-7';
const options = readOptions(process.argv.slice(2));
let connection;

async function main() {
	fs.mkdirSync(CACHE_DIR, { recursive: true });
	connection = await database();
	await ensureSchema();
	const sources = await query(`SELECT source_entry_id, MIN(source_num) source_num
		FROM hdith_hadith_links WHERE source_book_id=? GROUP BY source_entry_id
		ORDER BY source_entry_id`, [SOURCE_BOOK_ID]);
	const locals = await query('SELECT id, num, body FROM hadiths WHERE bookId=? ORDER BY ordinal, id', [LOCAL_BOOK_ID]);
	const existing = await query(`SELECT source_entry_id, local_hadith_id FROM hdith_book_reference_crosswalk
		WHERE source_book_id=? ORDER BY source_entry_id`, [SOURCE_BOOK_ID]);
	const existingBySource = new Map(existing.map(row => [Number(row.source_entry_id), Number(row.local_hadith_id)]));
	const localIndexById = new Map(locals.map((local, index) => [Number(local.id), index]));
	let cursor = 0;
	if (options.apply) await query(`UPDATE hdith_hadith_links SET source_num=NULL, internal_hadith_id=NULL, internal_ref=NULL
		WHERE source_book_id=? AND source_entry_id NOT IN
			(SELECT source_entry_id FROM hdith_book_reference_crosswalk WHERE source_book_id=?)`, [SOURCE_BOOK_ID, SOURCE_BOOK_ID]);
	let processed = 0, matched = existing.length, newMatched = 0, failed = 0;
	for (const source of sources) {
		if (existingBySource.has(Number(source.source_entry_id))) {
			const index = localIndexById.get(existingBySource.get(Number(source.source_entry_id)));
			if (index !== undefined) cursor = index + 1;
			continue;
		}
		if (options.max !== null && processed >= options.max) break;
		const hadith = await loadSource(Number(source.source_entry_id));
		const sourceText = normalizeHadithForComparison(hadith.matn);
		let best = null;
		const end = Math.min(locals.length, cursor + 120);
		for (let index = cursor; index < end; index++) {
			const score = hadithTextSimilarity(sourceText, normalizeHadithForComparison(locals[index].body));
			if (!best || score > best.score) best = { ...locals[index], index, score };
			if (score >= 0.98) break;
		}
		const bestLocalText = best ? normalizeHadithForComparison(best.body) : '';
		const containmentConfirmed = Math.min(sourceText.length, bestLocalText.length) >= 20
			&& (sourceText.includes(bestLocalText) || bestLocalText.includes(sourceText));
		if (best && (best.score >= options.threshold || containmentConfirmed)) {
			if (options.apply) {
				await query(`INSERT INTO hdith_book_reference_crosswalk
					(source_book_id, source_entry_id, source_num, local_hadith_id, local_ref, similarity)
					VALUES (?, ?, ?, ?, ?, ?)
					ON DUPLICATE KEY UPDATE source_num=VALUES(source_num), local_hadith_id=VALUES(local_hadith_id),
						local_ref=VALUES(local_ref), similarity=VALUES(similarity), lastmod=NOW()`,
				[SOURCE_BOOK_ID, source.source_entry_id, hadith.numbering_harf || source.source_num, best.id, best.num, best.score]);
				await query(`UPDATE hdith_hadith_links SET source_num=?, internal_hadith_id=?, internal_ref=?
					WHERE source_book_id=? AND source_entry_id=?`,
				[best.num, best.id, `${LOCAL_ALIAS}:${best.num}`, SOURCE_BOOK_ID, source.source_entry_id]);
			}
			cursor = best.index + 1;
			matched++;
			newMatched++;
		} else {
			failed++;
			console.warn(`malik: no ordered text-confirmed match for hdith.com entry ${source.source_entry_id} (${hadith.numbering_harf || source.source_num}); best=${best?.score.toFixed(3) || 'none'}`);
		}
		compressCache(Number(source.source_entry_id));
		processed++;
		if (processed % 25 === 0) report(processed, matched, newMatched, failed, sources.length);
	}
	report(processed, matched, newMatched, failed, sources.length);
	await close();
}

async function loadSource(sourceEntryId) {
	const jsonFile = path.join(CACHE_DIR, `${sourceEntryId}.json`);
	const gzipFile = `${jsonFile}.gz`;
	if (fs.existsSync(gzipFile)) return JSON.parse(zlib.gunzipSync(fs.readFileSync(gzipFile)));
	if (fs.existsSync(jsonFile)) return JSON.parse(fs.readFileSync(jsonFile));
	const url = `${BASE_URL}/encyclopedia/book/b-7/h/${sourceEntryId}`;
	let lastError;
	for (let attempt = 1; attempt <= 3; attempt++) {
		try {
			await wait(options.delay);
			const response = await fetch(url, { headers: { accept: 'text/html,application/xhtml+xml' }, signal: AbortSignal.timeout(30000) });
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const $ = cheerio.load(await response.text());
			const payload = $('script[data-page="app"][type="application/json"]').html();
			if (!payload) throw new Error('missing Inertia payload');
			const hadith = JSON.parse(payload).props?.hadith;
			if (!hadith || Number(hadith.id) !== sourceEntryId || hadith.book?.slug !== 'b-7') throw new Error('mismatched hadith payload');
			fs.writeFileSync(jsonFile, JSON.stringify(hadith));
			return hadith;
		} catch (err) {
			lastError = err;
			if (attempt < 3) await wait(attempt * 1000);
		}
	}
	throw new Error(`${url}: failed after 3 attempts: ${lastError?.message || lastError}`);
}

function compressCache(sourceEntryId) {
	const jsonFile = path.join(CACHE_DIR, `${sourceEntryId}.json`);
	if (!fs.existsSync(jsonFile)) return;
	const temporary = `${jsonFile}.gz.tmp`;
	fs.writeFileSync(temporary, zlib.gzipSync(fs.readFileSync(jsonFile)));
	fs.renameSync(temporary, `${jsonFile}.gz`);
	fs.unlinkSync(jsonFile);
}

async function ensureSchema() {
	await query(`CREATE TABLE IF NOT EXISTS hdith_book_reference_crosswalk (
		source_book_id INT NOT NULL, source_entry_id INT NOT NULL, source_num VARCHAR(45) NULL,
		local_hadith_id INT NOT NULL, local_ref VARCHAR(45) NOT NULL, similarity DECIMAL(6,5) NULL,
		lastmod DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
		PRIMARY KEY (source_book_id, source_entry_id), KEY hdith_crosswalk_local (source_book_id, local_hadith_id),
		KEY hdith_crosswalk_hadith (local_hadith_id),
		CONSTRAINT hdith_crosswalk_hadith_fk FOREIGN KEY (local_hadith_id) REFERENCES hadiths(id) ON DELETE CASCADE ON UPDATE CASCADE
	) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
	const mode = await query(`SELECT column_type FROM information_schema.columns WHERE table_schema=DATABASE()
		AND table_name='hdith_book_mappings' AND column_name='reference_mode' LIMIT 1`);
	if (mode[0] && !(mode[0].column_type || mode[0].COLUMN_TYPE).includes("'crosswalk'"))
		await query("ALTER TABLE hdith_book_mappings MODIFY reference_mode ENUM('exact','source-entry','crosswalk','unresolved') NOT NULL");
	await query(`UPDATE hdith_book_mappings SET reference_mode='crosswalk' WHERE source_book_id=?`, [SOURCE_BOOK_ID]);
}

function report(processed, matched, newMatched, failed, total) {
	const attempted = newMatched + failed;
	console.log(`malik: processed ${processed}; crosswalk ${matched}/${total} (${percent(matched, total)}%); failures ${failed}/${attempted} (${percent(failed, attempted)}%)`);
}

function percent(value, total) { return total ? (100 * value / total).toFixed(2) : '0.00'; }
function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function readOptions(args) {
	const parsed = { apply: false, delay: 250, threshold: 0.70, max: null };
	for (let index = 0; index < args.length; index++) {
		if (args[index] === '--apply') parsed.apply = true;
		else if (args[index] === '--delay') parsed.delay = Number(args[++index]);
		else if (args[index] === '--threshold') parsed.threshold = Number(args[++index]);
		else if (args[index] === '--max') parsed.max = Number(args[++index]);
		else throw new Error(`Unknown option: ${args[index]}`);
	}
	if (!Number.isInteger(parsed.delay) || parsed.delay < 250) throw new Error('--delay must be at least 250 milliseconds.');
	if (!(parsed.threshold >= 0.5 && parsed.threshold <= 1)) throw new Error('--threshold must be between 0.5 and 1.');
	if (parsed.max !== null && (!Number.isInteger(parsed.max) || parsed.max < 1)) throw new Error('--max must be a positive integer.');
	return parsed;
}

async function database() {
	const settings = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.hadithdb', 'settings.json')));
	const db = mysql.createConnection(settings.mysql.connection);
	db.query = util.promisify(db.query).bind(db);
	return db;
}
function query(sql, values = []) { return connection.query(sql, values); }
async function close() { if (connection) await util.promisify(connection.end).call(connection); }

main().catch(async err => {
	console.error(`ERROR: ${err.stack || err.message}`);
	process.exitCode = 1;
	await close().catch(() => {});
});
