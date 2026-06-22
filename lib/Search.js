// @ts-check
'use strict';

const debug = require('./Debug')('hadithdb:Search');
const createError = require('http-errors');
const Arabic = require('../lib/Arabic');
const Books = require('./Books');
const Index = require('./Index');
const Utils = require('./Utils');
const { Item } = require('./Model');
const Surahs = require('./Surahs');
const Tafsir = require('./Tafsir');

global.HILITE_START = '❬';
global.HILITE_END = '❭';

const BOOK_FILTER_GROUPS = Object.freeze({
	sahihayn: Object.freeze({
		label: 'Sahihayn',
		aliases: Object.freeze(['bukhari', 'muslim'])
	}),
	kutubarbaah: Object.freeze({
		label: 'Kutub Arbaah',
		aliases: Object.freeze(['abudawud', 'tirmidhi', 'nasai', 'ibnmajah'])
	}),
	sixbooks: Object.freeze({
		label: 'Kutub Sittah',
		aliases: Object.freeze(['bukhari', 'muslim', 'abudawud', 'tirmidhi', 'nasai', 'ibnmajah'])
	})
});
const SEARCH_ORDER_BY = '_score DESC, book_ordinal ASC, ordinal ASC';
const SEARCH_ES_RESULT_LIMIT = 100;
const MIN_SEARCH_SIGNIFICANT_CHARS = 3;
let quranAyahSearchCache = null;
const QURAN_DAGGER_ALIF_FIXED_WORDS = Object.freeze([
	['هاذا', 'هذا'],
	['هاذه', 'هذه'],
	['ذالك', 'ذلك'],
	['ذالكم', 'ذلكم'],
	['اولايك', 'اولئك'],
	['اوليك', 'اولئك'],
	['هاولا', 'هولا']
]);
const SEARCH_FIELDS = Object.freeze({
	hadith: Object.freeze({
		ar: Object.freeze([
			'body^5',
			'title_search_ar^4',
			'title^4',
			'footnote^2',
			'chain'
		]),
		en: Object.freeze([
			'body_en^5',
			'body_en_search^5',
			'title_en^4',
			'title_en_search^4',
			'title_en_prefix^3',
			'footnote_en^2',
			'footnote_en_search^2',
			'chain_en',
			'chain_en_search'
		])
	}),
		toc: Object.freeze({
			ar: Object.freeze([
				'book_name_search_ar^5',
				'book_shortName_search_ar^5',
				'title_search_ar^4',
			'title^4',
			'intro_search_ar^2',
			'intro^2'
		]),
			en: Object.freeze([
				'book_name_search_en^5',
				'book_shortName_search_en^5',
				'title_en^4',
			'title_search_en^4',
			'title_search_en_prefix^3',
			'intro_en^2',
			'intro_search_en^2'
		])
	}),
	commentary: Object.freeze({
		ar: Object.freeze([
			'text^5',
			'footnotes^2'
		]),
		en: Object.freeze([
			'text_en^5',
			'footnotes_en^2'
		])
	})
});
class Search {

	static truncateQuery(qs) {
		qs = (qs || '').toString().trim();
		if (qs.length > 1024)
			qs = qs.substring(0, 1024);
		return qs;
	}

	static async a_searchText(qs, b, offset, options = {}) {
		qs = Search.truncateQuery(qs);
		if (!hasMinimumSearchCharacters(qs))
			return [];
		try {
			if (Search.isExpressionQuery(qs))
				return await a_searchExpression(qs.trim().substring(1), b, offset, options);
			if (qs.match(/[a-z]/))
				return await a_search(qs, b, 'en', offset, options);
			else
				return await a_search(qs, b, 'ar', offset, options);
		} catch (err) {
			err.message = `Unable to perform text search for [${qs}]`;
			debug.error(`${err.message}\n${err.stack || ''}`);
			throw createError(500, err.message);
		}
	}

	static async a_autocomplete(qs, b, limit, options = {}) {
		qs = Search.truncateQuery(qs);
		limit = parseInt(limit, 10);
		if (!Number.isInteger(limit) || limit < 1)
			limit = 10;
		limit = Math.min(limit, 12);
		if (!hasMinimumSearchCharacters(qs) || Search.isExpressionQuery(qs))
			return [];
		try {
			var lang = qs.match(/[a-z]/) ? 'en' : 'ar';
			var selectedFilters = normalizeBookFilters(b);
			var searchOptions = normalizeSearchOptions(options);
			var suggestionLang = Arabic.isArabic(qs) ? 'ar' : 'en';
			var generated = quranAutocompleteSuggestions(qs, suggestionLang, selectedFilters, searchOptions)
				.concat(quranSurahAutocompleteSuggestions(qs, suggestionLang, selectedFilters, searchOptions))
				.concat(bookReferenceAutocompleteSuggestions(qs, suggestionLang, selectedFilters, searchOptions))
				.concat(tafsirAutocompleteSuggestions(qs, suggestionLang, selectedFilters, searchOptions))
				.concat(translationAutocompleteSuggestions(qs, suggestionLang, selectedFilters, searchOptions))
				.concat(bookAutocompleteSuggestions(qs, suggestionLang, selectedFilters, searchOptions));
			generated = dedupeAutocompleteSuggestions(generated);
			if (generated.length > 0)
				return generated.slice(0, limit);
			if (allowsQuranAyahMemorySearch(selectedFilters, searchOptions))
				return await quranMemoryThenRestAutocompleteSuggestions(qs, lang, selectedFilters, generated, limit);
			var query = buildBookOrdinalQuery(qs, lang, selectedFilters, searchOptions);
			var docs = await Index.docsFromQuery('hadiths,toc,commentaries', query, 0, limit - generated.length, SEARCH_ORDER_BY, true);
			docs.sort(compareSearchResults);
			return dedupeAutocompleteSuggestions(generated.concat(docs.map(doc => formatAutocompleteSuggestion(doc, lang, qs)).filter(Boolean))).slice(0, limit);
		} catch (err) {
			err.message = `Unable to fetch autocomplete suggestions for [${qs}]`;
			debug.error(`${err.message}\n${err.stack || ''}`);
			throw createError(500, err.message);
		}
	}

	static isExpressionQuery(qs) {
		return (qs || '').toString().trim().charAt(0) === '=';
	}

	static describeBookFilters(b) {
		return normalizeBookFilters(b).map(filter => {
			if (filter === 'toc')
				return 'Chapter Headings';
			if (filter === 'commentaries')
				return 'Tafsir';
			if (BOOK_FILTER_GROUPS[filter])
				return BOOK_FILTER_GROUPS[filter].label;
			var book = global.books.find(book => book.alias === filter);
			return book ? book.shortName_en : filter;
		});
	}

}

module.exports = Search;

function hasMinimumSearchCharacters(qs) {
	return countNonDiacriticSearchCharacters(qs) >= MIN_SEARCH_SIGNIFICANT_CHARS;
}

function countNonDiacriticSearchCharacters(qs) {
	var normalized = Arabic.removeLatinDiacritics(Arabic.removeArabicDiacritics(Utils.trimToEmpty(qs)))
		.replace(/\p{Mark}/gu, '');
	var matches = normalized.match(/[\p{L}\d]/gu);
	return matches ? matches.length : 0;
}

function quranAutocompleteSuggestions(qs, lang, selectedFilters, options = {}) {
	if (options.excludeQuranAndTafsir)
		return [];
	if (!allowsQuranSuggestions(selectedFilters))
		return [];
	var normalizedQuery = Arabic.toLatinDigits(qs).trim();
	var reference = normalizedQuery.match(/^(.+?)[\s:]+(\d+)(?:\s*-\s*(\d+))?$/u);
	if (reference) {
		var surah = Surahs.find(reference[1]);
		var ayahFrom = parseInt(reference[2], 10);
		var ayahTo = reference[3] ? parseInt(reference[3], 10) : ayahFrom;
		if (!surah || ayahFrom < 1 || ayahTo < ayahFrom || ayahTo > surah.ayahs)
			return [];
		return [formatQuranReferenceSuggestion(surah, ayahFrom, ayahTo, lang)];
	}
	return [];
}

function quranSurahAutocompleteSuggestions(qs, lang, selectedFilters, options = {}) {
	if (options.excludeQuranAndTafsir)
		return [];
	if (!allowsQuranSuggestions(selectedFilters))
		return [];
	return inMemorySurahMatches(qs, lang)
		.slice(0, 3)
		.map(surah => formatQuranSurahSuggestion(surah, lang));
}

function allowsQuranSuggestions(selectedFilters) {
	if (!selectedFilters || selectedFilters.length < 1)
		return true;
	var bookFilters = expandBookFilters(selectedFilters.filter(filter => filter !== 'toc' && filter !== 'commentaries'));
	if (bookFilters.length > 0)
		return bookFilters.indexOf('quran') >= 0;
	return selectedFilters.indexOf('commentaries') < 0;
}

function bookReferenceAutocompleteSuggestions(qs, lang, selectedFilters, options = {}) {
	var reference = Books.findReference(qs, global.books);
	if (!reference || !isVisibleBook(reference.book))
		return [];
	if (options.excludeQuranAndTafsir && reference.book.alias === 'quran')
		return [];
	if (!allowsBookReferenceSuggestion(reference.book.alias, selectedFilters))
		return [];
	var titleEn = Utils.trimToEmpty(reference.book.name_en || reference.book.shortName_en || reference.book.alias);
	var titleAr = Utils.trimToEmpty(reference.book.title || reference.book.shortName || reference.book.alias);
	var title = lang === 'ar' ? titleAr : titleEn;
	return [{
		label: `${title} ${lang === 'ar' ? Arabic.toArabicDigits(reference.num) : reference.num}`,
		value: reference.ref,
		url: `/${reference.ref}`,
		ref: reference.ref,
		type: 'Hadith',
		is_reference: true,
		is_quran: false,
		lang: lang,
		metadata_en: `${reference.ref} - ${titleEn}`,
		metadata_ar: titleAr,
		fragment: escapeHtml(`${title} ${lang === 'ar' ? Arabic.toArabicDigits(reference.num) : reference.num}`)
	}];
}

function allowsBookReferenceSuggestion(bookAlias, selectedFilters) {
	if (!selectedFilters || selectedFilters.length < 1)
		return true;
	if (selectedFilters.indexOf('commentaries') >= 0 || selectedFilters.indexOf('toc') >= 0)
		return false;
	var bookFilters = expandBookFilters(selectedFilters);
	return bookFilters.length < 1 || bookFilters.indexOf(bookAlias) >= 0;
}

function isVisibleBook(book) {
	if (!book)
		return false;
	if (book.alias === 'quran')
		return true;
	return Number(book.hidden) !== 1;
}

