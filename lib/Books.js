/* jslint node:true, esversion:9 */
'use strict';

const Arabic = require('./Arabic');

function searchAliases(data, lang) {
	var values;
	if (lang === 'ar') {
		values = [data.book_name || data.name, data.book_shortName || data.shortName];
		return unique(values.concat(values.map(removeArabicDiacritics)));
	}
	values = [data.book_alias || data.alias, data.book_name_en || data.name_en, data.book_shortName_en || data.shortName_en];
	var folded = values.map(removeLatinDiacritics);
	return unique(values.concat(
		folded,
		folded.map(removeLatinArticles),
		aliasSeparators(data.book_alias || data.alias)
	));
}

function matchesQuery(data, query, lang) {
	var normalizedQuery = normalize(query, lang);
	if (normalizedQuery === '')
		return false;
	return searchAliases(data, lang).some(alias => normalize(alias, lang).startsWith(normalizedQuery));
}

function findReference(query, books) {
	var reference = Arabic.toLatinDigits(query || '').trim().match(/^(.+?)[\s:]+(\d+[a-z]*)$/iu);
	if (!reference || !Array.isArray(books))
		return null;
	var bookQuery = reference[1];
	var lang = Arabic.isArabic(bookQuery) ? 'ar' : 'en';
	var normalizedQuery = normalize(bookQuery, lang);
	var book = books.find(function (candidate) {
		return candidate?.alias !== 'quran' && searchAliases(candidate, lang).some(alias => normalize(alias, lang) === normalizedQuery);
	});
	if (!book)
		return null;
	var num = reference[2].toLowerCase();
	return {
		book: book,
		num: num,
		ref: `${book.alias}:${num}`
	};
}

function normalize(value, lang) {
	value = (value || '').toString();
	if (lang === 'ar')
		return Arabic.normalize(Arabic.removeArabicDiacritics(value)).replace(/[^\p{L}\d]+/gu, '');
	return removeLatinDiacritics(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function removeLatinArticles(value) {
	return (value || '').replace(/\b(?:al|an|ar|as|ash|at|ad|adh|az)\b/gi, '').replace(/\s+/g, ' ').trim();
}

function aliasSeparators(alias) {
	alias = (alias || '').toString().trim();
	if (alias === '')
		return [];
	return [
		alias.replace(/[-_]+/g, ' '),
		alias.replace(/[-_]+/g, ''),
		alias.replace(/[-_]+/g, '-')
	];
}

function removeArabicDiacritics(value) {
	return Arabic.removeArabicDiacritics(value || '');
}

function removeLatinDiacritics(value) {
	return Arabic.removeLatinDiacritics(value || '')
		.replace(/[ʿʾ'’`]/g, '')
		.replace(/[-_]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function unique(values) {
	return Array.from(new Set(values.filter(value => typeof value === 'string' && value.trim() !== '')));
}

module.exports = {
	findReference,
	matchesQuery,
	searchAliases
};
