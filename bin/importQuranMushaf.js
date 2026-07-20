#!/usr/bin/env node
'use strict';

const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3');
require('../lib/Globals');
const QuranMushaf = require('../lib/QuranMushaf');

const source = path.resolve(process.argv[2] || path.join(__dirname, '..', 'temp', 'pages.db'));

function sqliteAll(db, sql) {
	return new Promise((resolve, reject) => db.all(sql, (err, rows) => err ? reject(err) : resolve(rows)));
}

function chunks(items, size) {
	const out = [];
	for (let i = 0; i < items.length; i += size)
		out.push(items.slice(i, i + size));
	return out;
}

async function insertRows(table, columns, rows) {
	for (const batch of chunks(rows, 2000)) {
		const values = batch.map(row => `(${columns.map(column => QuranMushaf.sql(row[column])).join(',')})`).join(',');
		await global.query(`INSERT INTO ${table} (${columns.join(',')}) VALUES ${values}`);
	}
}

const SOURCE_WORD_INSERTIONS = {
	'2:181': { position: 4, text: 'مَا', meaning: 'what', grammar: 'REL' },
	'8:6': { position: 5, text: 'مَا', meaning: 'what', grammar: 'REL' },
	'13:37': { position: 9, text: 'مَا', meaning: 'what', grammar: 'REL' }
};

async function quranWordMap(corpus, expectedLastWordId) {
	const rows = [];
	let globalWordId = 0;
	let lastRef = '';
	let currentPosition = 0;
	for (const corpusWord of corpus) {
		const ref = `${corpusWord.surah}:${corpusWord.ayah}`;
		if (lastRef && ref !== lastRef) {
			const parts = lastRef.split(':').map(Number);
			rows.push({ global_word_id: ++globalWordId, surah: parts[0], ayah: parts[1], word: null, corpus_word_id: null, source_text: null, source_meaning_en: null, source_grammar: null, is_ayah_marker: 1 });
			currentPosition = 0;
		}
		const insertion = SOURCE_WORD_INSERTIONS[ref];
		if (insertion && currentPosition + 1 === insertion.position) {
			rows.push({ global_word_id: ++globalWordId, surah: corpusWord.surah, ayah: corpusWord.ayah, word: insertion.position, corpus_word_id: null, source_text: insertion.text, source_meaning_en: insertion.meaning, source_grammar: insertion.grammar, is_ayah_marker: 0 });
			currentPosition += 1;
		}
		currentPosition += 1;
		rows.push({ global_word_id: ++globalWordId, surah: corpusWord.surah, ayah: corpusWord.ayah, word: currentPosition, corpus_word_id: corpusWord.id, source_text: null, source_meaning_en: null, source_grammar: null, is_ayah_marker: 0 });
		lastRef = ref;
	}
	if (lastRef) {
		const parts = lastRef.split(':').map(Number);
		rows.push({ global_word_id: ++globalWordId, surah: parts[0], ayah: parts[1], word: null, corpus_word_id: null, source_text: null, source_meaning_en: null, source_grammar: null, is_ayah_marker: 1 });
	}
	if (rows.length !== expectedLastWordId || rows[rows.length - 1]?.global_word_id !== expectedLastWordId)
		throw new Error(`Quran word source/layout mismatch: mapped ${rows.length}, layout ends at ${expectedLastWordId}`);
	return rows;
}

async function run() {
	if (!fs.existsSync(source) || fs.statSync(source).size < 1)
		throw new Error(`Mushaf SQLite database is missing or empty: ${source}`);
	const db = new sqlite3.Database(source, sqlite3.OPEN_READONLY);
	try {
		const info = (await sqliteAll(db, 'SELECT name, number_of_pages, lines_per_page, font_name FROM info LIMIT 1'))[0];
		const pages = (await sqliteAll(db, 'SELECT page_number, line_number, line_type, is_centered, first_word_id, last_word_id, surah_number FROM pages ORDER BY page_number, line_number')).map(row => {
			['first_word_id', 'last_word_id', 'surah_number'].forEach(column => {
				if (row[column] === '')
					row[column] = null;
			});
			return row;
		});
		if (!info || pages.length < 1)
			throw new Error('Mushaf SQLite database has no info or page lines');
		await QuranMushaf.ensureTables();
		const corpus = await global.query(`
			SELECT id, surah, ayah, word
			FROM quran_corpus_words
			WHERE ayah > 0
			ORDER BY surah, ayah, word`);
		const maxLayoutWord = Math.max(...pages.map(row => Number(row.last_word_id) || 0));
		const wordMap = await quranWordMap(corpus, maxLayoutWord);
		await global.query('START TRANSACTION');
		try {
			await global.query('DELETE FROM quran_mushaf_words');
			await global.query('DELETE FROM quran_mushaf_pages');
			await global.query('DELETE FROM quran_mushaf_info');
			await insertRows('quran_mushaf_info', ['id', 'name', 'number_of_pages', 'lines_per_page', 'font_name'], [Object.assign({ id: 1 }, info)]);
			await insertRows('quran_mushaf_pages', ['page_number', 'line_number', 'line_type', 'is_centered', 'first_word_id', 'last_word_id', 'surah_number'], pages);
			await insertRows('quran_mushaf_words', ['global_word_id', 'surah', 'ayah', 'word', 'corpus_word_id', 'source_text', 'source_meaning_en', 'source_grammar', 'is_ayah_marker'], wordMap);
			await QuranMushaf.syncSectionMappings();
			await global.query('COMMIT');
		} catch (err) {
			await global.query('ROLLBACK');
			throw err;
		}
		console.log(`Imported ${pages.length} lines across ${info.number_of_pages} pages and mapped ${wordMap.length} Quran words/markers.`);
	} finally {
		db.close();
		global.dbPool.end();
	}
}

run().catch(err => {
	console.error(err.stack || err.message || err);
	global.dbPool.end();
	process.exitCode = 1;
});
