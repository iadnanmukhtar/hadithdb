#!/usr/bin/env node
'use strict';

require('dotenv').config();
const childProcess = require('child_process');
const fs = require('fs');
const mysql = require('mysql');
const os = require('os');
const path = require('path');
const util = require('util');
const zlib = require('zlib');
const { CACHE_DIR, proposedBodyFootnoteSplit, proposedChainBodySplit } = require('./import-hdith-six-books-enrichment');
const Hadith = require('../../lib/Hadith');

const apply = process.argv.includes('--apply');
const replaceBodyFromSource = process.argv.includes('--replace-body-from-source');
const batchSizeArgument = process.argv.find(argument => argument.startsWith('--batch-size='));
const batchSize = Math.max(1, Number(batchSizeArgument?.split('=')[1]) || 100);
const booksArgument = process.argv.find(argument => argument.startsWith('--books='));
const selectedBooks = new Set(String(booksArgument?.split('=')[1] || '').split(',').map(value => value.trim()).filter(Boolean));
const settings = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.hadithdb', 'settings.json'), 'utf8'));
const connection = mysql.createConnection(settings.mysql.connection);
const query = util.promisify(connection.query).bind(connection);

(async () => {
	let scanned = 0;
	let cached = 0;
	let corrected = 0;
	let transliterated = 0;
	let bodyFootnotes = 0;
	let sourceBodies = 0;
	let unchanged = 0;
	let ambiguous = 0;
	let missingCache = 0;
	let pending = [];
	try {
		const rows = await query(`SELECT m.source_book_slug, m.source_entry_id, h.id, h.chain, h.chain_en, h.body, h.footnote
			FROM hdith_hadith_metadata m JOIN hadiths h ON h.id=m.hadith_id
			ORDER BY m.source_book_slug, m.source_entry_id`);
		for (const row of rows) {
			if (selectedBooks.size && !selectedBooks.has(row.source_book_slug)) continue;
			scanned++;
			const cacheFile = path.join(CACHE_DIR, row.source_book_slug, `${row.source_entry_id}.json.gz`);
			if (!fs.existsSync(cacheFile)) {
				missingCache++;
				continue;
			}
			cached++;
			let payload;
			try {
				payload = JSON.parse(zlib.gunzipSync(fs.readFileSync(cacheFile)).toString('utf8'));
			} catch (err) {
				console.warn(`${row.source_book_slug}/h/${row.source_entry_id}: unreadable cache: ${err.message}`);
				ambiguous++;
				continue;
			}
			const split = proposedChainBodySplit(row.chain, row.body, payload.matn);
			const correctedChain = split ? split.chain : String(row.chain || '').trim();
			let correctedBody = split ? split.body : String(row.body || '').trim();
			let correctedFootnote = String(row.footnote || '').trim() || null;
			const bodyFootnoteSplit = proposedBodyFootnoteSplit(correctedBody, correctedFootnote, payload.matn);
			if (bodyFootnoteSplit) {
				correctedBody = bodyFootnoteSplit.body;
				correctedFootnote = bodyFootnoteSplit.footnote;
				bodyFootnotes++;
			}
			const cachedSourceBody = String(payload.matn || '').trim();
			if (replaceBodyFromSource && !cachedSourceBody) {
				ambiguous++;
				continue;
			}
			if (replaceBodyFromSource && correctedBody !== cachedSourceBody) {
				correctedBody = cachedSourceBody;
				sourceBodies++;
			}
			const chainEn = Hadith.transliteratedNarratorChain(correctedChain).chain_en;
			const chainEnChanged = chainEn !== String(row.chain_en || '').trim();
			const sourceBodyChanged = replaceBodyFromSource && correctedBody !== String(row.body || '').trim();
			if (!split && !bodyFootnoteSplit && !chainEnChanged && !sourceBodyChanged) {
				unchanged++;
				continue;
			}
			if (split) corrected++;
			if (chainEnChanged) transliterated++;
			pending.push({ id: Number(row.id), chain: correctedChain, body: correctedBody, footnote: correctedFootnote,
				chainEn, text: [correctedChain, correctedBody].filter(Boolean).join(' ').trim() });
			if (pending.length >= batchSize) {
				if (apply) await applyBatch(pending);
				console.log(`scanned=${scanned} cached=${cached} corrected=${corrected} source_bodies=${sourceBodies} body_footnotes=${bodyFootnotes} transliterated=${transliterated} unchanged=${unchanged} missing_cache=${missingCache}`);
				pending = [];
			}
		}
		if (pending.length && apply) await applyBatch(pending);
		console.log(`complete mode=${apply ? 'apply' : 'dry-run'} scanned=${scanned} cached=${cached} corrected=${corrected} source_bodies=${sourceBodies} body_footnotes=${bodyFootnotes} transliterated=${transliterated} unchanged=${unchanged} ambiguous=${ambiguous} missing_cache=${missingCache}`);
	} finally {
		connection.end();
	}
})().catch(err => {
	console.error(err.stack || err.message);
	process.exitCode = 1;
});

async function applyBatch(rows) {
	await query('START TRANSACTION');
	try {
		for (const row of rows)
			await query('UPDATE hadiths SET chain=?, body=?, footnote=?, chain_en=?, text=? WHERE id=?',
				[row.chain, row.body, row.footnote, row.chainEn, row.text, row.id]);
		await query('COMMIT');
	} catch (err) {
		await query('ROLLBACK').catch(() => {});
		throw err;
	}
	const indexer = path.join(__dirname, '..', 'indexEnrichedHadithBatch.js');
	const result = await util.promisify(childProcess.execFile)(process.execPath, [indexer, rows.map(row => row.id).join(',')], {
		cwd: path.join(__dirname, '..', '..'), maxBuffer: 10 * 1024 * 1024
	});
	console.log(`search: ${String(result.stdout || '').trim()}`);
}
