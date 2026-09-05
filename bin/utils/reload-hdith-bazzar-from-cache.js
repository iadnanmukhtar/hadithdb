#!/usr/bin/env node
/* jslint node:true, esversion:11 */
'use strict';

require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const mysql = require('mysql');
const os = require('os');
const path = require('path');
const util = require('util');
const zlib = require('zlib');
const Hadith = require('../../lib/Hadith');
const Utils = require('../../lib/Utils');

const BOOKS = Object.freeze({
	'b-11': { bookId: 17, sourceBookId: 11, alias: 'Ibn Khuzaymah' },
	'b-13': { bookId: 34, sourceBookId: 13, alias: 'Tabarani Awsat' },
	'b-14': { bookId: 33, sourceBookId: 14, alias: 'Tabarani Saghir' },
	'b-17': { bookId: 14, sourceBookId: 17, alias: 'Bayhaqi' },
	'b-19': { bookId: 16, sourceBookId: 19, alias: 'Bazzar' }
});
const requestedBook = process.argv.includes('--book') ? process.argv[process.argv.indexOf('--book') + 1] : 'b-19';
const config = BOOKS[requestedBook];
if (!config) throw new Error(`Unsupported source book ${requestedBook}; expected ${Object.keys(BOOKS).join(' or ')}.`);
const BOOK_ID = config.bookId;
const SOURCE_BOOK_ID = config.sourceBookId;
const SOURCE_SLUG = requestedBook;
const CACHE_DIR = process.env.HDITH_CACHE_DIR || path.join('/tmp', 'hadithdb-hdith-six-books-enrichment');
const BOOK_CACHE_DIR = path.join(CACHE_DIR, SOURCE_SLUG);
const options = { apply: process.argv.includes('--apply') };
const LEGACY_GRADE_LABELS = Object.freeze({ 0: null, 1: 'صحيح', 2: 'صحيح الإسناد', 3: 'ضعيف', 4: 'ضعيف الإسناد' });

function readJson(file) {
	const data = fs.readFileSync(file);
	return JSON.parse((file.endsWith('.gz') ? zlib.gunzipSync(data) : data).toString('utf8'));
}

function cachedPayloads() {
	const ids = new Set();
	for (const name of fs.readdirSync(BOOK_CACHE_DIR)) {
		const match = name.match(/^(\d+)\.json(\.gz)?$/);
		if (match) ids.add(Number(match[1]));
	}
	return [...ids].sort((left, right) => left - right).map(id => {
		const plain = path.join(BOOK_CACHE_DIR, `${id}.json`);
		return readJson(fs.existsSync(plain) ? plain : `${plain}.gz`);
	});
}

function compact(value) {
	return String(value === null || value === undefined ? '' : value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function numericReference(value) {
	const match = String(value || '').replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit))).match(/\d+(?:\.\d+)?/);
	return match ? Number(match[0]) : null;
}

function editionReference(payload) {
	return compact((payload.numberings || []).find(row => compact(row?.value))?.value) || null;
}

function sourceReference(payload) {
	return compact(payload.numbering_harf) || editionReference(payload);
}

function footnote(payload) {
	return (Array.isArray(payload.footnotes) ? payload.footnotes : []).map(item =>
		normalizeArabic(typeof item === 'string' ? item : item?.text || item?.content)).filter(Boolean).join('\n\n') || null;
}

function normalizeArabic(value) {
	return Utils.normalizeArabicHonorifics(compact(value)).replace(/[ \t]{2,}/g, ' ').trim();
}

