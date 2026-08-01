#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const util = require('util');
const MySQL = require('mysql');

const ROOT = path.resolve(__dirname, '..');
const DRY_RUN = process.argv.includes('--dry-run');
let dbPool;
const EDITIONS = Object.freeze([
	{
		slug: 'indo-pak',
		name: 'Indo-Pak',
		bodyColumn: 'body_indopak',
		ayahFile: path.join(ROOT, 'temp', 'indopak-ayat.json'),
		wordFile: path.join(ROOT, 'temp', 'indopak-words.json')
	},
	{
		slug: 'warsh',
		name: 'Warsh',
		bodyColumn: 'body_warsh',
		ayahFile: path.join(ROOT, 'temp', 'warsh-uthmani-ayat.json'),
		wordFile: path.join(ROOT, 'temp', 'warsh-uthmani-words.json')
	}
]);

function selectedEditions(argv) {
	const index = argv.indexOf('--script');
	if (index < 0)
		return EDITIONS;
	const slug = (argv[index + 1] || '').toString().trim().toLowerCase();
	const editions = EDITIONS.filter(edition => edition.slug === slug);
	if (editions.length < 1)
		throw new Error(`--script must be one of: ${EDITIONS.map(edition => edition.slug).join(', ')}`);
	return editions;
}

