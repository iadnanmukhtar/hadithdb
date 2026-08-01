#!/usr/bin/env node
'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const MySQL = require('mysql');
const QuranSimilarAyahs = require('../../lib/QuranSimilarAyahs');
const Index = require('../../lib/Index');

const BATCH_SIZE = 1000;
const SIMILARITY_SOURCE = 'qul_similar_ayah';
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const sourceArg = args.find(arg => arg !== '--dry-run');
const filename = path.resolve(process.cwd(), sourceArg || 'temp/similar.json');

(async function () {
	try {
		const rows = parseRows(filename);
		if (dryRun) {
			console.log(`Validated ${rows.length} similar-ayah matches from ${displayPath(filename)}.`);
			return;
		}
		require('../../lib/Globals');
		await QuranSimilarAyahs.ensureColumns();
		const quranIdsByRef = await loadQuranIds();
		validateQuranIds(rows, quranIdsByRef);
		const connection = await getConnection();
		try {
			await beginTransaction(connection);
			await connectionQuery(connection, `DELETE FROM hadiths_sim WHERE similarity_source=${MySQL.escape(SIMILARITY_SOURCE)} AND similarity_imported=1`);
			await connectionQuery(connection, `
				UPDATE hadiths_sim
				SET similarity_source=NULL,
					similarity_ordinal=NULL,
					matched_words_count=NULL,
					coverage=NULL,
					similarity_score=NULL,
					match_words=NULL
				WHERE similarity_source=${MySQL.escape(SIMILARITY_SOURCE)}
				  AND similarity_imported=0`);
			for (let offset = 0; offset < rows.length; offset += BATCH_SIZE)
				await insertRows(connection, rows.slice(offset, offset + BATCH_SIZE), quranIdsByRef);
			const count = (await connectionQuery(connection, `SELECT COUNT(*) AS count FROM hadiths_sim WHERE similarity_source=${MySQL.escape(SIMILARITY_SOURCE)}`))[0];
			if (!count || Number(count.count) !== rows.length)
				throw new Error(`Expected ${rows.length} imported rows, found ${count ? count.count : 0}.`);
			await commit(connection);
		} catch (err) {
			await rollback(connection);
			throw err;
		} finally {
			connection.release();
		}
		console.log(`Imported ${rows.length} similar-ayah matches from ${displayPath(filename)}.`);
	} finally {
		if (global.dbPool)
			global.dbPool.end();
	}
})().catch(function (err) {
	console.error(err.stack || err.message);
	process.exit(1);
});

function parseRows(sourceFile) {
	const document = JSON.parse(fs.readFileSync(sourceFile, 'utf8'));
	if (!document || Array.isArray(document) || typeof document !== 'object')
		throw new Error(`${displayPath(sourceFile)} must contain an object keyed by surah:ayah.`);
	const rows = [];
	for (const [sourceKey, matches] of Object.entries(document)) {
		const source = requiredRef(sourceKey, 'source');
		if (!Array.isArray(matches))
			throw new Error(`${sourceKey} must contain an array of similar ayahs.`);
		const seen = new Set();
		matches.forEach(function (match, index) {
			const matched = requiredRef(match && match.matched_ayah_key, `match for ${sourceKey}`);
			const matchedKey = `${matched.surah}:${matched.ayah}`;
			if (seen.has(matchedKey))
				throw new Error(`${sourceKey} contains duplicate match ${matchedKey}.`);
			seen.add(matchedKey);
			const matchedWordsCount = requiredNumber(match.matched_words_count, `${sourceKey} ${matchedKey} matched_words_count`, 1000, true);
			const coverage = requiredNumber(match.coverage, `${sourceKey} ${matchedKey} coverage`, 10000);
			const score = requiredNumber(match.score, `${sourceKey} ${matchedKey} score`, 100);
			if (!Array.isArray(match.match_words))
				throw new Error(`${sourceKey} ${matchedKey} match_words must be an array.`);
			rows.push({
				sourceRef: sourceKey,
				sourceSurah: source.surah,
				sourceAyah: source.ayah,
				ordinal: index + 1,
				matchedSurah: matched.surah,
				matchedAyah: matched.ayah,
				matchedRef: matchedKey,
				matchedWordsCount,
				coverage,
				score,
				matchWords: match.match_words
			});
		});
	}
	if (rows.length < 1)
		throw new Error(`${displayPath(sourceFile)} contains no similar-ayah matches.`);
	return rows;
}