function checksum(payload) {
	return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function prepareSource() {
	const book = readJson(path.join(BOOK_CACHE_DIR, '_book.json.gz'));
	const expected = (book.chapters || []).reduce((total, chapter) => total + Number(chapter.count || 0), 0);
	const payloads = cachedPayloads().filter(payload => payload.book?.slug === SOURCE_SLUG);
	if (payloads.length !== expected)
		throw new Error(`${config.alias} cache is incomplete: found ${payloads.length}/${expected} source entries. The database was not changed.`);
	const chapterOrder = new Map((book.chapters || []).map((chapter, index) => [Number(chapter.id), index + 1]));
	const chapterByPayloadIndex = [];
	for (const chapter of book.chapters || [])
		for (let index = 0; index < Number(chapter.count || 0); index++) chapterByPayloadIndex.push(chapter);
	const records = payloads.map((payload, payloadIndex) => {
		if (payload.is_intro || payload.entry_kind === 'intro') return null;
		let pathItems = Array.isArray(payload.chapter_path) ? payload.chapter_path.slice(0, 3) : [];
		if (!pathItems.length) {
			const chapter = chapterByPayloadIndex[payloadIndex];
			if (chapter) {
				pathItems = [{ id: Number(chapter.id), title: chapter.t || chapter.title }];
				const chapterText = normalizeArabic(payload.chapter_text);
				if (chapterText) pathItems.push({ id: `${chapter.id}:${chapterText}`, title: chapterText });
			}
		}
		const h1 = chapterOrder.get(Number(pathItems[0]?.id));
		if (!h1) throw new Error(`Source entry ${payload.id} has an unknown top-level chapter.`);
		const num = sourceReference(payload);
		const body = normalizeArabic(payload.matn);
		if (!num || !body) throw new Error(`Source entry ${payload.id} is missing its hdith.com number or matn.`);
		const chain = normalizeArabic(payload.isnad_prefix) || null;
		return { payload, sourceId: Number(payload.id), num, num0: numericReference(num), h1,
			pathItems, chain, chainEn: chain ? Hadith.transliteratedNarratorChain(chain).chain_en || null : null,
			body, footnote: footnote(payload), text: compact(`${chain || ''} ${body}`),
			gradeText: LEGACY_GRADE_LABELS[Number(payload.grading?.[0]?.degree)] || null };
	}).filter(Boolean);
	const oversizedGrade = records.find(record => String(record.gradeText || '').length > 45);
	if (oversizedGrade) throw new Error(`Source entry ${oversizedGrade.sourceId} has an oversized legacy grade.`);
	const duplicateNumbers = records.map(record => record.num).filter((num, index, nums) => nums.indexOf(num) !== index);
	if (duplicateNumbers.length) throw new Error(`Duplicate hdith.com ${config.alias} numbers: ${[...new Set(duplicateNumbers)].slice(0, 20).join(', ')}`);
	return { book, expected, payloads, records };
}

function buildOutline(source) {
	const outline = [];
	const keys = new Map();
	for (const record of source.records) {
		let parent = '';
		for (let level = 1; level <= record.pathItems.length; level++) {
			const item = record.pathItems[level - 1];
			const key = `${parent}/${String(item.id)}`;
			if (!keys.has(key)) {
				const siblings = outline.filter(row => row.level === level && row.parent === parent);
				keys.set(key, { key, parent, level, index: siblings.length + 1, title: normalizeArabic(item.title), records: [] });
				outline.push(keys.get(key));
			}
			keys.get(key).records.push(record);
			record[`h${level}`] = keys.get(key).index;
			parent = key;
		}
	}
	return outline;
}

async function replace(source) {
	const settings = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.hadithdb', 'settings.json'), 'utf8')).mysql.connection;
	const connection = mysql.createConnection(settings);
	const query = util.promisify(connection.query).bind(connection);
	const outline = buildOutline(source);
	try {
		const isnadColumns = await query("SHOW COLUMNS FROM hdith_hadith_metadata LIKE 'source_isnad_html'");
		if (String(isnadColumns[0]?.Type || '').toLowerCase() !== 'mediumtext') {
			console.log('Widening hdith_hadith_metadata.source_isnad_html to MEDIUMTEXT...');
			await query('ALTER TABLE hdith_hadith_metadata MODIFY source_isnad_html MEDIUMTEXT NULL');
		}
		await query('START TRANSACTION');
		await query('CREATE TEMPORARY TABLE old_source_hadith_ids (id INT NOT NULL PRIMARY KEY)');
		await query('INSERT INTO old_source_hadith_ids SELECT id FROM hadiths WHERE bookId=?', [BOOK_ID]);
		for (const table of ['hadiths_sim', 'hadiths_sim_candidates', 'hadiths_sim_suppressed']) {
			await query(`DELETE FROM ${table} WHERE hadithId1 IN (SELECT id FROM old_source_hadith_ids)`);
			await query(`DELETE FROM ${table} WHERE hadithId2 IN (SELECT id FROM old_source_hadith_ids)`);
		}
		for (const [table, clause] of [
			['hadiths_grades', 'hadithId IN (SELECT id FROM old_source_hadith_ids)'],
			['hadiths_comments', 'hadithId IN (SELECT id FROM old_source_hadith_ids)'],
			['hadiths_likes', 'hadithId IN (SELECT id FROM old_source_hadith_ids)'],
			['hadiths_sharh', 'hadithId IN (SELECT id FROM old_source_hadith_ids)'],
			['hadith_arabic_revision_state', 'hadith_id IN (SELECT id FROM old_source_hadith_ids)']
		]) await query(`DELETE FROM ${table} WHERE ${clause}`);
		// Virtual-book rows may point into the collection being replaced. Preserve
		// those rows, but detach the stale foreign key until a later crosswalk pass
		// can relink them to the new source-numbered hadith ids.
		await query('UPDATE hadiths_virtual SET hadithId=NULL WHERE hadithId IN (SELECT id FROM old_source_hadith_ids)');
		await query('DELETE FROM hadiths WHERE bookId=?', [BOOK_ID]);
		await query('DELETE FROM toc WHERE bookId=?', [BOOK_ID]);

		let ordinal = 0;
		for (const row of outline) {
			const first = row.records[0], last = row.records[row.records.length - 1];
			await query(`INSERT INTO toc (ordinal,bookId,level,h1,h2,h3,title,start,end,start0,end0,count)
				VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [++ordinal, BOOK_ID, row.level, first.h1, row.level >= 2 ? first.h2 : null,
				row.level >= 3 ? first.h3 : null, row.title, first.num, last.num, first.num0, last.num0, row.records.length]);
			row.tocId = Number((await query('SELECT LAST_INSERT_ID() id'))[0].id);
		}
		const tocByKey = new Map(outline.map(row => [row.key, row.tocId]));
		const chapterCounts = new Map();
		for (const record of source.records) {
			const pathKey = record.pathItems.map(item => String(item.id)).reduce((key, id) => `${key}/${id}`, '');
			record.numInChapter = (chapterCounts.get(record.h1) || 0) + 1;
			chapterCounts.set(record.h1, record.numInChapter);
			record.ordinal = ++ordinal;
			record.tocId = tocByKey.get(pathKey);
		}
		for (let offset = 0; offset < source.records.length; offset += 250) {
			const batch = source.records.slice(offset, offset + 250);
			await query(`INSERT INTO hadiths
				(ordinal,bookId,tocId,numInChapter,h1,h2,h3,num,num0,gradeText,chain,chain_en,body,footnote,text)
				VALUES ?`, [batch.map(record => [record.ordinal, BOOK_ID, record.tocId, record.numInChapter,
					record.h1, record.h2 || null, record.h3 || null, record.num, record.num0, record.gradeText,
					record.chain, record.chainEn, record.body, record.footnote, record.text])]);
		}
		const hadithIds = new Map((await query('SELECT id,num FROM hadiths WHERE bookId=?', [BOOK_ID])).map(row => [row.num, Number(row.id)]));
		if (hadithIds.size !== source.records.length) throw new Error(`Inserted ${hadithIds.size}/${source.records.length} unique ${config.alias} rows.`);
		for (let offset = 0; offset < source.records.length; offset += 250) {
			const batch = source.records.slice(offset, offset + 250);
			await query(`INSERT INTO hdith_hadith_metadata
				(hadith_id,source_book_slug,source_entry_id,source_reference,source_edition_reference,attribution,chain_type,source_isnad_html,source_checksum)
				VALUES ?`, [batch.map(record => [hadithIds.get(record.num), SOURCE_SLUG, record.sourceId, record.num,
					editionReference(record.payload), compact(record.payload.attribution) || null, compact(record.payload.chain_type) || null,
					record.payload.isnad_html || null, '0'.repeat(64)])]);
			await query(`INSERT INTO hdith_book_reference_crosswalk
				(source_book_id,source_entry_id,source_num,source_edition_num,local_hadith_id,local_ref,similarity,is_supplementary)
				VALUES ?`, [batch.map(record => [SOURCE_BOOK_ID, record.sourceId, record.num, editionReference(record.payload),
					hadithIds.get(record.num), record.num, 1, 0])]);
		}
		await query('UPDATE books SET source=?, content_lastmod=NOW() WHERE id=?', [`https://hdith.com/encyclopedia/book/${SOURCE_SLUG}`, BOOK_ID]);
		await query('COMMIT');
		console.log(`Replaced ${config.alias} with ${source.records.length} hdith.com hadith rows and ${outline.length} TOC rows.`);
	} catch (error) {
		await query('ROLLBACK').catch(() => {});
		throw error;
	} finally { connection.end(); }
}

(async () => {
	try {
		const source = prepareSource();
		console.log(`Validated ${source.payloads.length}/${source.expected} cached source entries; ${source.records.length} are hadith rows.`);
		if (!options.apply) return console.log('Dry run complete; the database was not changed.');
		await replace(source);
	} catch (error) { console.error(`ERROR: ${error.stack || error.message}`); process.exitCode = 1; }
})();

module.exports = { buildOutline, cachedPayloads, editionReference, prepareSource, sourceReference };