function readJson(file) {
	if (!fs.existsSync(file) || fs.statSync(file).size < 1)
		throw new Error(`Quran script source is missing or empty: ${file}`);
	return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function positiveInteger(value, label) {
	const number = Number(value);
	if (!Number.isInteger(number) || number < 1)
		throw new Error(`${label} must be a positive integer; received ${value}`);
	return number;
}

function requiredText(value, label) {
	if (typeof value !== 'string' || value.length < 1)
		throw new Error(`${label} must contain text`);
	return value;
}

function editionText(edition, value, label) {
	const text = requiredText(value, label);
	return edition.slug === 'warsh' ? text.replace(/۞\s*/gu, '').trim() : text;
}

function loadEdition(edition) {
	const ayahSource = readJson(edition.ayahFile);
	const wordSource = readJson(edition.wordFile);
	if (!ayahSource || Array.isArray(ayahSource) || typeof ayahSource !== 'object')
		throw new Error(`${edition.name} ayah source must be an object keyed by surah:ayah`);
	if (!wordSource || Array.isArray(wordSource) || typeof wordSource !== 'object')
		throw new Error(`${edition.name} word source must be an object keyed by surah:ayah:word`);

	const ayahs = Object.entries(ayahSource).map(([key, row]) => {
		const surah = positiveInteger(row && row.surah, `${edition.name} ayah ${key} surah`);
		const ayah = positiveInteger(row && row.ayah, `${edition.name} ayah ${key} ayah`);
		if (key !== `${surah}:${ayah}` || row.verse_key !== key)
			throw new Error(`${edition.name} ayah key mismatch at ${key}`);
		return { ref: key, surah, ayah, source_id: positiveInteger(row.id, `${edition.name} ayah ${key} id`), text: editionText(edition, row.text, `${edition.name} ayah ${key}`) };
	}).sort((a, b) => a.surah - b.surah || a.ayah - b.ayah);

	const words = Object.entries(wordSource).map(([key, row]) => {
		const surah = positiveInteger(row && row.surah, `${edition.name} word ${key} surah`);
		const ayah = positiveInteger(row && row.ayah, `${edition.name} word ${key} ayah`);
		const word = positiveInteger(row && row.word, `${edition.name} word ${key} position`);
		if (key !== `${surah}:${ayah}:${word}` || row.location !== key)
			throw new Error(`${edition.name} word key mismatch at ${key}`);
		return { surah, ayah, word, source_id: positiveInteger(row.id, `${edition.name} word ${key} id`), text: editionText(edition, row.text, `${edition.name} word ${key}`) };
	}).sort((a, b) => a.surah - b.surah || a.ayah - b.ayah || a.word - b.word);

	const wordsByAyah = new Map();
	for (const row of words) {
		const ref = `${row.surah}:${row.ayah}`;
		if (!wordsByAyah.has(ref)) wordsByAyah.set(ref, []);
		wordsByAyah.get(ref).push(row);
	}
	for (const row of ayahs) {
		const ayahWords = wordsByAyah.get(row.ref) || [];
		if (ayahWords.length < 1)
			throw new Error(`${edition.name} ayah ${row.ref} has no words`);
		ayahWords.forEach((word, index) => {
			if (word.word !== index + 1)
				throw new Error(`${edition.name} word positions are not contiguous at ${row.ref}`);
		});
		if (ayahWords.map(word => word.text).join(' ') !== row.text)
			throw new Error(`${edition.name} word text does not reconstruct ayah ${row.ref}`);
		wordsByAyah.delete(row.ref);
	}
	if (wordsByAyah.size > 0)
		throw new Error(`${edition.name} contains words for unknown ayah ${wordsByAyah.keys().next().value}`);
	return Object.assign({}, edition, { ayahs, words });
}

async function ensureColumn(query, table, name, definition) {
	const rows = await query(`SHOW COLUMNS FROM ${table} LIKE ${MySQL.escape(name)}`);
	if (rows.length < 1)
		await query(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
}

async function ensureTables(query) {
	await ensureColumn(query, 'hadiths', 'body_indopak', 'MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL AFTER body_ar_alt');
	await ensureColumn(query, 'hadiths', 'body_warsh', 'MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL AFTER body_indopak');
	await query(`
		CREATE TABLE IF NOT EXISTS quran_corpus_script_words (
			script_slug VARCHAR(32) NOT NULL,
			surah SMALLINT NOT NULL,
			ayah SMALLINT NOT NULL,
			word SMALLINT NOT NULL,
			source_id INT NOT NULL,
			text VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
			PRIMARY KEY (script_slug, surah, ayah, word),
			UNIQUE KEY uq_quran_corpus_script_word_source (script_slug, source_id),
			KEY ndx_quran_corpus_script_word_ayah (script_slug, surah, ayah)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`);
}

async function insertRows(query, table, columns, rows) {
	for (let offset = 0; offset < rows.length; offset += 1000) {
		const batch = rows.slice(offset, offset + 1000);
		const values = batch.map(row => `(${columns.map(column => MySQL.escape(row[column])).join(',')})`).join(',');
		await query(`INSERT INTO ${table} (${columns.join(',')}) VALUES ${values}`);
	}
}

async function replaceEdition(query, edition) {
	await query(`UPDATE hadiths h JOIN toc t ON h.tocId=t.id SET h.${edition.bodyColumn}=NULL WHERE t.bookId=0`);
	await query('DROP TEMPORARY TABLE IF EXISTS quran_script_ayah_import');
	await query(`CREATE TEMPORARY TABLE quran_script_ayah_import (
		ref VARCHAR(45) NOT NULL PRIMARY KEY,
		text MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL
	) ENGINE=InnoDB`);
	await insertRows(query, 'quran_script_ayah_import', ['ref', 'text'], edition.ayahs);
	await query(`
		UPDATE hadiths h
		JOIN toc t ON h.tocId=t.id AND t.bookId=0
		JOIN quran_script_ayah_import imported ON imported.ref=h.num
		SET h.${edition.bodyColumn}=imported.text`);
	await query(`DELETE FROM quran_corpus_script_words WHERE script_slug=${MySQL.escape(edition.slug)}`);
	await insertRows(query, 'quran_corpus_script_words', ['script_slug', 'surah', 'ayah', 'word', 'source_id', 'text'],
		edition.words.map(row => Object.assign({ script_slug: edition.slug }, row)));
}

async function verifyEdition(query, edition) {
	const [counts] = await query(`
		SELECT
			(SELECT COUNT(*) FROM hadiths h JOIN toc t ON h.tocId=t.id WHERE t.bookId=0 AND h.${edition.bodyColumn} IS NOT NULL) AS ayahs,
			(SELECT COUNT(*) FROM quran_corpus_script_words WHERE script_slug=${MySQL.escape(edition.slug)}) AS words`);
	if (Number(counts.ayahs) !== edition.ayahs.length || Number(counts.words) !== edition.words.length)
		throw new Error(`${edition.name} database count mismatch: ${counts.ayahs} ayahs, ${counts.words} words`);
}

async function removeLegacyTables(query) {
	await query('DROP TABLE IF EXISTS quran_script_ayah_mappings');
	await query('DROP TABLE IF EXISTS quran_script_words');
	await query('DROP TABLE IF EXISTS quran_script_ayahs');
	await query('DROP TABLE IF EXISTS quran_scripts');
}

async function run() {
	const editions = selectedEditions(process.argv.slice(2)).map(loadEdition);
	for (const edition of editions)
		console.log(`Validated ${edition.name}: ${edition.ayahs.length} ayahs and ${edition.words.length} words.`);
	if (DRY_RUN) return;

	const settings = require(path.join(os.homedir(), '.hadithdb', 'settings.json'));
	dbPool = MySQL.createPool(Object.assign({ connectTimeout: 5000, acquireTimeout: 5000 }, settings.mysql.connection));
	const connection = await util.promisify(dbPool.getConnection).bind(dbPool)();
	const query = util.promisify(connection.query).bind(connection);
	try {
		await ensureTables(query);
		await query('START TRANSACTION');
		try {
			for (const edition of editions) await replaceEdition(query, edition);
			for (const edition of editions) await verifyEdition(query, edition);
			await query('COMMIT');
		} catch (err) {
			await query('ROLLBACK');
			throw err;
		}
		await removeLegacyTables(query);
		for (const edition of editions)
			console.log(`Imported ${edition.name}: ${edition.ayahs.length} ayahs and ${edition.words.length} words.`);
	} finally {
		connection.release();
		dbPool.end();
	}
}

run().catch(err => {
	console.error(err.stack || err.message || err);
	if (dbPool) dbPool.end();
	process.exitCode = 1;
});
