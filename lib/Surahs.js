/* jslint node:true, esversion:9 */
'use strict';

const Arabic = require('./Arabic');
const surahs = require('./Surahs.json');

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
	find,
	matches,
	normalize,
	searchAliases,
	surahs
};
