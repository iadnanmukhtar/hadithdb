#!/usr/bin/env node
'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const Index = require('../../lib/Index');
const QuranMutashabihat = require('../../lib/QuranMutashabihat');

const BATCH_SIZE = 1000;
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const sourceDirArg = args.find(arg => arg !== '--dry-run');
const sourceDir = path.resolve(process.cwd(), sourceDirArg || 'temp/mutashabihat');

(async function () {
	try {
		const data = parseSource(sourceDir);
		if (dryRun) {
			console.log(`Validated ${data.phrases.length} phrases and ${data.occurrences.length} occurrences from ${displayPath(sourceDir)}.`);
			return;
		}
		require('../../lib/Globals');
		await QuranMutashabihat.ensureTables();
		const quranIdsByRef = await loadQuranIds();
		validateQuranIds(data, quranIdsByRef);
		const connection = await getConnection();
		try {
			await beginTransaction(connection);
			await connectionQuery(connection, 'DELETE FROM quran_mutashabihat_occurrences');
			await connectionQuery(connection, 'DELETE FROM quran_mutashabihat_phrases');
			for (let offset = 0; offset < data.phrases.length; offset += BATCH_SIZE)
				await insertPhrases(connection, data.phrases.slice(offset, offset + BATCH_SIZE), quranIdsByRef);
			for (let offset = 0; offset < data.occurrences.length; offset += BATCH_SIZE)
				await insertOccurrences(connection, data.occurrences.slice(offset, offset + BATCH_SIZE), quranIdsByRef);
			const phraseCount = Number((await connectionQuery(connection, 'SELECT COUNT(*) AS count FROM quran_mutashabihat_phrases'))[0].count);
			const occurrenceCount = Number((await connectionQuery(connection, 'SELECT COUNT(*) AS count FROM quran_mutashabihat_occurrences'))[0].count);
			if (phraseCount !== data.phrases.length || occurrenceCount !== data.occurrences.length)
				throw new Error(`Expected ${data.phrases.length} phrases/${data.occurrences.length} occurrences, found ${phraseCount}/${occurrenceCount}.`);
			await commit(connection);
		} catch (err) {
			await rollback(connection);
			throw err;
		} finally {
			connection.release();
		}
		console.log(`Imported ${data.phrases.length} phrases and ${data.occurrences.length} occurrences from ${displayPath(sourceDir)}.`);
	} finally {
		if (global.dbPool)
			global.dbPool.end();
	}
})().catch(function (err) {
	console.error(err.stack || err.message);
	process.exit(1);
});

function parseSource(dir) {
	const phrasesDocument = readJson(path.join(dir, 'phrases.json'));
	const phraseVerses = readJson(path.join(dir, 'phrase_verses.json'));
	if (!phrasesDocument || Array.isArray(phrasesDocument) || typeof phrasesDocument !== 'object')
		throw new Error('phrases.json must contain an object keyed by phrase id.');
	if (!phraseVerses || Array.isArray(phraseVerses) || typeof phraseVerses !== 'object')
		throw new Error('phrase_verses.json must contain an object keyed by surah:ayah.');
	const ayahPhraseOrdinals = new Map();
	for (const [ref, ids] of Object.entries(phraseVerses)) {
		requiredRef(ref, 'phrase_verses');
		if (!Array.isArray(ids))
			throw new Error(`phrase_verses ${ref} must contain an array.`);
		ids.forEach((id, index) => ayahPhraseOrdinals.set(`${ref}:${requiredInteger(id, `phrase id for ${ref}`)}`, index + 1));
	}
	const phrases = [];
	const occurrences = [];
	for (const [rawId, phrase] of Object.entries(phrasesDocument)) {
		const id = requiredInteger(rawId, 'phrase id');
		const source = phrase && phrase.source;
		const sourceRef = source && source.key;
		requiredRef(sourceRef, `phrase ${id} source`);
		phrases.push({
			id,
			sourceRef,
			sourceWordFrom: requiredInteger(source.from, `phrase ${id} source from`),
			sourceWordTo: requiredInteger(source.to, `phrase ${id} source to`),
			surahCount: requiredInteger(phrase.surahs, `phrase ${id} surahs`),
			ayahCount: requiredInteger(phrase.ayahs, `phrase ${id} ayahs`),
			occurrenceCount: requiredInteger(phrase.count, `phrase ${id} count`)
		});
		for (const [ref, ranges] of Object.entries(phrase.ayah || {})) {
			requiredRef(ref, `phrase ${id} ayah`);
			if (!Array.isArray(ranges) || ranges.length < 1)
				throw new Error(`Phrase ${id} ayah ${ref} must contain word ranges.`);
			const ayahPhraseOrdinal = ayahPhraseOrdinals.get(`${ref}:${id}`);
			if (!ayahPhraseOrdinal)
				throw new Error(`phrase_verses ${ref} does not reference phrase ${id}.`);
			ranges.forEach(function (range, index) {
				if (!Array.isArray(range) || range.length !== 2)
					throw new Error(`Phrase ${id} ayah ${ref} has an invalid word range.`);
				const wordFrom = requiredInteger(range[0], `phrase ${id} ${ref} word from`);
				const wordTo = requiredInteger(range[1], `phrase ${id} ${ref} word to`);
				if (wordTo < wordFrom)
					throw new Error(`Phrase ${id} ayah ${ref} has a reversed word range.`);
				occurrences.push({ id, ref, ayahPhraseOrdinal, occurrenceOrdinal: index + 1, wordFrom, wordTo });
			});
		}
	}
	for (const [ref, ids] of Object.entries(phraseVerses)) {
		for (const rawId of ids) {
			const phrase = phrasesDocument[rawId];
			if (!phrase)
				throw new Error(`phrase_verses ${ref} references missing phrase ${rawId}.`);
			if (!phrase.ayah || !phrase.ayah[ref])
				throw new Error(`Phrase ${rawId} has no occurrence for phrase_verses ${ref}.`);
		}
	}
	return { phrases, occurrences };
}

