/* jslint node:true, esversion:9 */
'use strict';

const MySQL = require('mysql');
const https = require('https');
const debug = require('./Debug')('hadithdb:QuranTocSubdivisions');

let columnsEnsured = false;
let quranJuzRowsCache = null;
let quranJuzRowsLoaded = false;
let quranSectionRangesBySurahCache = null;
let quranSectionRangesBySurahLoaded = false;
let quranManzilRowsCache = null;
let quranManzilRowsLoaded = false;
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
	await applyVocalizedJuzTitles(quranJuzRowsCache);
	if (!quranJuzRowsLoaded) {
		quranJuzRowsLoaded = true;
		debug(`juz rows warm-up complete from toc: ${quranJuzRowsCache.length}`);
	}
	return quranJuzRowsCache;
}

async function applyVocalizedJuzTitles(rows) {
	var starts = (rows || []).map(function (row) {
		var parts = (row.visual_start || row.start || '').toString().split(':');
		var wordCount = (row.title || '').toString().trim().split(/\s+/).filter(Boolean).length;
		return {
			row: row,
			surah: Number(parts[0]),
			ayah: Number(parts[1]),
			wordCount: Math.max(1, wordCount)
		};
	}).filter(function (entry) {
		return Number.isInteger(entry.surah) && Number.isInteger(entry.ayah);
	});
	if (starts.length === 0)
		return;
	try {
		var conditions = starts.map(function (entry) {
			return `(surah=${MySQL.escape(entry.surah)} AND ayah=${MySQL.escape(entry.ayah)} AND word<=${MySQL.escape(entry.wordCount)})`;
		});
		var words = await global.query(`
			SELECT surah, ayah, word, text
			FROM quran_corpus_words
			WHERE ${conditions.join(' OR ')}
			ORDER BY surah, ayah, word`);
		starts.forEach(function (entry) {
			var titleWords = words.filter(function (word) {
				return Number(word.surah) === entry.surah && Number(word.ayah) === entry.ayah;
			}).map(function (word) {
				return (word.text || '').toString().trim();
			}).filter(Boolean);
			var normalizedStoredTitle = normalizeArabicForMatch(entry.row.title);
			var normalizedCorpusTitle = normalizeArabicForMatch(titleWords.join(' '));
			if (titleWords.length === entry.wordCount && normalizedStoredTitle === normalizedCorpusTitle)
				entry.row.title = titleWords.join(' ');
		});
	} catch (err) {
		debug(`unable to apply vocalized juz titles: ${err.message}`);
	}
}

function normalizeArabicForMatch(value) {
	return (value || '').toString()
		.normalize('NFKD')
		.replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')
		.replace(/[ٱأإآ]/g, 'ا')
		.replace(/ى/g, 'ي')
		.replace(/\s+/g, '')
		.trim();
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
		if (rows.length > 0) {
			quranManzilRowsCache = rows.map(normalizeManzilRow);
			if (!quranManzilRowsLoaded) {
				quranManzilRowsLoaded = true;
				debug(`manzil rows warm-up complete from toc: ${quranManzilRowsCache.length}`);
			}
		} else {
			const fromApi = await manzilRowsFromQuranCom();
			quranManzilRowsCache = Array.isArray(fromApi) ? fromApi : [];
			if (!quranManzilRowsLoaded) {
				quranManzilRowsLoaded = true;
				debug(`manzil rows warm-up complete from API: ${quranManzilRowsCache.length}`);
			}
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
	row.visual_start = row.num === 1
		? '2:1'
		: row.start;
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
	if (!quranSectionRangesBySurahLoaded) {
		quranSectionRangesBySurahLoaded = true;
		debug(`quran section ranges warm-up complete: ${Object.keys(rangesBySurah).length} surahs`);
	}
	return quranSectionRangesBySurahCache;
}

async function preload() {
	await Promise.all([
		juzRows(),
		manzilRows(),
		quranSectionRangesBySurah()
	]);
}

function invalidateSectionRanges() {
	quranSectionRangesBySurahCache = null;
}

function invalidateAll() {
	quranJuzRowsCache = null;
	quranManzilRowsCache = null;
	quranManzilRowsLoading = null;
	invalidateSectionRanges();
}

module.exports = {
	ensureColumns,
	juzRows,
	manzilRows,
	quranSectionRangesBySurah,
	invalidateSectionRanges,
	invalidateAll,
	preload
};