function requiredRef(value, label) {
	const ref = QuranSimilarAyahs.parseRef(value);
	if (!ref)
		throw new Error(`Invalid ${label} Quran ref '${value}'.`);
	return ref;
}

function requiredNumber(value, label, maximum, integerOnly) {
	const number = Number(value);
	if (!Number.isFinite(number) || number < 0 || number > maximum || (integerOnly && !Number.isInteger(number)))
		throw new Error(`${label} must be ${integerOnly ? 'an integer' : 'a number'} between 0 and ${maximum}.`);
	return number;
}

async function loadQuranIds() {
	const rows = await Index.docsFromQueryString('hadiths', 'book_alias:quran', 0, 7000, 'num0');
	return new Map(rows.map(row => [row.num, Number(row.hId || row.id || row._id)]));
}

function validateQuranIds(rows, quranIdsByRef) {
	for (const row of rows) {
		if (!quranIdsByRef.has(row.sourceRef))
			throw new Error(`Quran source ${row.sourceRef} was not found in the hadiths index.`);
		if (!quranIdsByRef.has(row.matchedRef))
			throw new Error(`Quran match ${row.matchedRef} was not found in the hadiths index.`);
	}
}

async function insertRows(connection, rows, quranIdsByRef) {
	if (rows.length < 1)
		return;
	const values = rows.map(function (row) {
		return `(${[
			quranIdsByRef.get(row.sourceRef),
			quranIdsByRef.get(row.matchedRef),
			MySQL.escape(SIMILARITY_SOURCE),
			1,
			row.ordinal,
			row.matchedWordsCount,
			row.coverage,
			row.score,
			MySQL.escape(JSON.stringify(row.matchWords))
		].join(',')})`;
	});
	await connectionQuery(connection, `
		INSERT INTO hadiths_sim (
			hadithId1, hadithId2, similarity_source, similarity_imported, similarity_ordinal,
			matched_words_count, coverage, similarity_score, match_words
		) VALUES ${values.join(',')}
		ON DUPLICATE KEY UPDATE
			similarity_source=VALUES(similarity_source),
			similarity_ordinal=VALUES(similarity_ordinal),
			matched_words_count=VALUES(matched_words_count),
			coverage=VALUES(coverage),
			similarity_score=VALUES(similarity_score),
			match_words=VALUES(match_words)`);
}

function getConnection() {
	return new Promise(function (resolve, reject) {
		global.dbPool.getConnection(function (err, connection) {
			if (err)
				return reject(err);
			resolve(connection);
		});
	});
}

function connectionQuery(connection, sql) {
	return new Promise(function (resolve, reject) {
		connection.query(sql, function (err, result) {
			if (err)
				return reject(err);
			resolve(result);
		});
	});
}

function beginTransaction(connection) {
	return new Promise(function (resolve, reject) {
		connection.beginTransaction(function (err) {
			if (err)
				return reject(err);
			resolve();
		});
	});
}

function commit(connection) {
	return new Promise(function (resolve, reject) {
		connection.commit(function (err) {
			if (err)
				return reject(err);
			resolve();
		});
	});
}

function rollback(connection) {
	return new Promise(function (resolve) {
		connection.rollback(function () {
			resolve();
		});
	});
}

function displayPath(sourceFile) {
	const relative = path.relative(process.cwd(), sourceFile);
	return relative && !relative.startsWith('..') ? relative : sourceFile;
}