function readJson(filename) {
	return JSON.parse(fs.readFileSync(filename, 'utf8'));
}

function requiredRef(value, label) {
	const ref = QuranMutashabihat.parseRef(value);
	if (!ref)
		throw new Error(`Invalid ${label} Quran ref '${value}'.`);
	return ref;
}

function requiredInteger(value, label) {
	const number = Number(value);
	if (!Number.isInteger(number) || number < 1)
		throw new Error(`${label} must be a positive integer.`);
	return number;
}

async function loadQuranIds() {
	const rows = await Index.docsFromQueryString('hadiths', 'book_alias:quran', 0, 7000, 'num0');
	return new Map(rows.map(row => [row.num, Number(row.hId || row.id || row._id)]));
}

function validateQuranIds(data, quranIdsByRef) {
	for (const phrase of data.phrases) {
		if (!quranIdsByRef.has(phrase.sourceRef))
			throw new Error(`Quran source ${phrase.sourceRef} was not found in the hadiths index.`);
	}
	for (const occurrence of data.occurrences) {
		if (!quranIdsByRef.has(occurrence.ref))
			throw new Error(`Quran occurrence ${occurrence.ref} was not found in the hadiths index.`);
	}
}

async function insertPhrases(connection, rows, quranIdsByRef) {
	const values = rows.map(row => `(${[row.id, quranIdsByRef.get(row.sourceRef), row.sourceWordFrom, row.sourceWordTo, row.surahCount, row.ayahCount, row.occurrenceCount].join(',')})`);
	await connectionQuery(connection, `INSERT INTO quran_mutashabihat_phrases (id, source_hadith_id, source_word_from, source_word_to, surah_count, ayah_count, occurrence_count) VALUES ${values.join(',')}`);
}

async function insertOccurrences(connection, rows, quranIdsByRef) {
	const values = rows.map(row => `(${[row.id, quranIdsByRef.get(row.ref), row.ayahPhraseOrdinal, row.occurrenceOrdinal, row.wordFrom, row.wordTo].join(',')})`);
	await connectionQuery(connection, `INSERT INTO quran_mutashabihat_occurrences (phrase_id, hadith_id, ayah_phrase_ordinal, occurrence_ordinal, word_from, word_to) VALUES ${values.join(',')}`);
}

function getConnection() {
	return new Promise((resolve, reject) => global.dbPool.getConnection((err, connection) => err ? reject(err) : resolve(connection)));
}

function connectionQuery(connection, sql) {
	return new Promise((resolve, reject) => connection.query(sql, (err, result) => err ? reject(err) : resolve(result)));
}

function beginTransaction(connection) {
	return new Promise((resolve, reject) => connection.beginTransaction(err => err ? reject(err) : resolve()));
}

function commit(connection) {
	return new Promise((resolve, reject) => connection.commit(err => err ? reject(err) : resolve()));
}

function rollback(connection) {
	return new Promise(resolve => connection.rollback(() => resolve()));
}

function displayPath(filename) {
	const relative = path.relative(process.cwd(), filename);
	return relative && !relative.startsWith('..') ? relative : filename;
}
