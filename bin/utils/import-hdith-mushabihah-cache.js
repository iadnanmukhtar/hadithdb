#!/usr/bin/env node
/* jslint node:true, esversion:11 */
'use strict';

require('dotenv').config();
const fs = require('fs');
const mysql = require('mysql');
const os = require('os');
const path = require('path');
const util = require('util');
const zlib = require('zlib');

const CACHE_DIR = process.env.HDITH_CACHE_DIR || path.join('/tmp', 'hadithdb-hdith-six-books-enrichment');
const BASE_URL = 'https://hdith.com';

function compact(value) {
	return String(value === null || value === undefined ? '' : value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function cachedFiles(directory = CACHE_DIR) {
	return fs.readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isDirectory() && /^b-\d+$/.test(entry.name))
		.flatMap(entry => fs.readdirSync(path.join(directory, entry.name)).filter(name => /^\d+\.json(?:\.gz)?$/.test(name))
			.map(name => path.join(directory, entry.name, name)));
}

function readPayload(file) {
	const data = fs.readFileSync(file);
	return JSON.parse((file.endsWith('.gz') ? zlib.gunzipSync(data) : data).toString('utf8'));
}

function sourceBookId(payload, file) {
	const slug = compact(payload.book?.slug) || path.basename(path.dirname(file));
	const match = slug.match(/^b-(\d+)$/);
	return match ? Number(match[1]) : null;
}

function cachedSimilarRows(payload, file) {
	const parentBookId = sourceBookId(payload, file);
	const parentEntryId = Number(payload.id);
	if (!parentBookId || !parentEntryId) return [];
	const seen = new Set();
	return (payload.similars || []).flatMap(similar => {
		const targetBookId = Number(similar.book_id);
		const targetEntryId = Number(similar.entry_id);
		const key = `${targetBookId}:${targetEntryId}`;
		if (!targetBookId || !targetEntryId || seen.has(key)) return [];
		seen.add(key);
		return [{
			parentBookId, parentEntryId, parentNumber: compact(payload.numbering_harf || payload.numberings?.[0]?.value) || null,
			targetBookId, targetEntryId,
			targetBookTitle: compact(similar.book) || null,
			targetNumber: compact(similar.numbering) || null,
			bodyStart: compact(similar.tarf || similar.matn) || null
		}];
	});
}

function crosswalkKey(bookId, entryId) { return `${Number(bookId)}:${Number(entryId)}`; }

function resolveRows(rows, crosswalk, localBooks, exactHadiths = new Map()) {
	const statistics = { cached: rows.length, parentMissing: 0, targetBookAbsent: 0, targetMissing: 0, exactFallbacks: 0, resolved: 0 };
	const resolved = [];
	for (const row of rows) {
		const parentBook = localBooks.get(row.parentBookId);
		let parent = crosswalk.get(crosswalkKey(row.parentBookId, row.parentEntryId));
		if (!parent && parentBook?.referenceMode === 'exact' && row.parentNumber) {
			parent = exactHadiths.get(`${parentBook.bookId}:${row.parentNumber}`);
			if (parent) statistics.exactFallbacks++;
		}
		if (!parent) { statistics.parentMissing++; continue; }
		const targetBook = localBooks.get(row.targetBookId);
		if (!targetBook) { statistics.targetBookAbsent++; continue; }
		let target = crosswalk.get(crosswalkKey(row.targetBookId, row.targetEntryId));
		if (!target && targetBook.referenceMode === 'exact' && row.targetNumber) {
			target = exactHadiths.get(`${targetBook.bookId}:${row.targetNumber}`);
			if (target) statistics.exactFallbacks++;
		}
		if (!target || Number(target.bookId) !== Number(targetBook.bookId)) { statistics.targetMissing++; continue; }
		statistics.resolved++;
		resolved.push({ ...row, parentHadithId: parent.hadithId, targetHadithId: target.hadithId,
			internalRef: `${targetBook.alias}:${target.localRef}` });
	}
	return { rows: resolved, statistics };
}

async function main() {
	const apply = process.argv.includes('--apply');
	const settings = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.hadithdb', 'settings.json'), 'utf8')).mysql.connection;
	const connection = mysql.createConnection(settings);
	const query = util.promisify(connection.query).bind(connection);
	try {
		const [bookRows, mapRows, exactRows] = await Promise.all([
			query(`SELECT b.id AS bookId,b.alias,b.hdith_book_id AS sourceBookId,m.reference_mode AS referenceMode
				FROM books b JOIN hdith_book_mappings m ON m.source_book_id=b.hdith_book_id AND m.local_book_id=b.id
				WHERE b.hdith_book_id IS NOT NULL AND b.alias IS NOT NULL`),
			query(`SELECT c.source_book_id AS sourceBookId,c.source_entry_id AS sourceEntryId,
				c.local_hadith_id AS hadithId,c.local_ref AS localRef,h.bookId
				FROM hdith_book_reference_crosswalk c JOIN hadiths h ON h.id=c.local_hadith_id
				WHERE c.local_hadith_id IS NOT NULL AND c.source_entry_id IS NOT NULL`),
			query(`SELECT h.id AS hadithId,h.bookId,h.num AS localRef FROM hadiths h
				JOIN hdith_book_mappings m ON m.local_book_id=h.bookId AND m.reference_mode='exact'`)
		]);
		const localBooks = new Map(bookRows.map(row => [Number(row.sourceBookId), {
			bookId: Number(row.bookId), alias: row.alias, referenceMode: row.referenceMode
		}]));
		const crosswalk = new Map(mapRows.map(row => [crosswalkKey(row.sourceBookId, row.sourceEntryId), {
			hadithId: Number(row.hadithId), localRef: String(row.localRef), bookId: Number(row.bookId)
		}]));
		const files = cachedFiles();
		const cached = [];
		let invalidFiles = 0;
		for (const file of files) {
			try { cached.push(...cachedSimilarRows(readPayload(file), file)); }
			catch (error) { invalidFiles++; console.warn(`Skipping ${file}: ${error.message}`); }
		}
		const exactHadiths = new Map(exactRows.map(row => [`${Number(row.bookId)}:${row.localRef}`, {
			hadithId: Number(row.hadithId), localRef: String(row.localRef), bookId: Number(row.bookId)
		}]));
		const result = resolveRows(cached, crosswalk, localBooks, exactHadiths);
		console.log(`Cache: ${files.length} payloads, ${cached.length} unique page-level mushabihah references, ${invalidFiles} unreadable payloads.`);
		console.log(`Resolution: ${JSON.stringify(result.statistics)}; ${localBooks.size} locally mapped hdith.com books.`);
		if (!apply) return console.log('Dry run complete; no rows were changed.');
		await query('START TRANSACTION');
		for (let offset = 0; offset < result.rows.length; offset += 500) {
			const values = result.rows.slice(offset, offset + 500).map(row => [
				row.parentHadithId, 'similar', row.targetBookId, row.targetBookTitle, row.targetEntryId,
				row.targetNumber, null, row.bodyStart, row.targetHadithId, row.internalRef,
				`${BASE_URL}/encyclopedia/book/b-${row.targetBookId}/h/${row.targetEntryId}`
			]);
			await query(`INSERT INTO hdith_hadith_links
				(hadith_id,link_type,source_book_id,source_book_title,source_entry_id,source_num,label,source_body_start,internal_hadith_id,internal_ref,source_url)
				VALUES ? ON DUPLICATE KEY UPDATE
				source_book_id=VALUES(source_book_id),source_book_title=COALESCE(source_book_title,VALUES(source_book_title)),
				source_num=COALESCE(source_num,VALUES(source_num)),source_body_start=COALESCE(source_body_start,VALUES(source_body_start)),
				internal_hadith_id=VALUES(internal_hadith_id),internal_ref=VALUES(internal_ref),source_url=VALUES(source_url)`, [values]);
		}
		await query('COMMIT');
		const [verified] = await query(`SELECT COUNT(*) total,COUNT(DISTINCT hadith_id) parents
			FROM hdith_hadith_links WHERE link_type='similar' AND internal_hadith_id IS NOT NULL AND internal_ref IS NOT NULL`);
		console.log(`Applied without deleting existing links. Resolved table state: ${verified.total} links across ${verified.parents} hadiths.`);
	} catch (error) {
		if (apply) await query('ROLLBACK').catch(() => {});
		throw error;
	} finally { connection.end(); }
}

if (require.main === module) main().catch(error => { console.error(`ERROR: ${error.stack || error.message}`); process.exitCode = 1; });

module.exports = { cachedSimilarRows, crosswalkKey, resolveRows, sourceBookId };
