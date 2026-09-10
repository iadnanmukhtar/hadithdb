#!/usr/bin/env node
/* jslint node:true, esversion:11 */
'use strict';

const fs = require('fs');
const mysql = require('mysql');
const os = require('os');
const path = require('path');
const util = require('util');
const zlib = require('zlib');
const Hadith = require('../../lib/Hadith');
const Utils = require('../../lib/Utils');
const { CACHE_DIR, enrichHadithMatches } = require('./import-hdith-six-books-enrichment');

const BOOK_ID = 32;
const SOURCE_BOOK_ID = 33;
const SOURCE_SLUG = 'b-33';
const apply = process.argv.includes('--apply');
const gaps = [
	[299422, '6', 139424], [299484, '62', 139438], [299508, '81', 139444],
	[299524, '95', 139448], [299538, '108', 139450], [299579, '139', 139470],
	[299668, '219', 139488], [299696, '243', 139496], [299703, '250', 139496],
	[299709, '254', 139502], [299729, '273', 139504], [299733, '277', 139504],
	[299750, '293', 139506], [299834, '367', 139526], [299852, '385', 139530]
];

function compact(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }
function normalize(value) { return Utils.normalizeArabicHonorifics(compact(value)).replace(/[ \t]{2,}/g, ' ').trim(); }
function cachedHadith(sourceId) {
	const file = path.join(CACHE_DIR, SOURCE_SLUG, `${sourceId}.json.gz`);
	const value = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'));
	const hadith = value.hadith || value;
	if (Number(hadith.id) !== sourceId || hadith.book?.slug !== SOURCE_SLUG)
		throw new Error(`Cache ${file} does not contain ${SOURCE_SLUG}/h/${sourceId}.`);
	// Detail-cache files are hadith payloads, rather than their surrounding page props.
	if (!Object.prototype.hasOwnProperty.call(hadith, '_verification_url')) {
		hadith._verification_url = value.__verificationUrl || null;
		fs.writeFileSync(file, zlib.gzipSync(JSON.stringify(hadith)));
	}
	return hadith;
}
function footnote(hadith) {
	return (hadith.footnotes || []).map(item => normalize(typeof item === 'string' ? item : item?.text || item?.content))
		.filter(Boolean).join('\n\n') || null;
}

async function main() {
	const records = gaps.map(([sourceId, localRef, tocId]) => {
		const payload = cachedHadith(sourceId);
		const chain = normalize(payload.isnad_prefix) || null;
		const body = normalize(payload.matn);
		if (!body) throw new Error(`${SOURCE_SLUG}/h/${sourceId} has no visible matn.`);
		return { sourceId, localRef, tocId, payload, chain, body, footnote: footnote(payload) };
	});
	console.log(`Validated ${records.length} cached Shamail gap payloads: ${records.map(row => row.localRef).join(', ')}.`);
	if (!apply) return;
	const settings = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.hadithdb', 'settings.json'), 'utf8')).mysql.connection;
	const connection = mysql.createConnection(settings);
	const query = util.promisify(connection.query).bind(connection);
	const matches = [];
	try {
		await query('START TRANSACTION');
		for (const record of records) {
			if ((await query('SELECT 1 FROM hadiths WHERE bookId=? AND num=? LIMIT 1', [BOOK_ID, record.localRef])).length)
				throw new Error(`Local shamail:${record.localRef} already exists.`);
			if ((await query(`SELECT 1 FROM hdith_book_reference_crosswalk
				WHERE source_book_id=? AND source_entry_id=? AND is_supplementary=0 LIMIT 1`, [SOURCE_BOOK_ID, record.sourceId])).length)
				throw new Error(`Source ${record.sourceId} already has a primary mapping.`);
			const toc = (await query('SELECT id,h1,h2,h3 FROM toc WHERE id=? AND bookId=? LIMIT 1', [record.tocId, BOOK_ID]))[0];
			if (!toc) throw new Error(`Missing Shamail TOC ${record.tocId}.`);
			const next = (await query(`SELECT h.ordinal,h.numInChapter FROM hdith_book_reference_crosswalk c
				JOIN hadiths h ON h.id=c.local_hadith_id
				WHERE c.source_book_id=? AND c.source_entry_id>? AND c.is_supplementary=0
				ORDER BY c.source_entry_id LIMIT 1`, [SOURCE_BOOK_ID, record.sourceId]))[0];
			const ordinal = next ? Number(next.ordinal) : Number((await query('SELECT COALESCE(MAX(ordinal),0)+1 ordinal FROM hadiths WHERE bookId=?', [BOOK_ID]))[0].ordinal);
			await query('UPDATE hadiths SET ordinal=ordinal+1 WHERE bookId=? AND ordinal>=? ORDER BY ordinal DESC', [BOOK_ID, ordinal]);
			const nextInChapter = (await query('SELECT MIN(numInChapter) n FROM hadiths WHERE bookId=? AND tocId=? AND ordinal>=?', [BOOK_ID, toc.id, ordinal]))[0].n;
			const numInChapter = nextInChapter === null ? Number((await query('SELECT COALESCE(MAX(numInChapter),0)+1 n FROM hadiths WHERE bookId=? AND tocId=?', [BOOK_ID, toc.id]))[0].n) : Number(nextInChapter);
			await query('UPDATE hadiths SET numInChapter=numInChapter+1 WHERE bookId=? AND tocId=? AND numInChapter>=? ORDER BY numInChapter DESC', [BOOK_ID, toc.id, numInChapter]);
			const chainEn = record.chain ? Hadith.transliteratedNarratorChain(record.chain).chain_en || null : null;
			const result = await query(`INSERT INTO hadiths
				(ordinal,bookId,tocId,numInChapter,h1,h2,h3,num,num0,chain,chain_en,body,footnote,text)
				VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [ordinal, BOOK_ID, toc.id, numInChapter, toc.h1, toc.h2, toc.h3,
				record.localRef, Number(record.localRef), record.chain, chainEn, record.body, record.footnote,
				compact(`${record.chain || ''} ${record.body}`)]);
			await query('UPDATE toc SET count=count+1,lastmod=NOW() WHERE id=?', [toc.id]);
			matches.push({ sourceBookId: SOURCE_BOOK_ID, sourceEntryId: record.sourceId,
				localHadithId: Number(result.insertId), localReference: record.localRef });
		}
		await query('UPDATE books SET content_lastmod=NOW() WHERE id=?', [BOOK_ID]);
		await query('COMMIT');
	} catch (error) {
		await query('ROLLBACK').catch(() => {});
		throw error;
	} finally { connection.end(); }
	const enriched = await enrichHadithMatches(matches);
	if (enriched.rejected.length) throw new Error(`Inserted gaps but enrichment rejected: ${JSON.stringify(enriched.rejected)}`);
	console.log(`Inserted and enriched ${enriched.applied.length} missing Shamail hadiths.`);
}

if (require.main === module) main().catch(error => { console.error(`ERROR: ${error.stack || error.message}`); process.exitCode = 1; });

module.exports = { gaps };