function bookAutocompleteSuggestions(qs, lang, selectedFilters, options = {}) {
	if (!Array.isArray(global.books))
		return [];
	return global.books
		.filter(book => isVisibleBook(book))
		.filter(book => !(options.excludeQuranAndTafsir && book.alias === 'quran'))
		.filter(book => allowsBookAutocompleteSuggestion(book.alias, selectedFilters) && autocompleteNameMatches(book, qs, lang))
		.slice(0, 3)
		.map(book => formatBookAutocompleteSuggestion(book, lang));
}

function tafsirAutocompleteSuggestions(qs, lang, selectedFilters, options = {}) {
	if (options.excludeQuranAndTafsir)
		return [];
	if (!allowsTafsirAutocompleteSuggestion(selectedFilters))
		return [];
	var tafsirAliases = searchOptionTafsirAliases(options);
	return cachedTafsirsForAutocomplete()
		.filter(tafsir => !tafsirAliases.length || tafsirAliases.indexOf(tafsir.alias) >= 0)
		.filter(tafsir => autocompleteNameMatches(tafsir, qs, lang))
		.slice(0, 3)
		.map(tafsir => formatTafsirAutocompleteSuggestion(tafsir, lang));
}

function translationAutocompleteSuggestions(qs, lang, selectedFilters, options = {}) {
	if (options.excludeQuranAndTafsir)
		return [];
	if (!allowsTranslationAutocompleteSuggestion(selectedFilters))
		return [];
	var tafsirAliases = searchOptionTafsirAliases(options);
	return cachedTranslationsForAutocomplete()
		.filter(translation => !tafsirAliases.length || tafsirAliases.indexOf(translation.alias) >= 0)
		.filter(translation => autocompleteNameMatches(translation, qs, lang))
		.slice(0, 3)
		.map(translation => formatTranslationAutocompleteSuggestion(translation, lang));
}

function cachedTafsirsForAutocomplete() {
	var rows = Tafsir.visibleTafsirsSync();
	if (rows.length > 0)
		return rows;
	return cachedCommentaryBooksForAutocomplete('tafsir').map(row => ({
		...row,
		slug: row.slug || Tafsir.tafsirSlug(row.alias)
	}));
}

function cachedTranslationsForAutocomplete() {
	var rows = Tafsir.visibleTranslationsSync();
	if (rows.length > 0)
		return rows;
	return cachedCommentaryBooksForAutocomplete('trans');
}

function cachedCommentaryBooksForAutocomplete(type) {
	var source = Array.isArray(global.bookCatalog) && global.bookCatalog.length > 0 ? global.bookCatalog : global.books;
	if (!Array.isArray(source))
		return [];
	return source.filter(function (book) {
		return Number(book.hidden) === 0 && Utils.trimToEmpty(book.type || book.book_model || book.book_type) === type;
	});
}

function autocompleteNameMatches(data, query, lang) {
	var queryTokens = autocompleteQueryTokenSets(query, lang);
	if (queryTokens.length < 1)
		return false;
	var aliases = autocompleteSearchAliases(data, lang);
	return queryTokens.some(tokens => autocompleteTokensMatchAliases(tokens, aliases, lang));
}

