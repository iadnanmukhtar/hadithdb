/* jslint node:true, esversion:9 */
'use strict';

const MySQL = require('mysql');
const https = require('https');

let columnsEnsured = false;
let quranJuzRowsCache = null;
let quranSectionRangesBySurahCache = null;
let quranManzilRowsCache = null;
let quranManzilRowsLoading = null;

async function ensureColumns() {
	if (columnsEnsured)
		return;
	await ensureColumn('quran_subdivision', 'varchar(16) NULL');
	await ensureColumn('quran_verse_mapping', 'json NULL');
	columnsEnsured = true;
}

async function ensureColumn(name, definition) {
	var rows = await global.query(`SHOW COLUMNS FROM toc LIKE ${MySQL.escape(name)}`);
	if (rows.length > 0)
		return;
	await global.query(`ALTER TABLE toc ADD COLUMN ${name} ${definition}`);
}

async function juzRows() {
	if (quranJuzRowsCache)
		return quranJuzRowsCache;
	await ensureColumns();
	var rows = await global.query(`
		SELECT id, h1 AS num, title_en, title, start, end, count, quran_verse_mapping
		FROM toc
		WHERE bookId=(SELECT id FROM books WHERE alias='quran' LIMIT 1)
			AND quran_subdivision='juz'
		ORDER BY h1`);
	quranJuzRowsCache = rows.map(normalizeJuzRow);
	return quranJuzRowsCache;
}

async function manzilRows() {
	if (quranManzilRowsCache !== null)
		return quranManzilRowsCache;
	if (quranManzilRowsLoading)
		return quranManzilRowsLoading;
	quranManzilRowsLoading = (async function () {
		await ensureColumns();
		var rows = await global.query(`
			SELECT id, h1 AS num, title_en, title, start, end, count
			FROM toc
			WHERE bookId=(SELECT id FROM books WHERE alias='quran' LIMIT 1)
				AND quran_subdivision='manzil'
			ORDER BY h1`);
		if (rows.length > 0)
			quranManzilRowsCache = rows.map(normalizeManzilRow);
		else {
			const fromApi = await manzilRowsFromQuranCom();
			quranManzilRowsCache = Array.isArray(fromApi) ? fromApi : [];
		}
		return quranManzilRowsCache;
	})()
		.finally(function () {
			quranManzilRowsLoading = null;
		});
	return quranManzilRowsLoading;
}

async function manzilRowsFromQuranCom() {
	var endpoint = 'https://api.quran.com/api/v4/manzils';
	var response = await httpsGetJson(endpoint);
	if (!response || !Array.isArray(response.manzils))
		return [];
	var rows = response.manzils
		.map(function (manzil) {
			var mapping = manzil && manzil.verse_mapping;
			var verseRanges = Object.keys(mapping || {}).map(Number).filter(Number.isInteger).sort(function (a, b) {
				return a - b;
			});
			if (verseRanges.length === 0)
				return null;
			var firstSurah = verseRanges[0];
			var firstRange = (mapping[firstSurah] || '').toString().split('-')[0];
			var startAyah = parseInt(firstRange, 10);
			if (!Number.isInteger(startAyah) || startAyah <= 0)
				startAyah = 1;
			var firstStart = `${firstSurah}:${startAyah}`;
			var lastSurah = verseRanges[verseRanges.length - 1];
			var lastRange = (mapping[lastSurah] || '').toString().split('-').pop();
			var lastAyah = parseInt(lastRange, 10);
			if (!Number.isInteger(lastAyah) || lastAyah <= 0)
				lastAyah = 1;
			return {
				id: Number(manzil && manzil.id) || Number(manzil && manzil.manzil_number),
				num: Number(manzil && manzil.manzil_number) || 1,
				title_en: `Manzil ${Number(manzil && manzil.manzil_number) || 1}`,
				title: `منزل ${Number(manzil && manzil.manzil_number) || 1}`,
				start: firstStart,
				end: `${lastSurah}:${lastAyah}`,
				count: Number(manzil && manzil.verses_count) || 0,
				quran_verse_mapping: mapping
			};
		})
		.filter(Boolean)
		.sort(function (a, b) {
			return Number(a.num) - Number(b.num);
		});
	return rows.map(normalizeManzilRow);
}

