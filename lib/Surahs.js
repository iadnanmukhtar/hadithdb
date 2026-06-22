/* jslint node:true, esversion:9 */
'use strict';

const Arabic = require('./Arabic');
const debug = require('./Debug')('hadithdb:Surahs');

// In-memory surah cache, populated by load() from the `toc` table (quran level-1
// heading rows). Replaces the retired lib/Surahs.json. The array reference is
// stable — load() mutates it in place — so `module.exports.surahs` and
// `global.surahs` always reflect the latest load.
const surahs = [];

const REVELATION_LABELS = {
	makki: { en: 'Makki', ar: 'مكية' },
	madani: { en: 'Madani', ar: 'مدنية' }
};

function parseAliases(value) {
	if (Array.isArray(value))
		return value.filter(Boolean);
	if (typeof value === 'string' && value.trim() !== '') {
		try {
			var parsed = JSON.parse(value);
			return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
		} catch (err) {
			debug.error(`failed to parse surah_aliases JSON: ${err.message} value=${value}`);
			return [];
		}
	}
	return [];
}

function normalizeRevelation(value) {
	return Arabic.toLatinDigits(value || '').toString().trim().toLowerCase() || null;
}

/**
 * Load the surah cache from the toc table. Idempotent — safe to call repeatedly
 * (e.g. on book reload). Populates both the module-level array and global.surahs.
 * @returns {Promise<object[]>}
 */
async function load() {
	var rows = await global.query(`
		SELECT t.h1 AS num, t.title_en AS name_en, t.title AS name_ar,
			t.surah_ayahs AS ayahs, t.surah_revelation AS revelation, t.surah_aliases AS aliases
		FROM toc t
		JOIN books b ON b.id = t.bookId
		WHERE b.alias = 'quran' AND t.level = 1
		ORDER BY t.h1`);
	var mapped = rows.map(function (row) {
		var revelation = normalizeRevelation(row.revelation);
		var aliases = parseAliases(row.aliases);
		return {
			num: Number(row.num),
			alias: aliases[0] || '',
			name_en: row.name_en || '',
			name_ar: row.name_ar || '',
			ayahs: Number(row.ayahs) || 0,
			revelation: revelation,
			revelation_en: revelation && REVELATION_LABELS[revelation] ? REVELATION_LABELS[revelation].en : '',
			revelation_ar: revelation && REVELATION_LABELS[revelation] ? REVELATION_LABELS[revelation].ar : '',
			aliases: aliases
		};
	}).filter(function (surah) {
		return Number.isInteger(surah.num);
	});
	surahs.length = 0;
	Array.prototype.push.apply(surahs, mapped);
	global.surahs = surahs;
	debug(`loaded ${surahs.length} surahs into cache`);
	return surahs;
}

function normalize(value) {
	value = Arabic.toLatinDigits(value || '').toString().trim().toLowerCase();
	value = Arabic.normalize(Arabic.removeArabicDiacritics(value));
	value = value.replace(/^(?:surah|surat|sura|سورة)\s+/u, '');
	value = value.replace(/^(?:al[\s_-]+|ال)/u, '');
	return value.replace(/[\s_-]+/g, '');
}

function find(value) {
	var normalized = normalize(value);
	if (normalized === '')
		return null;
	return surahs.find(function (surah) {
		if (`${surah.num}` === normalized)
			return true;
		return (surah.aliases || [surah.alias]).some(alias => normalize(alias) === normalized);
	}) || null;
}

function matches(query) {
	var normalized = normalize(query);
	if (normalized === '')
		return [];
	return surahs.filter(function (surah) {
		return `${surah.num}` === normalized || (surah.aliases || [surah.alias]).some(function (alias) {
			return normalize(alias).indexOf(normalized) >= 0;
		});
	});
}

function searchAliases(surah, lang) {
	if (!surah)
		return [];
	var aliases = (surah.aliases || [surah.alias]).filter(function (alias) {
		return Arabic.isArabic(alias) === (lang === 'ar');
	});
	if (lang === 'ar')
		return unique(aliases.concat(aliases.map(alias => `سورة ${alias}`)));
	return unique(aliases.concat(
		aliases.map(alias => `surah ${alias}`),
		aliases.map(alias => `surat ${alias}`)
	));
}

function unique(values) {
	return Array.from(new Set(values.filter(Boolean)));
}

module.exports = {
	load,
	find,
	matches,
	normalize,
	searchAliases,
	surahs
};