function autocompleteNameNormalize(value, lang) {
	value = Utils.trimToEmpty(value);
	if (lang === 'ar')
		return Arabic.normalize(Arabic.removeArabicDiacritics(value), false).replace(/[^\p{L}\d]+/gu, ' ').trim();
	return Arabic.removeLatinDiacritics(value)
		.replace(/[ʿʾ'’`]/g, '')
		.replace(/[^a-z0-9]+/gi, ' ')
		.toLowerCase()
		.trim();
}

function autocompleteQueryTokenSets(query, lang) {
	var tokens = autocompleteSearchTokens(query, lang);
	if (tokens.length < 1)
		return [];
	var sets = [tokens];
	var withoutTafsir = removeTafsirSearchTokens(tokens, lang);
	if (withoutTafsir.length > 0 && withoutTafsir.length !== tokens.length)
		sets.push(withoutTafsir);
	return sets;
}

function removeTafsirSearchTokens(tokens, lang) {
	var tafsirTokens = lang === 'ar'
		? new Set(['تفسير', 'التفسير'])
		: new Set(['tafsir', 'tafsir']);
	return tokens.filter(token => !tafsirTokens.has(token));
}

function autocompleteSearchAliases(data, lang) {
	var aliases = Books.searchAliases(data, lang);
	if (lang === 'ar') {
		aliases = aliases.concat([
			data.book_author || data.author,
			data.book_author_en || data.author_en
		]);
	} else {
		aliases = aliases.concat([
			data.book_author_en || data.author_en,
			data.book_author || data.author
		]);
	}
	return uniqueStrings(aliases);
}

function autocompleteTokensMatchAliases(tokens, aliases, lang) {
	var normalizedAliases = aliases.map(alias => autocompleteNameNormalize(alias, lang)).filter(Boolean);
	var aliasTokens = normalizedAliases.flatMap(alias => alias.split(/\s+/).filter(Boolean));
	var joinedAliases = normalizedAliases.join(' ');
	return tokens.every(function (token) {
		if (!token)
			return true;
		if (joinedAliases.includes(token))
			return true;
		if (token.length < 2)
			return aliasTokens.some(aliasToken => aliasToken === token);
		return aliasTokens.some(aliasToken => aliasToken.includes(token) || (aliasToken.length >= 3 && token.includes(aliasToken)));
	});
}

function autocompleteSearchTokens(query, lang) {
	return autocompleteNameNormalize(query, lang).split(/\s+/).filter(Boolean);
}

function inMemorySurahMatches(query, lang) {
	var tokens = autocompleteSearchTokens(query, lang);
	if (tokens.length < 1)
		return [];
	var exactSurah = Surahs.find(query);
	var matches = Surahs.surahs.filter(function (surah) {
		var aliases = Surahs.searchAliases(surah, lang).concat(lang === 'ar' ? Surahs.searchAliases(surah, 'en') : Surahs.searchAliases(surah, 'ar'));
		return autocompleteTokensMatchAliases(tokens, aliases, lang);
	});
	if (!exactSurah)
		return matches;
	return [exactSurah].concat(matches.filter(surah => surah.num !== exactSurah.num));
}

function uniqueStrings(values) {
	return Array.from(new Set((values || []).filter(value => typeof value === 'string' && value.trim() !== '')));
}

function allowsTafsirAutocompleteSuggestion(selectedFilters) {
	if (!selectedFilters || selectedFilters.length < 1)
		return true;
	if (selectedFilters.indexOf('commentaries') >= 0)
		return true;
	var bookFilters = expandBookFilters(selectedFilters.filter(filter => filter !== 'toc'));
	return bookFilters.length < 1 || bookFilters.indexOf('quran') >= 0;
}

function allowsTranslationAutocompleteSuggestion(selectedFilters) {
	return allowsTafsirAutocompleteSuggestion(selectedFilters);
}

function allowsBookAutocompleteSuggestion(bookAlias, selectedFilters) {
	if (!selectedFilters || selectedFilters.length < 1)
		return true;
	if (selectedFilters.indexOf('commentaries') >= 0)
		return false;
	var bookFilters = expandBookFilters(selectedFilters.filter(filter => filter !== 'toc'));
	return bookFilters.length < 1 || bookFilters.indexOf(bookAlias) >= 0;
}

function formatQuranReferenceSuggestion(surah, ayahFrom, ayahTo, lang) {
	var range = `${ayahFrom}${ayahTo > ayahFrom ? `-${ayahTo}` : ''}`;
	var ref = `${surah.num}:${range}`;
	var titleEn = `Sūrat ${surah.name_en} ${ref}`;
	var titleAr = `سُورَة ${surah.name_ar} ${Arabic.toArabicDigits(ref)}`;
	return {
		label: lang === 'ar' ? titleAr : titleEn,
		value: lang === 'ar' ? titleAr : titleEn,
		url: `/quran:${ref}`,
		ref: `quran:${ref}`,
		type: 'Ayah',
		is_quran: true,
		lang: lang,
		title_en: titleEn,
		title_ar: titleAr,
		metadata_en: `quran:${ref} - Surah ${surah.name_en}`,
		metadata_ar: `سورة ${surah.name_ar}`,
		fragment: escapeHtml(lang === 'ar' ? titleAr : titleEn)
	};
}

function formatQuranSurahSuggestion(surah, lang) {
	var titleEn = `Sūrat ${surah.name_en}`;
	var titleAr = `سُورَة ${surah.name_ar}`;
	var title = lang === 'ar' ? titleAr : titleEn;
	var ref = quranSurahRef(surah.num);
	var revelation = quranSurahRevelation(surah.num);
	return {
		label: title,
		value: title,
		url: `/quran/${surah.num}`,
		ref: ref,
		alias: ref,
		type: 'Surah',
		is_quran: true,
		lang: lang,
		surah_name_en: surah.name_en,
		surah_name_ar: surah.name_ar,
		ayah_count: surah.ayahs,
		revelation_en: revelation.en,
		revelation_ar: revelation.ar,
		title_en: titleEn,
		title_ar: titleAr,
		metadata_en: `${ref} - ${titleEn}`,
		metadata_ar: titleAr,
		fragment: escapeHtml(title)
	};
}

function quranSurahRef(num) {
	return `quran:${num}:1`;
}

function quranSurahRevelation(num) {
	var surah = Surahs.find(num);
	return {
		en: surah && surah.revelation_en ? surah.revelation_en : 'Makki',
		ar: surah && surah.revelation_ar ? surah.revelation_ar : 'مكية'
	};
}

async function quranMemoryThenRestAutocompleteSuggestions(qs, lang, selectedFilters, generated, limit) {
	var remaining = limit - generated.length;
	if (remaining < 1)
		return generated.slice(0, limit);
	var quranMemoryDocs = await inMemoryQuranAyahSearch(qs, lang);
	logInMemoryQuranHits(qs, lang, quranMemoryDocs);
	var suggestions = generated.concat(quranMemoryDocs.map(doc => formatAutocompleteSuggestion(doc, lang, qs)).filter(Boolean));
	suggestions = dedupeAutocompleteSuggestions(suggestions);
	remaining = limit - suggestions.length;
	if (remaining > 0) {
		var restQuery = buildQuranFirstRestSearchQuery(qs, lang, selectedFilters);
		var restDocs = await Index.docsFromQuery(quranFirstRestIndexNames(selectedFilters), restQuery, 0, remaining, SEARCH_ORDER_BY, true);
		restDocs.sort(compareSearchResults);
		suggestions = suggestions.concat(restDocs.map(doc => formatAutocompleteSuggestion(doc, lang, qs)).filter(Boolean));
	}
	return dedupeAutocompleteSuggestions(suggestions).slice(0, limit);
}

function dedupeAutocompleteSuggestions(suggestions) {
	var seen = new Set();
	return suggestions.filter(function (suggestion) {
		var key = suggestion?.url;
		if (!key || seen.has(key))
			return false;
		seen.add(key);
		return true;
	});
}

function toTokenRegexp(qs) {
	qs = qs.replace(/[\^\$\.\|\(\)\[\]\{\}\,\*\+\?\/\"\']/g, ' ');
	var qt = qs.split(/[\s\-\_\,\.\']+/);
	var q = '(';
	for (var j = 0; j < qt.length; j++) {
		q += qt[j];
		if (j < qt.length - 1)
			q += '|';
	}
	q += ')';
	q = q.replace(/\(\|/, '(');
	q = q.replace(/\|\)/, ')');
	return new RegExp(q, 'ig');
}

async function a_search(qs, b, lang, offset, options = {}) {
	var selectedFilters = normalizeBookFilters(b);
	var searchOptions = normalizeSearchOptions(options);
	if (allowsQuranAyahMemorySearch(selectedFilters, searchOptions))
		return await executeQuranMemoryThenRestSearch(qs, lang, offset, selectedFilters, searchOptions);
	var query = buildBookOrdinalQuery(qs, lang, selectedFilters, searchOptions);
	return await executeSearchQuery(qs, query, offset, lang, selectedFilters, searchOptions);
}

async function a_searchExpression(qs, b, offset, options = {}) {
	qs = (qs || '').trim();
	if (qs.length < 1)
		return [];
	var selectedFilters = normalizeBookFilters(b);
	var searchOptions = normalizeSearchOptions(options);
	var filters = buildSearchFilters(selectedFilters, searchOptions);
	var query = {
		query_string: {
			query: qs
		}
	};
	if (filters.length > 0) {
		query = {
			bool: {
				must: query,
				filter: filters
			}
		};
	}
	return await executeSearchQuery(qs, query, offset, undefined, selectedFilters, searchOptions);
}

async function executeSearchQuery(qs, query, offset, lang, selectedFilters, options = {}) {
	offset = Number.isInteger(offset) ? offset : 0;
	if (offset >= SEARCH_ES_RESULT_LIMIT)
		return searchResultsWithTotal([], SEARCH_ES_RESULT_LIMIT);
	var size = elasticSearchPageSize(offset);
	var seen = new Set();
	var generatedDocs = lang ? generatedSearchSuggestionDocs(qs, lang, selectedFilters, options) : [];
	var docs = addUniqueSearchDocs([], generatedDocs, seen);
	var generatedTotal = docs.length;
	var pageDocs = docs.slice(offset, offset + size);
	var indexedTotal = 0;
	if (pageDocs.length < size) {
		var indexedOffset = Math.max(0, offset - generatedTotal);
		var indexedSize = size - pageDocs.length;
		var indexedDocs = indexedSize > 0
			? await Index.docsFromQuery('hadiths,toc,commentaries', query, indexedOffset, indexedSize, SEARCH_ORDER_BY, true)
			: [];
		indexedDocs.sort(compareSearchResults);
		indexedTotal = Number.isFinite(indexedDocs.total) ? indexedDocs.total : indexedDocs.length;
		pageDocs = pageDocs.concat(addUniqueSearchDocs([], indexedDocs, seen));
	} else {
		var countDocs = await Index.docsFromQuery('hadiths,toc,commentaries', query, 0, 0, SEARCH_ORDER_BY, false);
		indexedTotal = Number.isFinite(countDocs.total) ? countDocs.total : 0;
	}
	await hydrateCommentaryAyahs(pageDocs);
	var results = await formatSearchDocs(qs, pageDocs);
	results.total = cappedSearchTotal(generatedTotal + indexedTotal);
	return results;
}

function generatedSearchSuggestionDocs(qs, lang, selectedFilters, options = {}) {
	var suggestions = quranAutocompleteSuggestions(qs, lang, selectedFilters, options)
		.concat(quranSurahAutocompleteSuggestions(qs, lang, selectedFilters, options))
		.concat(tafsirAutocompleteSuggestions(qs, lang, selectedFilters, options))
		.concat(translationAutocompleteSuggestions(qs, lang, selectedFilters, options))
		.concat(bookAutocompleteSuggestions(qs, lang, selectedFilters, options));
	var docs = dedupeAutocompleteSuggestions(suggestions).map(formatSearchSuggestion);
	docs.total = docs.length;
	return docs;
}

function formatSearchSuggestion(suggestion) {
	return {
		...suggestion,
		doctype: 'suggestion',
		suggestion_type: suggestion.type,
		search_lang: suggestion.lang
	};
}

async function executeQuranMemoryThenRestSearch(qs, lang, offset, selectedFilters, options = {}) {
	offset = Number.isInteger(offset) ? offset : 0;
	if (offset >= SEARCH_ES_RESULT_LIMIT)
		return searchResultsWithTotal([], SEARCH_ES_RESULT_LIMIT);
	var size = elasticSearchPageSize(offset);
	var seen = new Set();
	var generatedDocs = generatedSearchSuggestionDocs(qs, lang, selectedFilters, options);
	var docs = addUniqueSearchDocs([], generatedDocs, seen);
	var quranMemoryDocs = await inMemoryQuranAyahSearch(qs, lang);
	logInMemoryQuranHits(qs, lang, quranMemoryDocs);
	docs = addUniqueSearchDocs(docs, quranMemoryDocs, seen);
	var prefixTotal = docs.length;
	var restTotal = 0;
	var pageDocs = docs.slice(offset, offset + size);
	if (pageDocs.length < size) {
		var restOffset = Math.max(0, offset - prefixTotal);
		var restSize = Math.min(size - pageDocs.length, SEARCH_ES_RESULT_LIMIT - offset - pageDocs.length);
		var restIndexNames = quranFirstRestIndexNames(selectedFilters);
		var restQuery = buildQuranFirstRestSearchQuery(qs, lang, selectedFilters, options);
		var restDocs = await Index.docsFromQuery(restIndexNames, restQuery, restOffset, restSize, SEARCH_ORDER_BY, true);
		restDocs.sort(compareSearchResults);
		restTotal = Number.isFinite(restDocs.total) ? restDocs.total : restDocs.length;
		pageDocs = pageDocs.concat(addUniqueSearchDocs([], restDocs, seen));
	} else {
		var restIndexNames = quranFirstRestIndexNames(selectedFilters);
		var restQuery = buildQuranFirstRestSearchQuery(qs, lang, selectedFilters, options);
		var restCountDocs = await Index.docsFromQuery(restIndexNames, restQuery, 0, 0, SEARCH_ORDER_BY, false);
		restTotal = Number.isFinite(restCountDocs.total) ? restCountDocs.total : 0;
	}
	await hydrateCommentaryAyahs(pageDocs);
	var results = await formatSearchDocs(qs, pageDocs);
	results.total = cappedSearchTotal(prefixTotal + restTotal);
	return results;
}

function searchResultsWithTotal(docs, total) {
	docs.total = total;
	return docs;
}

function elasticSearchPageSize(offset) {
	offset = Number.isInteger(offset) ? offset : 0;
	if (offset < 0)
		offset = 0;
	if (offset >= SEARCH_ES_RESULT_LIMIT)
		return 0;
	var requested = Number(global.settings.search.itemsPerPage) + 1;
	if (!Number.isFinite(requested) || requested < 1)
		requested = SEARCH_ES_RESULT_LIMIT;
	return Math.min(requested, SEARCH_ES_RESULT_LIMIT - offset);
}

function cappedSearchTotal(total) {
	total = Number(total);
	if (!Number.isFinite(total) || total < 0)
		return 0;
	return Math.min(total, SEARCH_ES_RESULT_LIMIT);
}

function addUniqueSearchDocs(target, docs, seen) {
	for (var i = 0; i < (docs || []).length; i++) {
		var doc = docs[i];
		var key = searchDocKey(doc);
		if (!key || seen.has(key))
			continue;
		seen.add(key);
		target.push(doc);
	}
	return target;
}

function searchDocKey(doc) {
	if (!doc)
		return '';
	if (doc.doctype === 'suggestion') {
		var path = Utils.trimToEmpty(doc.url).replace(/^\//, '');
		if (doc.suggestion_type === 'Book' || doc.suggestion_type === 'Surah')
			return `toc:${path || doc.ref}`;
		if (doc.suggestion_type === 'Ayah')
			return `hadith:${Utils.trimToEmpty(doc.ref).replace(/^quran:/, 'quran:')}`;
		return `suggestion:${doc.url || doc.ref || doc.label}`;
	}
	if (doc.doctype === 'commentary')
		return `commentary:${doc.id || doc.hId || doc.ref || doc.path}`;
	if (doc.doctype === 'toc')
		return `toc:${doc.id || doc.ref || doc.path}`;
	return `hadith:${doc.hId || doc.id || doc.ref || doc.path}`;
}

async function inMemoryQuranAyahSearch(qs, lang) {
	var queryText = Utils.trimToEmpty(qs);
	if (!queryText)
		return [];
	var normalizedQueryText = lang === 'ar' ? quranSearchNormalizeArabic(queryText) : cleanQuery(queryText).toLowerCase().trim();
	var rows = await quranAyahRowsForSearch();
	var scored = [];
	for (var i = 0; i < rows.length; i++) {
		var match = quranAyahMatch(rows[i], queryText, normalizedQueryText, lang);
		if (!match)
			continue;
		var doc = { ...rows[i] };
		delete doc.quran_search_body_ar;
		delete doc.quran_search_body_en;
		doc.doctype = 'hadith';
		doc.book_alias = 'quran';
		doc._score = match.score;
		doc._highlight = {
			[match.field]: [match.fragment]
		};
		scored.push(doc);
	}
	scored.sort(compareSearchResults);
	return scored;
}

async function quranAyahRowsForSearch() {
	if (quranAyahSearchCache)
		return quranAyahSearchCache;
	var rows = await global.query(`
		SELECT *
		FROM v_hadiths
		WHERE book_alias='quran'
		ORDER BY h1, numInChapter`);
	quranAyahSearchCache = rows.map(row => ({
		...row,
		quran_search_body_ar: quranSearchNormalizeArabic(row.body),
		quran_search_body_en: Utils.trimToEmpty(cleanQuery(row.body_en)).toLowerCase().trim()
	}));
	return quranAyahSearchCache;
}

function quranAyahMatch(row, queryText, normalizedQueryText, lang) {
	var field = lang === 'en' ? 'body_en' : 'body';
	var text = Utils.trimToEmpty(row?.[field]);
	if (!text)
		return null;
	if (lang === 'ar')
		return quranArabicAyahMatch(text, row.quran_search_body_ar, normalizedQueryText, field);
	return quranEnglishAyahMatch(text, row.quran_search_body_en, normalizedQueryText, field);
}

function quranArabicAyahMatch(text, normalizedText, normalizedQuery, field) {
	if (!normalizedQuery)
		return null;
	var queryTokens = Arabic.tokenize(normalizedQuery).filter(Boolean);
	if (queryTokens.length < 1)
		return null;
	var score = 0;
	if (normalizedText.includes(normalizedQuery))
		score = 1000000 - normalizedText.indexOf(normalizedQuery);
	else if (queryTokens.every(token => quranArabicPartialTokenMatch(normalizedText, token)))
		score = 500000 - queryTokens.reduce((sum, token) => sum + normalizedText.indexOf(token), 0);
	else
		return null;
	return {
		field: field,
		score: score,
		fragment: highlightArabicAyahText(text, queryTokens)
	};
}

function quranArabicPartialTokenMatch(normalizedText, token) {
	if (!token)
		return false;
	if (normalizedText.includes(token))
		return true;
	if (token.length < 3)
		return false;
	var tokenVariants = quranArabicSearchTokenVariants(token);
	var words = Arabic.tokenize(normalizedText).filter(Boolean);
	return words.some(word => {
		var wordVariants = quranArabicSearchTokenVariants(word);
		return tokenVariants.some(tokenVariant => wordVariants.some(wordVariant => wordVariant.includes(tokenVariant)));
	});
}

function quranEnglishAyahMatch(text, normalizedText, normalizedQuery, field) {
	if (!normalizedQuery)
		return null;
	var queryTokens = normalizedQuery.split(/\s+/).filter(Boolean);
	if (queryTokens.length < 1)
		return null;
	var score = 0;
	if (normalizedText.includes(normalizedQuery))
		score = 1000000 - normalizedText.indexOf(normalizedQuery);
	else if (queryTokens.every(token => normalizedText.includes(token)))
		score = 500000 - queryTokens.reduce((sum, token) => sum + normalizedText.indexOf(token), 0);
	else
		return null;
	return {
		field: field,
		score: score,
		fragment: highlightLatinText(text, queryTokens)
	};
}

function highlightArabicAyahText(text, queryTokens) {
	return text.split(/([\p{L}\p{M}\d]+)/gu).map(function (part) {
		if (!/[\p{L}\p{M}\d]/u.test(part))
			return part;
		var normalized = quranSearchNormalizeArabic(part);
		return queryTokens.some(token => quranArabicHighlightTokenMatch(normalized, token)) ? `<i>${part}</i>` : part;
	}).join('');
}

function quranArabicHighlightTokenMatch(word, token) {
	if (!word || !token)
		return false;
	if (word.includes(token) || token.includes(word))
		return true;
	if (token.length < 3)
		return false;
	var tokenVariants = quranArabicSearchTokenVariants(token);
	var wordVariants = quranArabicSearchTokenVariants(word);
	return tokenVariants.some(tokenVariant => wordVariants.some(wordVariant => wordVariant.includes(tokenVariant)));
}

function quranArabicSearchTokenVariants(token) {
	var variants = new Set();
	token = Utils.trimToEmpty(token);
	if (!token)
		return [];
	variants.add(token);
	var stripped = Arabic.stripArabicSuffix(Arabic.stripArabicPrefix(token));
	if (stripped && stripped.length >= 3)
		variants.add(stripped);
	var disemvoweled = Arabic.disemvowelArabic(token);
	if (disemvoweled && disemvoweled.length >= 3)
		variants.add(disemvoweled);
	return Array.from(variants);
}

function quranSearchNormalizeArabic(value) {
	return restoreQuranDaggerAlifFixedWords(Utils.trimToEmpty(Arabic.normalize(value, false)))
		.replace(/ة(?=$|[^\p{L}\p{M}\d])/gu, 'ت')
		.replace(/يي/g, 'ي');
}

function restoreQuranDaggerAlifFixedWords(value) {
	for (var i = 0; i < QURAN_DAGGER_ALIF_FIXED_WORDS.length; i++) {
		var expanded = QURAN_DAGGER_ALIF_FIXED_WORDS[i][0];
		var fixed = QURAN_DAGGER_ALIF_FIXED_WORDS[i][1];
		var re = new RegExp(`(^|[^\\p{L}\\p{M}\\d])${expanded}(?=$|[^\\p{L}\\p{M}\\d])`, 'gu');
		value = value.replace(re, `$1${fixed}`);
	}
	return value;
}

function logInMemoryQuranHits(qs, lang, docs) {
	var count = Array.isArray(docs) ? docs.length : 0;
	var normalized = lang === 'ar' ? quranSearchNormalizeArabic(qs) : cleanQuery(qs).toLowerCase().trim();
	var refs = (docs || []).slice(0, 12).map(doc => doc.ref || `${doc.h1}:${doc.numInChapter}`).filter(Boolean);
	debug(`[quran-search] in-memory hits query="${qs}" normalized="${normalized}" lang=${lang} count=${count}${refs.length ? ` refs=${refs.join(',')}` : ''}`);
}

function highlightLatinText(text, queryTokens) {
	return text.split(/([\p{L}\p{M}\d]+)/gu).map(function (part) {
		if (!/[\p{L}\p{M}\d]/u.test(part))
			return part;
		var normalized = cleanQuery(part).toLowerCase();
		return queryTokens.some(token => normalized.includes(token) || token.includes(normalized)) ? `<i>${part}</i>` : part;
	}).join('');
}

async function formatSearchDocs(qs, _results) {
	debug(`${_results.length} items found`);
	var results = [];
	var lang = qs.match(/[a-z]/) ? 'en' : 'ar';
	try {
		for (var i = 0; i < _results.length; i++) {
			var hadith = _results[i];
			try {
				if (hadith.doctype === 'suggestion') {
					results.push(hadith);
					continue;
				}
				applyElasticHighlights(hadith, lang);
				if (hadith.doctype === 'commentary' && isTranslationSearchDoc(hadith))
					results.push(formatTranslationSearchResult(hadith, lang));
				else
					results.push(hadith.doctype === 'commentary' ? formatCommentarySearchResult(hadith, lang) : new Item(hadith));
			} catch (err) {
				debug.error(`Search broke on Hadith ${hadith.bookId}:${hadith.num} for Query [${qs}]\n${err.stack || err.message}`);
			}
		}
	} catch (err) {
		debug.error(err);
		results = _results.map(item => new Item(item));
	}
	return results;
}

function isTranslationSearchDoc(item) {
	return Utils.trimToEmpty(item?.commentary_type || item?.type) === 'trans';
}

async function hydrateCommentaryAyahs(results) {
	var ranges = [];
	var seen = new Set();
	for (var i = 0; i < results.length; i++) {
		var item = results[i];
		if (item?.doctype !== 'commentary')
			continue;
		var surah = parseInt(item.surah, 10);
		var ayahFrom = parseInt(item.ayahFrom, 10);
		var ayahTo = parseInt(item.ayahTo, 10);
		if (!Number.isInteger(surah) || !Number.isInteger(ayahFrom))
			continue;
		if (!Number.isInteger(ayahTo) || ayahTo < ayahFrom)
			ayahTo = ayahFrom;
		var key = `${surah}:${ayahFrom}:${ayahTo}`;
		if (seen.has(key))
			continue;
		seen.add(key);
		ranges.push({ key, surah, ayahFrom, ayahTo });
	}
	if (ranges.length < 1)
		return;
	var rows = await fetchQuranAyahsFromIndex(ranges);
	var rowsByRange = new Map(ranges.map(range => [range.key, []]));
	var titlesByRange = new Map();
	rows.forEach(row => {
		ranges.forEach(range => {
			if (Number(row.surah) === range.surah && Number(row.ayah) >= range.ayahFrom && Number(row.ayah) <= range.ayahTo) {
				if (!titlesByRange.has(range.key))
					titlesByRange.set(range.key, {
						title_en: row.h1_title_en,
						title: row.h1_title
					});
				rowsByRange.get(range.key).push({
					num: Number(row.ayah),
					num_ar: Arabic.toArabicDigits(row.ayah),
					text: row.body,
					marker: `۝${Arabic.toArabicDigits(row.ayah)}`
				});
			}
		});
	});
	results.forEach(item => {
		if (item?.doctype !== 'commentary')
			return;
		var surah = parseInt(item.surah, 10);
		var ayahFrom = parseInt(item.ayahFrom, 10);
		var ayahTo = parseInt(item.ayahTo, 10);
		if (!Number.isInteger(ayahTo) || ayahTo < ayahFrom)
			ayahTo = ayahFrom;
		var key = `${surah}:${ayahFrom}:${ayahTo}`;
		var titles = titlesByRange.get(key) || {};
		item.commentary_ayahs = rowsByRange.get(key) || [];
		item.commentary_ayah_surah_title_en = titles.title_en;
		item.commentary_ayah_surah_title = titles.title;
	});
}

async function fetchQuranAyahsFromIndex(ranges) {
	var size = ranges.reduce((total, range) => total + (range.ayahTo - range.ayahFrom + 1), 0);
	var query = {
		bool: {
			filter: [
				{ term: { book_alias: 'quran' } },
				{ term: { doctype: 'hadith' } }
			],
			should: ranges.map(range => ({
				bool: {
					filter: [
						{ term: { h1: range.surah } },
						{ range: { numInChapter: { gte: range.ayahFrom, lte: range.ayahTo } } }
					]
				}
			})),
			minimum_should_match: 1
		}
	};
	var docs = await Index.docsFromQuery('hadiths', query, 0, size, 'h1 ASC, numInChapter ASC', false);
	return docs.map(doc => ({
		surah: doc.h1,
		h1_title_en: doc.h1_title_en,
		h1_title: doc.h1_title,
		ayah: doc.numInChapter,
		body: doc.body
	}));
}

function buildBookOrdinalQuery(queryText, lang, selectedFilters, options = {}) {
	return buildSearchQuery(queryText, lang, selectedFilters, options);
}

function buildSearchQuery(queryText, lang, selectedFilters, options = {}) {
	queryText = (queryText || '').trim();
	var filters = buildSearchFilters(selectedFilters, options);
	var tokenCount = queryText.split(/\s+/).filter(Boolean).length;
	var should = [];

	if (queryText.length > 0) {
		should.push(buildDoctypeSearchClause('hadith', queryText, lang, tokenCount));
		should.push(buildDoctypeSearchClause('toc', queryText, lang, tokenCount));
		should.push(buildDoctypeSearchClause('commentary', queryText, lang, tokenCount));
	}

	var query = {
		bool: {
			should: should,
			minimum_should_match: should.length > 0 ? 1 : 0
		}
	};
	if (filters.length > 0)
		query.bool.filter = filters;
	return query;
}

function buildCommentaryOnlySearchQuery(queryText, lang) {
	queryText = (queryText || '').trim();
	var tokenCount = queryText.split(/\s+/).filter(Boolean).length;
	return buildDoctypeSearchClause('commentary', queryText, lang, tokenCount);
}

function buildQuranFirstRestSearchQuery(queryText, lang, selectedFilters, options = {}) {
	if (isQuranCommentarySearch(selectedFilters))
		return addSearchOptionFilters(buildCommentaryOnlySearchQuery(queryText, lang), options);
	var query = buildSearchQuery(queryText, lang, selectedFilters, options);
	return excludeQuranAyahDocs(query);
}

function excludeQuranAyahDocs(query) {
	return {
		bool: {
			must: query,
			must_not: {
				bool: {
					filter: [
						{ term: { doctype: 'hadith' } },
						{ term: { book_alias: 'quran' } }
					]
				}
			}
		}
	};
}

function quranFirstRestIndexNames(selectedFilters) {
	return isQuranCommentarySearch(selectedFilters) ? 'commentaries' : 'hadiths,toc,commentaries';
}

function buildDoctypeSearchClause(doctype, queryText, lang, tokenCount) {
	var langFields = SEARCH_FIELDS[doctype] || SEARCH_FIELDS.hadith;
	var fields = langFields[lang] || langFields.en;
	return {
		bool: {
			filter: {
				term: {
					doctype: doctype
				}
			},
			should: buildMultiMatchClauses(queryText, fields, tokenCount),
			minimum_should_match: 1
		}
	};
}

function buildMultiMatchClauses(queryText, fields, tokenCount) {
	var should = [{
		multi_match: {
			query: queryText,
			type: 'phrase',
			fields: fields,
			boost: tokenCount > 1 ? 100 : 10
		}
	}];
	if (tokenCount > 1) {
		should.push({
			multi_match: {
				query: queryText,
				type: 'phrase',
				slop: 2,
				fields: fields,
				boost: 20
			}
		});
	}
	should.push({
		multi_match: {
			query: queryText,
			type: 'best_fields',
			operator: 'and',
			fields: fields,
			boost: tokenCount > 1 ? 5 : 3
		}
	});
	should.push({
		multi_match: {
			query: queryText,
			type: 'best_fields',
			operator: 'or',
			fields: fields,
			boost: 1
		}
	});
	return should;
}

function formatAutocompleteSuggestion(doc, lang, queryText) {
	if (!doc)
		return null;
	if (doc.doctype === 'commentary')
		return formatCommentaryAutocompleteSuggestion(doc, lang);
	if (doc.doctype === 'toc' && hasBookAutocompleteHighlight(doc) && Books.matchesQuery(doc, queryText, lang))
		return formatBookAutocompleteSuggestion(doc, lang);
	if (isQuranSurahDoc(doc))
		return formatQuranSurahAutocompleteSuggestion(doc, lang);
	var title = lang === 'ar'
		? firstText(doc.title, doc.h1_title, doc.h2_title, doc.h3_title, doc.title_en, doc.h1_title_en, doc.h2_title_en, doc.h3_title_en)
		: firstText(doc.title_en, doc.h1_title_en, doc.h2_title_en, doc.h3_title_en, doc.title, doc.h1_title, doc.h2_title, doc.h3_title);
	var highlightedFragment = firstHighlightedFragment(doc, lang);
	if (!highlightedFragment)
		return null;
	var label = title || stripHtml(highlightedFragment) || doc.ref || doc.path;
	if (!label)
		return null;
	label = Utils.trimToEmpty(stripHtml(label));
	if (label === '')
		return null;
	var ref = Utils.trimToEmpty(doc.ref);
	var url = autocompleteSuggestionUrl(doc, ref);
	var type = doc.doctype === 'toc' ? (isQuranSurahDoc(doc) ? 'Surah' : 'Heading') : (doc.remark == 2 ? 'Ayah' : 'Hadith');
	var isQuran = doc.book_alias === 'quran' || doc.remark == 2 || /^quran:/.test(ref);
	var metadata = autocompleteSuggestionMetadata(doc, type, ref);
	var fragment = isQuranAyahDoc(doc) && lang === 'ar'
		? quranAyahAutocompleteFragment(doc, highlightedFragment)
		: highlightFragmentToHtml(highlightedFragment);
	return {
		label: label,
		value: stripHtml(label),
		url: url || '/',
		ref: ref,
		type: type,
		is_quran: isQuran,
		lang: lang,
		metadata_en: metadata.en,
		metadata_ar: metadata.ar,
		fragment: fragment
	};
}

function isQuranAyahDoc(doc) {
	return doc?.doctype === 'hadith' && (doc?.book_alias === 'quran' || doc?.remark == 2);
}

function quranAyahAutocompleteFragment(doc, highlightedFragment) {
	var body = Utils.trimToEmpty(doc?.body);
	if (!body)
		return highlightFragmentToHtml(highlightedFragment);
	var highlightedTokens = highlightedNormalizedArabicTokens(highlightedFragment);
	if (highlightedTokens.size < 1)
		return escapeHtml(body);
	var parts = body.split(/([\p{L}\p{M}\d]+)/gu);
	var marked = parts.map(function (part) {
		if (!/[\p{L}\p{M}\d]/u.test(part))
			return part;
		var normalized = Utils.trimToEmpty(Arabic.normalize(part, false));
		return normalized && highlightedTokens.has(normalized) ? `<i>${part}</i>` : part;
	}).join('');
	return highlightFragmentToHtml(marked);
}

function highlightedNormalizedArabicTokens(fragment) {
	var tokens = new Set();
	var matches = (fragment || '').toString().matchAll(/<i>(.*?)<\/i>/g);
	for (var match of matches) {
		Arabic.tokenize(Utils.trimToEmpty(Arabic.normalize(stripHtml(match[1]), false))).forEach(function (token) {
			if (token)
				tokens.add(token);
		});
	}
	return tokens;
}

function formatQuranSurahAutocompleteSuggestion(doc, lang) {
	var titleEn = Utils.trimToEmpty(doc.title_en || doc.h1_title_en);
	var titleAr = Utils.trimToEmpty(doc.title || doc.h1_title);
	var title = lang === 'ar' ? titleAr : titleEn;
	var surahNum = quranSurahNumFromDoc(doc);
	var surah = surahNum ? Surahs.surahs.find(item => item.num === surahNum) : null;
	var ref = surahNum ? quranSurahRef(surahNum) : Utils.trimToEmpty(doc.ref);
	var revelation = surahNum ? quranSurahRevelation(surahNum) : null;
	return {
		label: title,
		value: title,
		url: surahNum ? `/quran/${surahNum}` : `/${doc.path}`,
		ref: ref,
		alias: ref,
		type: 'Surah',
		is_quran: true,
		lang: lang,
		surah_name_en: surah?.name_en,
		surah_name_ar: surah?.name_ar,
		ayah_count: surah?.ayahs,
		revelation_en: revelation?.en,
		revelation_ar: revelation?.ar,
		title_en: titleEn,
		title_ar: titleAr,
		metadata_en: [ref, doc.book_shortName_en, titleEn].filter(Boolean).join(' - '),
		metadata_ar: [doc.book_shortName, titleAr].filter(Boolean).join(' - '),
		fragment: escapeHtml(title)
	};
}

function quranSurahNumFromDoc(doc) {
	var candidates = [doc?.surah, doc?.surah_num, doc?.chapter, doc?.book_num, doc?.ref, doc?.path];
	for (var candidate of candidates) {
		var match = Utils.trimToEmpty(candidate).match(/(?:^|[^\d])(\d{1,3})(?:[^\d]|$)/);
		if (!match)
			continue;
		var num = parseInt(match[1], 10);
		if (Number.isInteger(num) && num >= 1 && num <= 114)
			return num;
	}
	return null;
}

function hasBookAutocompleteHighlight(doc) {
	var highlight = doc?._highlight || {};
	return ['book_name_search_ar', 'book_shortName_search_ar', 'book_name_search_en', 'book_name_search_en_prefix', 'book_shortName_search_en', 'book_shortName_search_en_prefix'].some(function (field) {
		return Array.isArray(highlight[field]) && highlight[field].some(fragment => fragment.indexOf('<i>') >= 0);
	});
}

function formatBookAutocompleteSuggestion(doc, lang) {
	var bookAlias = doc.book_alias || doc.alias;
	var book = findLoadedBook(bookAlias) || {};
	var shortNameEn = Utils.trimToEmpty(doc.book_name_en || doc.name_en || book.name_en || doc.book_shortName_en || doc.shortName_en || book.shortName_en || bookAlias);
	var shortNameAr = Utils.trimToEmpty(doc.book_name || doc.title || book.title || doc.book_shortName || doc.shortName || book.shortName || bookAlias);
	var aliasAr = Utils.trimToEmpty(doc.book_shortName || doc.shortName || book.shortName || shortNameAr);
	var isLoadedBookDoc = Utils.trimToEmpty(doc.alias) === bookAlias && !doc.book_alias;
	var fullNameEn = Utils.trimToEmpty(doc.book_title_en || book.title_en || (isLoadedBookDoc ? doc.title_en : '')) || extractBookFullName(doc.book_description || doc.description || book.description, 'en');
	var fullNameAr = Utils.trimToEmpty(doc.book_title || book.title || (isLoadedBookDoc ? doc.title : '')) || extractBookFullName(doc.book_description || doc.description || book.description, 'ar');
	var nameEn = Utils.trimToEmpty(fullNameEn || shortNameEn);
	var nameAr = Utils.trimToEmpty(fullNameAr || shortNameAr);
	var authorEn = Utils.trimToEmpty(doc.book_author_en || doc.author_en || doc.book_author || doc.author);
	var authorAr = Utils.trimToEmpty(doc.book_author || doc.author);
	var death = doc.book_author_death || doc.author_death || doc.death;
	var chapterCount = firstPositiveInteger(doc.book_chapter_count, doc.chapter_count, doc.chapters_count, doc.numChapters, doc.chapterCount, book.chapter_count, book.chapters_count, book.numChapters, book.chapterCount);
	var hadithCount = firstPositiveInteger(doc.book_hadith_count, doc.hadith_count, doc.hadiths_count, doc.numHadiths, doc.hadithCount, book.hadith_count, book.hadiths_count, book.numHadiths, book.hadithCount);
	var title = lang === 'ar' ? shortNameAr : shortNameEn;
	var metadata = bookSuggestionMetadata({
		lang,
		shortNameEn,
		nameEn,
		authorEn,
		shortNameAr,
		nameAr,
		authorAr,
		death
	});
	return {
		label: title,
		value: title,
		url: `/${bookAlias}`,
		ref: bookAlias,
		alias: bookAlias,
		type: 'Book',
		is_quran: bookAlias === 'quran',
		lang: lang,
		title_en: shortNameEn,
		title_ar: shortNameAr,
		shortName_en: shortNameEn,
		shortName: shortNameAr,
		alias_ar: aliasAr,
		fullName_en: fullNameEn,
		fullName: fullNameAr,
		name_en: nameEn,
		name: nameAr,
		author_en: authorEn,
		author: authorAr,
		death: death,
		chapter_count: chapterCount,
		hadith_count: hadithCount,
		metadata_en: metadata.en,
		metadata_ar: metadata.ar,
		metadata_lines: metadata.lines,
		fragment: escapeHtml(title)
	};
}

function findLoadedBook(alias) {
	if (!Array.isArray(global.books))
		return null;
	return global.books.find(book => book.alias === alias) || null;
}

function extractBookFullName(description, lang) {
	description = Utils.trimToEmpty(description);
	if (!description)
		return '';
	var match = description.match(/Full name:\s*\*([^*]+)\*\s*(?:\(([^)]+)\))?/iu);
	if (!match)
		return '';
	return Utils.trimToEmpty(lang === 'ar' ? match[2] : match[1]);
}

function firstPositiveInteger(...values) {
	for (var value of values) {
		var num = parseInt(value, 10);
		if (Number.isInteger(num) && num > 0)
			return num;
	}
	return null;
}

function formatTafsirAutocompleteSuggestion(tafsir, lang) {
	var shortNameEn = Tafsir.displayShortName(tafsir, 'en');
	var shortNameAr = Tafsir.displayShortName(tafsir, 'ar');
	var nameEn = Utils.trimToEmpty(tafsir.name_en || shortNameEn);
	var nameAr = Utils.trimToEmpty(tafsir.title || shortNameAr);
	var authorEn = Utils.trimToEmpty(tafsir.author_en);
	var authorAr = Utils.trimToEmpty(tafsir.author || tafsir.author_en);
	var death = tafsir.death;
	var title = lang === 'ar' ? shortNameAr : shortNameEn;
	var slug = tafsir.slug || Tafsir.tafsirSlug(tafsir.alias);
	var metadata = bookSuggestionMetadata({
		lang,
		shortNameEn,
		nameEn,
		authorEn,
		shortNameAr,
		nameAr,
		authorAr,
		death
	});
	return {
		label: title,
		value: title,
		url: `/quran/tafsir/${encodeURIComponent(slug)}`,
		ref: `tafsir:${slug}`,
		alias: slug,
		type: 'Tafsir',
		is_quran: true,
		lang: lang,
		title_en: shortNameEn,
		title_ar: shortNameAr,
		shortName_en: shortNameEn,
		shortName: shortNameAr,
		name_en: nameEn,
		name: nameAr,
		author_en: authorEn,
		author: authorAr,
		death: death,
		metadata_en: metadata.en,
		metadata_ar: metadata.ar,
		metadata_lines: metadata.lines,
		fragment: escapeHtml(title)
	};
}

function formatTranslationAutocompleteSuggestion(translation, lang) {
	var shortNameEn = Utils.trimToEmpty(translation.shortName_en || translation.name_en || translation.alias);
	var shortNameAr = Utils.trimToEmpty(translation.shortName || translation.title || shortNameEn);
	var nameEn = Utils.trimToEmpty(translation.name_en || shortNameEn);
	var nameAr = Utils.trimToEmpty(translation.title || shortNameAr);
	var authorEn = Utils.trimToEmpty(translation.author_en);
	var authorAr = Utils.trimToEmpty(translation.author || translation.author_en);
	var death = translation.death;
	var title = lang === 'ar' ? shortNameAr : shortNameEn;
	var metadata = bookSuggestionMetadata({
		lang,
		shortNameEn,
		nameEn,
		authorEn,
		shortNameAr,
		nameAr,
		authorAr,
		death
	});
	return {
		label: title,
		value: title,
		url: `/quran/translations/1/1?translation=${encodeURIComponent(translation.alias)}`,
		ref: `translation:${translation.alias}`,
		alias: translation.alias,
		type: 'Translation',
		is_quran: true,
		lang: lang,
		title_en: shortNameEn,
		title_ar: shortNameAr,
		shortName_en: shortNameEn,
		shortName: shortNameAr,
		name_en: nameEn,
		name: nameAr,
		author_en: authorEn,
		author: authorAr,
		death: death,
		metadata_en: metadata.en,
		metadata_ar: metadata.ar,
		metadata_lines: metadata.lines,
		fragment: escapeHtml(title)
	};
}

function bookSuggestionMetadata(data) {
	var deathEn = deathLabel(data.death, 'en');
	var deathAr = deathLabel(data.death, 'ar');
	var authorEn = [data.authorEn, deathEn].filter(Boolean).join(' ');
	var authorArLang = Arabic.isArabic(data.authorAr) ? 'ar' : 'en';
	var authorArDeath = authorArLang === 'ar' ? deathAr : deathEn;
	var authorAr = [data.authorAr, authorArDeath].filter(Boolean).join(' ');
	var bilingual = [data.shortNameEn, authorEn].filter(Boolean).join(' | ');
	if (data.lang === 'ar') {
		var arLines = [
			{ text: data.nameAr, lang: 'ar' },
			{ text: authorAr, lang: authorArLang },
			{ text: bilingual, lang: 'en' }
		].filter(line => line.text);
		return {
			ar: [data.nameAr, authorAr].filter(Boolean).join(' - '),
			en: bilingual,
			lines: arLines
		};
	}
	var enLines = [
		{ text: data.nameEn, lang: 'en' },
		{ text: authorEn, lang: 'en' }
	].filter(line => line.text);
	return {
		ar: data.nameAr,
		en: [data.nameEn, authorEn].filter(Boolean).join(' - '),
		lines: enLines
	};
}

function deathLabel(death, lang) {
	death = parseInt(death, 10);
	if (!Number.isInteger(death) || death <= 0)
		return '';
	return lang === 'ar'
		? `(ت ${Arabic.toArabicDigits(death)} هـ)`
		: `(d. ${death} AH)`;
}

function isQuranSurahDoc(doc) {
	return doc?.book_alias === 'quran' && Number(doc?.level) === 1;
}

function formatCommentaryAutocompleteSuggestion(doc, lang) {
	var highlightedFragment = firstHighlightedFragment(doc, lang);
	if (!highlightedFragment)
		return null;
	hydrateCommentaryMetadata(doc);
	var title = commentaryTitle(doc);
	var ref = Utils.trimToEmpty(doc.ref);
	return {
		label: title,
		value: stripHtml(title),
		url: commentaryUrl(doc),
		ref: ref,
		type: 'Tafsir',
		is_quran: true,
		lang: lang,
		metadata_en: [ref, title].filter(Boolean).join(' - '),
		metadata_ar: commentaryArabicSubtitle(doc),
		fragment: highlightFragmentToHtml(cleanCommentaryFragment(highlightedFragment))
	};
}

function commentaryArabicSubtitle(item) {
	hydrateCommentaryMetadata(item);
	var name = Utils.trimToEmpty(item?.commentary_name || item?.commentary_shortName);
	var shortName = Utils.trimToEmpty(item?.commentary_shortName);
	if (!shortName || shortName === name)
		return name;
	return `${name} (${shortName})`;
}

function commentarySectionTitleIncludesSurah(title, surah) {
	var normalizedTitle = Arabic.normalize(Utils.trimToEmpty(title), false);
	if (!normalizedTitle)
		return false;
	if (normalizedTitle.includes('سوره'))
		return true;
	var normalizedSurah = Arabic.normalize(Utils.trimToEmpty(surah?.name_ar), false);
	return !!normalizedSurah && normalizedTitle.includes(normalizedSurah);
}

function autocompleteSuggestionMetadata(doc, type, ref) {
	var bookEn = Utils.trimToEmpty(doc.book_shortName_en || doc.book_name_en || doc.book_alias);
	var bookAr = Utils.trimToEmpty(doc.book_shortName || doc.book_name || doc.book_alias);
	var contextEn = autocompleteContextTitle(doc, 'en');
	var contextAr = autocompleteContextTitle(doc, 'ar');
	var en = [ref, bookEn, contextEn].filter(Boolean).join(' - ');
	var ar = [bookAr, contextAr].filter(Boolean).join(' - ');
	return { en, ar };
}

function autocompleteContextTitle(doc, lang) {
	var keys = lang === 'ar'
		? ['h3_title', 'h2_title', 'h1_title']
		: ['h3_title_en', 'h2_title_en', 'h1_title_en'];
	for (var i = 0; i < keys.length; i++) {
		var value = cleanAutocompleteMetadataText(doc?.[keys[i]]);
		if (value !== '')
			return value;
	}
	return '';
}

function cleanAutocompleteMetadataText(value) {
	value = Utils.trimToEmpty(stripHtml(value));
	if (value === '')
		return '';
	value = Utils.trimToEmpty(value.split(/\r?\n/)[0]).replace(/\s+/g, ' ');
	return Utils.truncate(value, 72, true);
}

function autocompleteSuggestionUrl(doc, ref) {
	var url = '';
	if (doc?.doctype === 'toc')
		url = Utils.trimToEmpty(doc.path || ref);
	else
		url = Utils.trimToEmpty(ref || doc?.path);
	if (url && url.charAt(0) !== '/')
		url = '/' + url;
	return url || '/';
}

function firstHighlightedFragment(doc, lang) {
	var highlight = doc?._highlight;
	if (!highlight)
		return '';
	var isQuranAyah = doc?.doctype === 'hadith' && doc?.book_alias === 'quran';
	var fields = lang === 'ar'
				? (isQuranAyah
					? ['body_search_ar', 'body', 'footnote', 'title_search_ar', 'title', 'chain', 'intro_search_ar', 'intro', 'h1_title', 'h2_title', 'h3_title', 'h1_intro', 'h2_intro', 'h3_intro']
					: ['text', 'footnotes', 'body', 'body_search_ar', 'book_name_search_ar', 'book_shortName_search_ar', 'title_search_ar', 'title', 'footnote', 'chain', 'intro_search_ar', 'intro', 'h1_title', 'h2_title', 'h3_title', 'h1_intro', 'h2_intro', 'h3_intro'])
				: (isQuranAyah
					? ['body_en', 'body_en_search', 'title_en', 'title_en_search', 'title_search_en', 'footnote_en', 'footnote_en_search', 'chain_en', 'chain_en_search', 'intro_en', 'intro_search_en', 'h1_title_en', 'h2_title_en', 'h3_title_en', 'h1_intro_en', 'h2_intro_en', 'h3_intro_en']
					: ['text_en', 'footnotes_en', 'body_en', 'body_en_search', 'book_name_search_en', 'book_shortName_search_en', 'title_en', 'title_en_search', 'title_search_en', 'footnote_en', 'footnote_en_search', 'chain_en', 'chain_en_search', 'intro_en', 'intro_search_en', 'h1_title_en', 'h2_title_en', 'h3_title_en', 'h1_intro_en', 'h2_intro_en', 'h3_intro_en']);
	for (var i = 0; i < fields.length; i++) {
		var fragments = highlight[fields[i]];
		if (!Array.isArray(fragments))
			continue;
		for (var j = 0; j < fragments.length; j++) {
			var fragment = Utils.trimToEmpty(fragments[j]);
			if (fragment.indexOf('<i>') >= 0)
				return fragment;
		}
	}
	return '';
}

function highlightFragmentToHtml(fragment) {
	return escapeHtml(fragment)
		.replace(/&lt;i&gt;/g, '<mark>')
		.replace(/&lt;\/i&gt;/g, '</mark>');
}

function firstText() {
	for (var i = 0; i < arguments.length; i++) {
		var value = arguments[i];
		if (typeof value === 'string' && Utils.trimToEmpty(stripHtml(value)) !== '')
			return value;
	}
	return '';
}

function stripHtml(s) {
	return (s || '').toString().replace(/<[^>]*>/g, ' ');
}

function escapeHtml(s) {
	return (s || '').toString()
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function buildSearchFilters(selectedFilters, options = {}) {
	var filters = [];
	if (options.excludeQuranAndTafsir) {
		filters.push({
			bool: {
				must_not: [
					{ term: { book_alias: 'quran' } },
					{ term: { doctype: 'commentary' } }
				]
			}
		});
	}
	var tafsirAliases = searchOptionTafsirAliases(options);
	if (tafsirAliases.length === 1)
		filters.push({ term: { commentary_alias: tafsirAliases[0] } });
	else if (tafsirAliases.length > 1)
		filters.push({ terms: { commentary_alias: tafsirAliases } });
	if (!selectedFilters || selectedFilters.length < 1)
		return filters;
	var doctypes = [];
	if (selectedFilters.indexOf('toc') >= 0)
		doctypes.push('toc');
	if (selectedFilters.indexOf('commentaries') >= 0)
		doctypes.push('commentary');
	if (doctypes.length === 1)
		filters.push({ term: { doctype: doctypes[0] } });
	else if (doctypes.length > 1)
		filters.push({ terms: { doctype: doctypes } });
	var bookAliases = expandBookFilters(selectedFilters.filter(filter => filter !== 'toc' && filter !== 'commentaries'));
	if (bookAliases.length > 0) {
		filters.push({ terms: { book_alias: bookAliases } });
		if (doctypes.length < 1 && bookAliases.indexOf('quran') >= 0)
			filters.push({ bool: { must_not: { term: { doctype: 'commentary' } } } });
	}
	return filters;
}

function normalizeSearchOptions(options) {
	options = options || {};
	return {
		tafsirAlias: Utils.trimToEmpty(options.tafsirAlias),
		tafsirAliases: normalizeSearchOptionTafsirAliases(options),
		excludeQuranAndTafsir: options.excludeQuranAndTafsir === true
	};
}

function addSearchOptionFilters(query, options = {}) {
	var searchOptions = normalizeSearchOptions(options);
	var tafsirAliases = searchOptionTafsirAliases(searchOptions);
	if (tafsirAliases.length < 1)
		return query;
	var filter = tafsirAliases.length === 1
		? { term: { commentary_alias: tafsirAliases[0] } }
		: { terms: { commentary_alias: tafsirAliases } };
	return {
		bool: {
			must: query,
			filter: [filter]
		}
	};
}

function normalizeSearchOptionTafsirAliases(options) {
	var aliases = [];
	if (Array.isArray(options.tafsirAliases))
		aliases = aliases.concat(options.tafsirAliases);
	if (Array.isArray(options.tafsirAlias))
		aliases = aliases.concat(options.tafsirAlias);
	else if (options.tafsirAlias)
		aliases.push(options.tafsirAlias);
	return Array.from(new Set(aliases.map(alias => Utils.trimToEmpty(alias)).filter(Boolean)));
}

function searchOptionTafsirAliases(options) {
	if (!options)
		return [];
	if (Array.isArray(options.tafsirAliases))
		return options.tafsirAliases;
	if (options.tafsirAlias)
		return [options.tafsirAlias];
	return [];
}

function isQuranCommentarySearch(selectedFilters) {
	return Array.isArray(selectedFilters)
		&& selectedFilters.indexOf('quran') >= 0
		&& selectedFilters.indexOf('commentaries') >= 0
		&& selectedFilters.indexOf('toc') < 0;
}

function allowsQuranAyahMemorySearch(selectedFilters, options = {}) {
	if (options.excludeQuranAndTafsir)
		return false;
	if (!Array.isArray(selectedFilters) || selectedFilters.length < 1)
		return true;
	var bookAliases = expandBookFilters(selectedFilters.filter(filter => filter !== 'toc' && filter !== 'commentaries'));
	return bookAliases.indexOf('quran') >= 0;
}

function compareSearchResults(a, b) {
	var scoreA = Number.isFinite(a?._score) ? a._score : 0;
	var scoreB = Number.isFinite(b?._score) ? b._score : 0;
	if (scoreB !== scoreA)
		return scoreB - scoreA;
	var ordinalA = getBookOrdinal(a);
	var ordinalB = getBookOrdinal(b);
	if (ordinalA !== ordinalB)
		return ordinalA - ordinalB;
	var docOrdinalA = Number.isFinite(a?.ordinal) ? a.ordinal : Number.MAX_SAFE_INTEGER;
	var docOrdinalB = Number.isFinite(b?.ordinal) ? b.ordinal : Number.MAX_SAFE_INTEGER;
	if (docOrdinalA !== docOrdinalB)
		return docOrdinalA - docOrdinalB;
	return 0;
}

function getBookOrdinal(doc) {
	if (Number.isFinite(doc?.book_ordinal))
		return doc.book_ordinal;
	if (!Array.isArray(global.books))
		return Number.MAX_SAFE_INTEGER;
	for (var i = 0; i < global.books.length; i++) {
		var book = global.books[i];
		if (!book)
			continue;
		if ((doc?.book_alias && book.alias === doc.book_alias) || (doc?.book_id !== undefined && book.id === doc.book_id))
			return Number.isFinite(book.ordinal) ? book.ordinal : Number.MAX_SAFE_INTEGER;
	}
	return Number.MAX_SAFE_INTEGER;
}

function applyElasticHighlights(item, lang) {
	var highlight = item?._highlight;
	if (!highlight)
		return;
	if (lang === 'en') {
		applyHighlightField(item, highlight, 'title_en');
		applyHighlightField(item, highlight, 'body_en');
		applyHighlightField(item, highlight, 'chain_en');
		applyHighlightField(item, highlight, 'footnote_en');
		applyHighlightField(item, highlight, 'intro_en');
		applyHighlightField(item, highlight, 'title_en_search', 'title_en');
		applyHighlightField(item, highlight, 'title_search_en', 'title_en');
		applyHighlightField(item, highlight, 'body_en_search', 'body_en');
		applyHighlightField(item, highlight, 'footnote_en_search', 'footnote_en');
		applyHighlightField(item, highlight, 'chain_en_search', 'chain_en');
		applyHighlightField(item, highlight, 'intro_search_en', 'intro_en');
		applyHighlightField(item, highlight, 'text_en');
		applyHighlightField(item, highlight, 'footnotes_en');
	} else {
		applyHighlightField(item, highlight, 'title');
		applyHighlightField(item, highlight, 'body');
		applyHighlightField(item, highlight, 'chain');
		applyHighlightField(item, highlight, 'footnote');
		applyHighlightField(item, highlight, 'intro');
		applyHighlightField(item, highlight, 'title_search_ar', 'title');
		applyHighlightField(item, highlight, 'intro_search_ar', 'intro');
		applyHighlightField(item, highlight, 'text');
		applyHighlightField(item, highlight, 'footnotes');
	}
	applyTocHighlights(item, lang);
}

function formatCommentarySearchResult(item, lang) {
	var surah = Surahs.find(Number(item?.surah));
	hydrateCommentaryMetadata(item);
	item.url = commentaryUrl(item);
	item.commentary_title = commentaryTitle(item);
	item.commentary_ref_en = `${Utils.trimToEmpty(item.commentary_alias)}:${commentaryRangeLabel(item)}`;
	item.commentary_ref_ar = `${commentaryArabicTitle(item)} ${Arabic.toArabicDigits(commentaryRangeLabel(item))}`;
	item.commentary_surah_url = Number.isInteger(Number(item?.surah)) ? `/quran/${Number(item.surah)}` : '';
	item.commentary_surah_name_en = Utils.trimToEmpty(item.commentary_ayah_surah_title_en) || Utils.trimToEmpty(item.h1_title_en) || (surah?.name_en ? `Surat ${surah.name_en}` : '');
	item.commentary_surah_name_ar = Utils.trimToEmpty(item.commentary_ayah_surah_title) || Utils.trimToEmpty(item.h1_title) || (surah?.name_ar ? `سورة ${surah.name_ar}` : '');
	item.commentary_show_surah_en = !!item.commentary_surah_name_en && !Utils.trimToEmpty(item.h2_title_en).includes(item.commentary_surah_name_en);
	item.commentary_show_surah_ar = !!item.commentary_surah_name_ar && !commentarySectionTitleIncludesSurah(item.h2_title, surah);
	item.commentary_section_url = commentarySectionUrl(item);
	item.search_lang = lang;
	item.commentary_fragment_html_en = commentaryFragmentHtml(item, 'en');
	item.commentary_fragment_html_ar = commentaryFragmentHtml(item, 'ar');
	item.commentary_is_bilingual = Utils.trimToEmpty(item.text_en || item.footnotes_en) !== '' && Utils.trimToEmpty(item.text || item.footnotes) !== '';
	return item;
}

function formatTranslationSearchResult(item, lang) {
	hydrateCommentaryMetadata(item);
	var surah = Number(item?.surah);
	var ayahFrom = Number(item?.ayahFrom);
	var ayahTo = Number(item?.ayahTo);
	if (!Number.isInteger(ayahTo) || ayahTo < ayahFrom)
		ayahTo = ayahFrom;
	var range = ayahFrom === ayahTo ? `${surah}:${ayahFrom}` : `${surah}:${ayahFrom}-${ayahTo}`;
	var ayahText = (item.commentary_ayahs || []).map(ayah => ({
		num: ayah.num,
		text: ayah.text,
		marker: ayah.marker
	}));
	var bodyFragment = highlightedCommentaryTextFragment(item, 'en') || firstText(item.text_en);
	var footnoteFragment = highlightedCommentaryFootnoteFragment(item, 'en');
	return {
		...item,
		doctype: 'translation',
		url: `/quran:${range}`,
		translation_ref: range,
		translation_book: Utils.trimToEmpty(item.commentary_shortName_en || item.commentary_name_en || item.commentary_alias),
		translation_name: Utils.trimToEmpty(item.commentary_name_en || item.commentary_shortName_en || item.commentary_alias),
		translation_author: Utils.trimToEmpty(item.commentary_author_en),
		translation_body_html: highlightFragmentToHtml(cleanCommentaryFragment(bodyFragment)),
		translation_footnote_html: footnoteFragment ? highlightFragmentToHtml(cleanCommentaryFragment(footnoteFragment)) : '',
		translation_ayahs: ayahText,
		translation_surah_name_en: Utils.trimToEmpty(item.commentary_ayah_surah_title_en || item.h1_title_en),
		translation_surah_name_ar: Utils.trimToEmpty(item.commentary_ayah_surah_title || item.h1_title)
	};
}

function highlightedCommentaryFootnoteFragment(item, lang) {
	var highlight = item?._highlight;
	if (!highlight)
		return '';
	var fields = lang === 'ar' ? ['footnotes'] : ['footnotes_en'];
	for (var i = 0; i < fields.length; i++) {
		var fragments = highlight[fields[i]];
		if (!Array.isArray(fragments))
			continue;
		var markedFragments = fragments
			.map(fragment => Utils.trimToEmpty(fragment))
			.filter(fragment => fragment.indexOf('<i>') >= 0);
		if (markedFragments.length > 0)
			return markedFragments.join(' ... ');
	}
	return '';
}

function highlightedCommentaryTextFragment(item, lang) {
	var highlight = item?._highlight;
	if (!highlight)
		return '';
	var fields = lang === 'ar' ? ['text'] : ['text_en'];
	for (var i = 0; i < fields.length; i++) {
		var fragments = highlight[fields[i]];
		if (!Array.isArray(fragments))
			continue;
		var markedFragments = fragments
			.map(fragment => Utils.trimToEmpty(fragment))
			.filter(fragment => fragment.indexOf('<i>') >= 0);
		if (markedFragments.length > 0)
			return markedFragments.join(' ... ');
	}
	return '';
}

function commentaryFragmentHtml(item, lang) {
	var fragment = highlightedCommentaryTextFragment(item, lang) || highlightedCommentaryFootnoteFragment(item, lang);
	if (!fragment)
		fragment = lang === 'ar' ? firstText(item.text, item.footnotes) : firstText(item.text_en, item.footnotes_en);
	if (!fragment)
		return '';
	return highlightFragmentToHtml(Utils.truncate(cleanCommentaryFragment(fragment), 700, true));
}

function highlightedCommentaryFragment(item, lang) {
	var highlight = item?._highlight;
	if (!highlight)
		return '';
	var fields = lang === 'ar' ? ['text', 'footnotes'] : ['text_en', 'footnotes_en'];
	for (var i = 0; i < fields.length; i++) {
		var fragments = highlight[fields[i]];
		if (!Array.isArray(fragments))
			continue;
		var markedFragments = fragments
			.map(fragment => Utils.trimToEmpty(fragment))
			.filter(fragment => fragment.indexOf('<i>') >= 0);
		if (markedFragments.length > 0)
			return markedFragments.join(' ... ');
	}
	return '';
}

function commentaryUrl(item) {
	var surah = Number(item?.surah);
	var ayahFrom = Number(item?.ayahFrom);
	var alias = Utils.trimToEmpty(item?.commentary_alias);
	if (!Number.isInteger(surah) || !Number.isInteger(ayahFrom) || !alias)
		return '';
	return `/quran/tafsir/${encodeURIComponent(commentarySlug(alias))}/${surah}/${ayahFrom}`;
}

function commentarySlug(alias) {
	return Utils.trimToEmpty(alias).replace(/^(?:(?:en|ar)-)?(?:tafsir-)?/, '');
}

function hydrateCommentaryMetadata(item) {
	if (!item || item.commentary_metadata_hydrated)
		return item;
	item.commentary_metadata_hydrated = true;
	var alias = Utils.trimToEmpty(item.commentary_alias);
	if (!alias)
		return item;
	var book = findCachedCommentary(alias);
	if (!book)
		return item;
	item.commentary_shortName = Utils.trimToEmpty(item.commentary_shortName || book.shortName);
	item.commentary_shortName_en = Utils.trimToEmpty(item.commentary_shortName_en || book.shortName_en);
	item.commentary_name = Utils.trimToEmpty(item.commentary_name || book.title);
	item.commentary_name_en = Utils.trimToEmpty(item.commentary_name_en || book.name_en);
	item.commentary_author = Utils.trimToEmpty(item.commentary_author || book.author);
	item.commentary_author_en = Utils.trimToEmpty(item.commentary_author_en || book.author_en);
	item.commentary_author_death = item.commentary_author_death || book.death;
	return item;
}

function findCachedCommentary(alias) {
	alias = Utils.trimToEmpty(alias);
	if (!alias)
		return null;
	var tafsirs = Tafsir.visibleTafsirsSync();
	var tafsir = tafsirs.find(book => book.alias === alias);
	if (tafsir)
		return tafsir;
	var translations = Tafsir.visibleTranslationsSync();
	var translation = translations.find(book => book.alias === alias);
	if (translation)
		return translation;
	return cachedCommentaryBooksForAutocomplete('tafsir')
		.concat(cachedCommentaryBooksForAutocomplete('trans'))
		.find(book => book.alias === alias) || null;
}

function commentaryTitle(item) {
	hydrateCommentaryMetadata(item);
	return Utils.trimToEmpty(item?.commentary_shortName_en || item?.commentary_name_en || item?.commentary_shortName || item?.commentary_name || item?.commentary_alias);
}

function commentaryArabicTitle(item) {
	hydrateCommentaryMetadata(item);
	return Utils.trimToEmpty(item?.commentary_shortName || item?.commentary_name || item?.commentary_shortName_en || item?.commentary_name_en || item?.commentary_alias);
}

function commentaryRangeLabel(item) {
	var ayahFrom = Number(item?.ayahFrom);
	var ayahTo = Number(item?.ayahTo);
	return `${item?.surah}:${ayahFrom}${Number.isInteger(ayahTo) && ayahTo > ayahFrom ? `-${ayahTo}` : ''}`;
}

function commentarySectionUrl(item) {
	return commentaryUrl(item);
}

function stripMarkdownEscapes(s) {
	return (s || '').toString().replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, '$1');
}

function cleanCommentaryFragment(s) {
	return Tafsir.stripPageMarkers(stripMarkdownEscapes(s))
		.replace(/^#{1,6}\s+[^\r\n]+[\r\n]+/, '')
		.replace(/^\[\^[^\]]+\]:\s*/, '')
		.replace(/\[\^[^\]]+\]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

function applyTocHighlights(item, lang) {
	var level = Number.isFinite(item?.level) ? item.level : parseInt(item?.level, 10);
	if (item?.doctype !== 'toc' || ![1, 2, 3].includes(level))
		return;
	if (lang === 'en') {
		copyHighlightValue(item, `h${level}_title_en`, item.title_en);
		copyHighlightValue(item, `h${level}_intro_en`, item.intro_en);
	} else {
		copyHighlightValue(item, `h${level}_title`, item.title);
		copyHighlightValue(item, `h${level}_intro`, item.intro);
	}
}

function applyHighlightField(item, highlight, sourceField, targetField) {
	var fragments = highlight[sourceField];
	if (!Array.isArray(fragments) || fragments.length < 1)
		return;
	copyHighlightValue(item, targetField || sourceField, fragments.join(' ... '));
}

function copyHighlightValue(item, field, value) {
	if (typeof value !== 'string' || value.trim() === '')
		return;
	if (typeof item[field] === 'string' && item[field].indexOf('<i>') >= 0)
		return;
	item[field] = value;
}

function cleanQuery(s) {
	if (s) {
		s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, '');
		s = s.replace(/[\p{P}]+/gu, ' ');
		s = s.replace(/[ʿʾ`']/g, '');
	}
	return s;
}

function normalizeBookFilters(b) {
	if (!b)
		return [];
	if (!Array.isArray(b))
		b = [b];
	return Array.from(new Set(b.map(normalizeBookFilter).filter(Boolean)));
}

function normalizeBookFilter(filter) {
	filter = Utils.trimToEmpty(filter);
	if (filter === 'tafsir')
		return 'commentaries';
	return filter;
}

function expandBookFilters(filters) {
	var expanded = [];
	for (var i = 0; i < filters.length; i++) {
		var filter = filters[i];
		if (BOOK_FILTER_GROUPS[filter])
			expanded.push(...BOOK_FILTER_GROUPS[filter].aliases);
		else
			expanded.push(filter);
	}
	return Array.from(new Set(expanded));
}

function hilite(q, hadith, attrName, lang) {
	var textHilited = '';
	if (lang == 'en')
		textHilited = hilite_en(q, hadith, attrName);
	else if (lang == 'ar')
		textHilited = hilite_ar(q, hadith, attrName);
	return textHilited;
}

function hilite_en(q, hadith, attrName) {
	var textHilited = hadith[attrName].replace(new RegExp(q, 'gi'), global.HILITE_START + '$&' + global.HILITE_END);
	textHilited = removeUnbalancedParentheses(textHilited);
	textHilited = textHilited.replace(new RegExp(global.HILITE_START, 'g'), '<i>');
	textHilited = textHilited.replace(new RegExp(global.HILITE_END, 'g'), '</i>');
	return textHilited;
}

function hilite_ar(q, hadith, attrName) {
	var text = hadith[attrName];
	var textPlain = hadith['search_' + attrName];
	var re = new RegExp(q, 'gi');
	var m = null;
	var hilites0 = [];
	var hilites1 = [];
	var i = 0;
	while ((m = re.exec(textPlain)) !== null) {
		var start = m.index;
		var end = m.index + m[0].length - 1;
		// find starting token
		for (i = 1; (start - i) > 0; i++)
			if (textPlain[start - i].match(/[\s]/))
				break;
		if (i < 0) i = 0;
		hilites0.push(textPlain.substring(0, start - i).split(/ /).length);
		// find ending token
		for (i = 1; (end + i) < (textPlain.length - 1); i++)
			if (textPlain[end + i].match(/\s/))
				break;
		if (i >= textPlain.length) i = textPlain.length;
		hilites1.push(textPlain.substring(0, end + i).split(/ /).length - 1);
	}
	// hilite tokens
	var textHilited = '';
	var toks = text.split(/ /);
	for (i = 0; i < toks.length; i++) {
		if (hilites0.indexOf(i) >= 0)
			textHilited += global.HILITE_START;
		textHilited += toks[i] + ' ';
		if (hilites1.indexOf(i) >= 0)
			textHilited += global.HILITE_END;
	}
	var hiliteStartsCount = (textHilited.match(new RegExp(global.HILITE_START, 'g')) || []).length;
	var hiliteEndsCount = (textHilited.match(new RegExp(global.HILITE_END, 'g')) || []).length;
	if (hiliteStartsCount < hiliteEndsCount)
		textHilited = global.HILITE_START + textHilited;
	textHilited = removeUnbalancedParentheses(textHilited);
	textHilited = textHilited.replace(new RegExp(global.HILITE_START, 'g'), '<i>');
	textHilited = textHilited.replace(new RegExp(global.HILITE_END, 'g'), '</i>');
	return textHilited;
}

function removeUnbalancedParentheses(s) {
	s = s.split('');
	let len = s.length, stack = [];
	for (let i = 0, c = s[0]; i < len; c = s[++i])
		if (c === global.HILITE_END)
			if (stack.length)
				stack.pop();
			else
				delete s[i];
		else if (c === global.HILITE_START)
			stack.push(i);
	for (let i = 0; i < stack.length; i++)
		delete s[stack[i]];
	return s.join('');
}