function httpsGetJson(url) {
	return new Promise(function (resolve) {
		var request = https.get(url, function (res) {
			if (res.statusCode < 200 || res.statusCode >= 300) {
				res.resume();
				resolve(null);
				return;
			}
			var body = '';
			res.on('data', function (chunk) {
				body += chunk;
			});
			res.on('end', function () {
				try {
					var parsed = JSON.parse(body);
					resolve(parsed);
				} catch (err) {
					resolve(null);
				}
			});
		});
		request.on('error', function () {
			resolve(null);
		});
		request.setTimeout(5000, function () {
			request.destroy(new Error('timeout'));
			resolve(null);
		});
	});
}

function normalizeJuzRow(row) {
	var mapping = row.quran_verse_mapping;
	if (typeof mapping === 'string' && mapping.trim() !== '') {
		try {
			mapping = JSON.parse(mapping);
		} catch (err) {
			mapping = {};
		}
	}
	row.num = Number(row.num);
	row.count = Number(row.count) || 0;
	row.quran_verse_mapping = mapping && typeof mapping === 'object' ? mapping : {};
	return row;
}

function parseStartParts(start) {
	var parts = (start || '').toString().split(':').map(value => parseInt(value, 10));
	var surah = Number.isInteger(parts[0]) ? parts[0] : 1;
	var ayah = Number.isInteger(parts[1]) ? parts[1] : 1;
	return {
		surah: surah,
		ayah: ayah
	};
}

function normalizeManzilRow(row) {
	row.num = Number(row.num);
	row.count = Number(row.count) || 0;
	var startRef = parseStartParts(row.start);
	row.startSurah = startRef.surah;
	row.startAyah = startRef.ayah;
	row.name = row.title_en || row.title || `Manzil ${row.num}`;
	return row;
}

async function quranSectionRangesBySurah() {
	if (quranSectionRangesBySurahCache)
		return quranSectionRangesBySurahCache;
	const rows = await global.query(`
		SELECT h1 AS surah, h2 AS section, h2_start, h2_count
		FROM v_toc
		WHERE book_alias='quran' AND level=2 AND h2_start IS NOT NULL AND h2_count IS NOT NULL
		ORDER BY h1, h2`);
	const rangesBySurah = {};
	for (var i = 0; i < rows.length; i++) {
		var row = rows[i];
		var range = parseStartParts(row.h2_start);
		var section = Number(row.section);
		var count = parseInt(row.h2_count, 10);
		if (!Number.isInteger(section) || !Number.isInteger(range.surah) || !Number.isInteger(range.ayah) || !Number.isInteger(count) || count <= 0)
			continue;
		if (section > 0 && range.surah > 0) {
			rangesBySurah[range.surah] = rangesBySurah[range.surah] || [];
			rangesBySurah[range.surah].push({
				section: section,
				start: range.ayah,
				end: range.ayah + count - 1
			});
		}
	}
	Object.keys(rangesBySurah).forEach(function (surahNum) {
		rangesBySurah[surahNum].sort(function (a, b) {
			if (a.start !== b.start)
				return a.start - b.start;
			return a.section - b.section;
		});
	});
	quranSectionRangesBySurahCache = rangesBySurah;
	return quranSectionRangesBySurahCache;
}

async function preload() {
	await Promise.all([
		juzRows(),
		manzilRows(),
		quranSectionRangesBySurah()
	]);
}

module.exports = {
	ensureColumns,
	juzRows,
	manzilRows,
	quranSectionRangesBySurah,
	preload
};
