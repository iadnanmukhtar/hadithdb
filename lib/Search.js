// @ts-check
'use strict';

const debug = require('debug')('hadithdb:Search');
const createError = require('http-errors');
const Arabic = require('../lib/Arabic');
const Books = require('./Books');
const Index = require('./Index');
const Utils = require('./Utils');
const { Item } = require('./Model');
const Surahs = require('./Surahs');

global.HILITE_START = '❬';
global.HILITE_END = '❭';

const BOOK_FILTER_GROUPS = Object.freeze({
	sahihayn: Object.freeze({
		label: 'Saḥīḥayn',
		aliases: Object.freeze(['bukhari', 'muslim'])
	}),
	sixbooks: Object.freeze({
		label: 'Kutub Sittah',
		aliases: Object.freeze(['bukhari', 'muslim', 'abudawud', 'tirmidhi', 'nasai', 'ibnmajah'])
	})
});
const SEARCH_ORDER_BY = '_score DESC, book_ordinal ASC, ordinal ASC';
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
			'footnotes^2',
			'commentary_name^2',
			'commentary_shortName^2',
			'commentary_author'
		]),
		en: Object.freeze([
			'text_en^5',
			'footnotes_en^2',
			'commentary_name_en^2',
			'commentary_shortName_en^2',
			'commentary_author_en'
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

	static async a_searchText(qs, b, offset) {
		qs = Search.truncateQuery(qs);
		try {
			if (Search.isExpressionQuery(qs))
				return await a_searchExpression(qs.trim().substring(1), b, offset);
			if (qs.match(/[a-z]/))
				return await a_search(qs, b, 'en', offset);
			else
				return await a_search(qs, b, 'ar', offset);
		} catch (err) {
			err.message = `Unable to perform text search for [${qs}]`;
			debug(`${err.message}\n${err.stack}`);
			throw createError(500, err.message);
		}
	}

	static async a_autocomplete(qs, b, limit) {
		qs = Search.truncateQuery(qs);
		limit = parseInt(limit, 10);
		if (!Number.isInteger(limit) || limit < 1)
			limit = 10;
		limit = Math.min(limit, 12);
		if (qs.length < 2 || Search.isExpressionQuery(qs))
			return [];
		try {
			var lang = qs.match(/[a-z]/) ? 'en' : 'ar';
			var selectedFilters = normalizeBookFilters(b);
			var suggestionLang = Arabic.isArabic(qs) ? 'ar' : 'en';
			var generated = quranAutocompleteSuggestions(qs, suggestionLang, selectedFilters)
				.concat(bookReferenceAutocompleteSuggestions(qs, suggestionLang, selectedFilters))
				.concat(bookAutocompleteSuggestions(qs, suggestionLang, selectedFilters));
			if (generated.length >= limit)
				return generated.slice(0, limit);
			if (isQuranOnlySearch(selectedFilters))
				return await quranOnlyAutocompleteSuggestions(qs, lang, generated, limit);
			if (shouldRunQuranFirstSearch(selectedFilters))
				return await quranThenRestAutocompleteSuggestions(qs, lang, selectedFilters, generated, limit);
			var query = buildAutocompleteQuery(qs, lang, selectedFilters);
			var docs = await Index.docsFromQuery('hadiths,toc,commentaries', query, 0, limit - generated.length, SEARCH_ORDER_BY, true);
			docs.sort(compareSearchResults);
			return sortAutocompleteSuggestions(dedupeAutocompleteSuggestions(generated.concat(docs.map(doc => formatAutocompleteSuggestion(doc, lang, qs)).filter(Boolean)))).slice(0, limit);
		} catch (err) {
			err.message = `Unable to fetch autocomplete suggestions for [${qs}]`;
			debug(`${err.message}\n${err.stack}`);
			throw createError(500, err.message);
		}
	}

	static isExpressionQuery(qs) {
		return (qs || '').toString().trim().charAt(0) === '=';
	}

	static describeBookFilters(b) {
		return normalizeBookFilters(b).map(filter => {
			if (filter === 'toc')
				return 'Headings';
			if (filter === 'commentaries')
				return 'Commentaries';
			if (BOOK_FILTER_GROUPS[filter])
				return BOOK_FILTER_GROUPS[filter].label;
			var book = global.books.find(book => book.alias === filter);
			return book ? book.shortName_en : filter;
		});
	}

}

module.exports = Search;

function quranAutocompleteSuggestions(qs, lang, selectedFilters) {
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

function allowsQuranSuggestions(selectedFilters) {
	if (!selectedFilters || selectedFilters.length < 1)
		return true;
	var bookFilters = expandBookFilters(selectedFilters.filter(filter => filter !== 'toc' && filter !== 'commentaries'));
	if (bookFilters.length > 0)
		return bookFilters.indexOf('quran') >= 0;
	return selectedFilters.indexOf('commentaries') < 0;
}

function bookReferenceAutocompleteSuggestions(qs, lang, selectedFilters) {
	var reference = Books.findReference(qs, global.books);
	if (!reference || !allowsBookReferenceSuggestion(reference.book.alias, selectedFilters))
		return [];
	var titleEn = Utils.trimToEmpty(reference.book.name_en || reference.book.shortName_en || reference.book.alias);
	var titleAr = Utils.trimToEmpty(reference.book.name || reference.book.shortName || reference.book.alias);
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

function bookAutocompleteSuggestions(qs, lang, selectedFilters) {
	if (!Array.isArray(global.books))
		return [];
	return global.books
		.filter(book => allowsBookAutocompleteSuggestion(book.alias, selectedFilters) && Books.matchesQuery(book, qs, lang))
		.slice(0, 3)
		.map(book => formatBookAutocompleteSuggestion(book, lang));
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
	var titleEn = `Surah ${surah.name_en} ${ref}`;
	var titleAr = `سورة ${surah.name_ar} ${Arabic.toArabicDigits(ref)}`;
	return {
		label: lang === 'ar' ? titleAr : titleEn,
		value: lang === 'ar' ? titleAr : titleEn,
		url: `/quran:${ref}`,
		ref: `quran:${ref}`,
		type: 'Ayah',
		is_quran: true,
		lang: lang,
		metadata_en: `quran:${ref} - Surah ${surah.name_en}`,
		metadata_ar: `سورة ${surah.name_ar}`,
		fragment: escapeHtml(lang === 'ar' ? titleAr : titleEn)
	};
}

async function quranThenRestAutocompleteSuggestions(qs, lang, selectedFilters, generated, limit) {
	var remaining = limit - generated.length;
	if (remaining < 1)
		return generated.slice(0, limit);
	var quranQuery = buildQuranOnlyAutocompleteQuery(qs, lang);
	var quranDocs = await Index.docsFromQuery(quranOnlyIndexNames(), quranQuery, 0, remaining, SEARCH_ORDER_BY, true);
	quranDocs.sort(compareSearchResults);
	var suggestions = generated.concat(quranDocs.map(doc => formatAutocompleteSuggestion(doc, lang, qs)).filter(Boolean));
	remaining = limit - suggestions.length;
	if (remaining > 0) {
		var restQuery = buildQuranFirstRestAutocompleteQuery(qs, lang, selectedFilters);
		var restDocs = await Index.docsFromQuery(quranFirstRestIndexNames(selectedFilters), restQuery, 0, remaining, SEARCH_ORDER_BY, true);
		restDocs.sort(compareSearchResults);
		suggestions = suggestions.concat(restDocs.map(doc => formatAutocompleteSuggestion(doc, lang, qs)).filter(Boolean));
	}
	return dedupeAutocompleteSuggestions(suggestions).slice(0, limit);
}

async function quranOnlyAutocompleteSuggestions(qs, lang, generated, limit) {
	var remaining = limit - generated.length;
	if (remaining < 1)
		return generated.slice(0, limit);
	var quranDocs = await Index.docsFromQuery(quranOnlyIndexNames(), buildQuranOnlyAutocompleteQuery(qs, lang), 0, remaining, SEARCH_ORDER_BY, true);
	quranDocs.sort(compareSearchResults);
	return dedupeAutocompleteSuggestions(generated.concat(quranDocs.map(doc => formatAutocompleteSuggestion(doc, lang, qs)).filter(Boolean))).slice(0, limit);
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

function sortAutocompleteSuggestions(suggestions) {
	var priority = {
		Ayah: 0,
		Book: 1,
		Surah: 1
	};
	return suggestions.sort(function (a, b) {
		if (!!a?.is_reference !== !!b?.is_reference)
			return a?.is_reference ? -1 : 1;
		return (priority[a?.type] ?? 2) - (priority[b?.type] ?? 2);
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

async function a_search(qs, b, lang, offset) {
	var selectedFilters = normalizeBookFilters(b);
	if (isQuranOnlySearch(selectedFilters))
		return await executeQuranOnlySearch(qs, lang, offset);
	if (shouldRunQuranFirstSearch(selectedFilters))
		return await executeQuranThenRestSearch(qs, lang, offset, selectedFilters);
	var query = buildBookOrdinalQuery(qs, lang, selectedFilters);
	return await executeSearchQuery(qs, query, offset);
}

async function a_searchExpression(qs, b, offset) {
	qs = (qs || '').trim();
	if (qs.length < 1)
		return [];
	var selectedFilters = normalizeBookFilters(b);
	var filters = buildSearchFilters(selectedFilters);
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
	return await executeSearchQuery(qs, query, offset);
}

async function executeSearchQuery(qs, query, offset) {
	var _results = await Index.docsFromQuery('hadiths,toc,commentaries', query, offset, undefined, SEARCH_ORDER_BY, true);
	var totalResults = Number.isFinite(_results.total) ? _results.total : _results.length;
	_results.sort(compareSearchResults);
	await hydrateCommentaryAyahs(_results);
	var results = await formatSearchDocs(qs, _results);
	results.total = totalResults;
	return results;
}

async function executeQuranOnlySearch(qs, lang, offset) {
	var _results = await Index.docsFromQuery(quranOnlyIndexNames(), buildQuranOnlySearchQuery(qs, lang), offset, undefined, SEARCH_ORDER_BY, true);
	var totalResults = Number.isFinite(_results.total) ? _results.total : _results.length;
	_results.sort(compareSearchResults);
	var results = await formatSearchDocs(qs, _results);
	results.total = totalResults;
	return results;
}

async function executeQuranThenRestSearch(qs, lang, offset, selectedFilters) {
	offset = Number.isInteger(offset) ? offset : 0;
	var size = Number(global.settings.search.itemsPerPage) + 1;
	var quranQuery = buildQuranOnlySearchQuery(qs, lang);
	var quranDocs = await Index.docsFromQuery('hadiths', quranQuery, offset, size, SEARCH_ORDER_BY, true);
	quranDocs.sort(compareSearchResults);
	var quranTotal = Number.isFinite(quranDocs.total) ? quranDocs.total : quranDocs.length;
	var docs = quranDocs;
	var restTotal = 0;
	if (docs.length < size) {
		var restOffset = Math.max(0, offset - quranTotal);
		var restSize = size - docs.length;
		var restDocs = await Index.docsFromQuery(quranFirstRestIndexNames(selectedFilters), buildQuranFirstRestSearchQuery(qs, lang, selectedFilters), restOffset, restSize, SEARCH_ORDER_BY, true);
		restDocs.sort(compareSearchResults);
		restTotal = Number.isFinite(restDocs.total) ? restDocs.total : restDocs.length;
		docs = docs.concat(restDocs);
	} else {
		var restCountDocs = await Index.docsFromQuery(quranFirstRestIndexNames(selectedFilters), buildQuranFirstRestSearchQuery(qs, lang, selectedFilters), 0, 0, SEARCH_ORDER_BY, false);
		restTotal = Number.isFinite(restCountDocs.total) ? restCountDocs.total : 0;
	}
	await hydrateCommentaryAyahs(docs);
	var results = await formatSearchDocs(qs, docs);
	results.total = quranTotal + restTotal;
	return results;
}

async function formatSearchDocs(qs, _results) {
	debug(`${_results.length} items found`);
	var results = [];
	try {
		for (var i = 0; i < _results.length; i++) {
			var hadith = _results[i];
			try {
				applyElasticHighlights(hadith);
				results.push(hadith.doctype === 'commentary' ? formatCommentarySearchResult(hadith, qs.match(/[a-z]/) ? 'en' : 'ar') : new Item(hadith));
			} catch (err) {
				debug(`Search broke on Hadith ${hadith.bookId}:${hadith.num} for Query [${qs}]\n${err.stack}`);
			}
		}
	} catch (err) {
		debug(err);
		results = _results.map(item => new Item(item));
	}
	return results;
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

function buildBookOrdinalQuery(queryText, lang, selectedFilters) {
	return buildSearchQuery(queryText, lang, selectedFilters);
}

function buildSearchQuery(queryText, lang, selectedFilters) {
	queryText = (queryText || '').trim();
	var filters = buildSearchFilters(selectedFilters);
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

function buildAutocompleteQuery(queryText, lang, selectedFilters) {
	queryText = (queryText || '').trim();
	var filters = buildSearchFilters(selectedFilters);
	var tokenCount = queryText.split(/\s+/).filter(Boolean).length;
	var should = [
		buildAutocompleteDoctypeClause('hadith', queryText, lang, tokenCount),
		buildAutocompleteDoctypeClause('toc', queryText, lang, tokenCount),
		buildAutocompleteDoctypeClause('commentary', queryText, lang, tokenCount),
		buildQuranSurahAutocompleteClause(queryText, lang)
	];
	var query = {
		bool: {
			should: should,
			minimum_should_match: 1
		}
	};
	if (filters.length > 0)
		query.bool.filter = filters;
	return query;
}

function buildQuranOnlyAutocompleteQuery(queryText, lang) {
	queryText = (queryText || '').trim();
	return buildQuranOnlySearchQuery(queryText, lang, true);
}

function buildQuranOnlySearchQuery(queryText, lang, autocomplete) {
	queryText = (queryText || '').trim();
	var normalizedQueryText = lang === 'ar' ? Utils.trimToEmpty(Arabic.normalize(queryText, false)) : queryText;
	var tokenCount = normalizedQueryText.split(/\s+/).filter(Boolean).length;
	var fields = lang === 'ar'
		? ['body_search_ar^6', 'body^5', 'footnote^2']
		: ['footnote_en^5', 'footnote_en_search^5', 'body_en^3', 'body_en_search^3'];
	var ayahClause = {
		bool: {
			filter: [
				{ term: { book_alias: 'quran' } },
				{ term: { doctype: 'hadith' } }
			],
			must: {
				bool: {
					should: buildAllTokenMatchClauses(normalizedQueryText, fields, tokenCount),
					minimum_should_match: 1
				}
			}
		}
	};
	return {
		bool: {
			should: [
				ayahClause,
				autocomplete
					? buildQuranSurahAutocompleteClause(queryText, lang)
					: buildQuranSurahSearchClause(queryText, lang, tokenCount)
			],
			minimum_should_match: 1
		}
	};
}

function buildAllTokenMatchClauses(queryText, fields, tokenCount) {
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
	return should;
}

function buildCommentaryOnlyAutocompleteQuery(queryText, lang) {
	queryText = (queryText || '').trim();
	var tokenCount = queryText.split(/\s+/).filter(Boolean).length;
	return buildAutocompleteDoctypeClause('commentary', queryText, lang, tokenCount);
}

function buildCommentaryOnlySearchQuery(queryText, lang) {
	queryText = (queryText || '').trim();
	var tokenCount = queryText.split(/\s+/).filter(Boolean).length;
	return buildDoctypeSearchClause('commentary', queryText, lang, tokenCount);
}

function buildQuranFirstRestAutocompleteQuery(queryText, lang, selectedFilters) {
	if (isQuranCommentarySearch(selectedFilters))
		return buildCommentaryOnlyAutocompleteQuery(queryText, lang);
	var query = buildAutocompleteQuery(queryText, lang, selectedFilters);
	return excludeQuranAyahDocs(query);
}

function buildQuranFirstRestSearchQuery(queryText, lang, selectedFilters) {
	if (isQuranCommentarySearch(selectedFilters))
		return buildCommentaryOnlySearchQuery(queryText, lang);
	var query = buildSearchQuery(queryText, lang, selectedFilters);
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

function quranOnlyIndexNames() {
	return 'hadiths,toc';
}

function buildQuranSurahSearchClause(queryText, lang, tokenCount) {
	var fields = lang === 'ar'
		? ['title_search_ar^8', 'title^6', 'h1_title^5']
		: ['title_search_en^8', 'title_search_en_prefix^6', 'title_en^5', 'h1_title_en_search^4', 'h1_title_en_prefix^3'];
	return {
		bool: {
			filter: [
				{ term: { doctype: 'toc' } },
				{ term: { book_alias: 'quran' } },
				{ term: { level: 1 } }
			],
			should: buildMultiMatchClauses(queryText, fields, tokenCount),
			minimum_should_match: 1
		}
	};
}

function buildQuranSurahAutocompleteClause(queryText, lang) {
	var field = lang === 'ar' ? 'title_search_ar' : 'title_search_en_prefix';
	return {
		bool: {
			filter: [
				{ term: { doctype: 'toc' } },
				{ term: { book_alias: 'quran' } },
				{ term: { level: 1 } }
			],
			must: {
				match_phrase_prefix: {
					[field]: {
						query: queryText,
							boost: 1000000
					}
				}
			}
		}
	};
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

function buildAutocompleteDoctypeClause(doctype, queryText, lang, tokenCount) {
	var langFields = SEARCH_FIELDS[doctype] || SEARCH_FIELDS.hadith;
	var fields = langFields[lang] || langFields.en;
	if (doctype === 'toc')
		fields = fields.filter(field => !field.startsWith('book_'));
	var should = buildMultiMatchClauses(queryText, fields, tokenCount);
	autocompletePrefixFields(doctype, lang).forEach(function (field) {
		should.push({
			match_phrase_prefix: {
				[field]: {
						query: queryText,
						boost: 12
				}
			}
		});
	});
	return {
		bool: {
			filter: {
				term: {
					doctype: doctype
				}
			},
			should: should,
			minimum_should_match: 1
		}
	};
}

function autocompletePrefixFields(doctype, lang) {
	if (doctype === 'toc') {
		if (lang === 'en')
			return ['title_search_en_prefix', 'h1_title_en_prefix', 'h2_title_en_prefix', 'h3_title_en_prefix'];
		return ['title_search_ar', 'h1_title', 'h2_title', 'h3_title'];
	}
	if (doctype === 'commentary')
		return lang === 'en' ? ['commentary_name_en', 'commentary_shortName_en', 'text_en'] : ['commentary_name', 'commentary_shortName', 'text'];
	if (lang === 'en')
		return ['title_en_prefix', 'body_en_search'];
	return ['title_search_ar', 'body'];
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
	return {
		label: title,
		value: title,
		url: `/${doc.path}`,
		ref: Utils.trimToEmpty(doc.ref),
		type: 'Surah',
		is_quran: true,
		lang: lang,
		metadata_en: [doc.ref, doc.book_shortName_en, titleEn].filter(Boolean).join(' - '),
		metadata_ar: [doc.book_shortName, titleAr].filter(Boolean).join(' - '),
		fragment: escapeHtml(title)
	};
}

function hasBookAutocompleteHighlight(doc) {
	var highlight = doc?._highlight || {};
	return ['book_name_search_ar', 'book_shortName_search_ar', 'book_name_search_en', 'book_name_search_en_prefix', 'book_shortName_search_en', 'book_shortName_search_en_prefix'].some(function (field) {
		return Array.isArray(highlight[field]) && highlight[field].some(fragment => fragment.indexOf('<i>') >= 0);
	});
}

function formatBookAutocompleteSuggestion(doc, lang) {
	var bookAlias = doc.book_alias || doc.alias;
	var titleEn = Utils.trimToEmpty(doc.book_name_en || doc.name_en || doc.book_shortName_en || doc.shortName_en || bookAlias);
	var titleAr = Utils.trimToEmpty(doc.book_name || doc.name || doc.book_shortName || doc.shortName || bookAlias);
	var title = lang === 'ar' ? titleAr : titleEn;
	return {
		label: title,
		value: title,
		url: `/${bookAlias}`,
		ref: bookAlias,
		type: 'Book',
		is_quran: bookAlias === 'quran',
		lang: lang,
		metadata_en: titleEn,
		metadata_ar: titleAr,
		fragment: escapeHtml(title)
	};
}

function isQuranSurahDoc(doc) {
	return doc?.book_alias === 'quran' && Number(doc?.level) === 1;
}

function formatCommentaryAutocompleteSuggestion(doc, lang) {
	var highlightedFragment = firstHighlightedFragment(doc, lang);
	if (!highlightedFragment)
		return null;
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
					: ['text', 'footnotes', 'commentary_name', 'commentary_shortName', 'commentary_author', 'body', 'body_search_ar', 'book_name_search_ar', 'book_shortName_search_ar', 'title_search_ar', 'title', 'footnote', 'chain', 'intro_search_ar', 'intro', 'h1_title', 'h2_title', 'h3_title', 'h1_intro', 'h2_intro', 'h3_intro'])
				: (isQuranAyah
					? ['body_en', 'body_en_search', 'title_en', 'title_en_search', 'title_search_en', 'footnote_en', 'footnote_en_search', 'chain_en', 'chain_en_search', 'intro_en', 'intro_search_en', 'h1_title_en', 'h2_title_en', 'h3_title_en', 'h1_intro_en', 'h2_intro_en', 'h3_intro_en']
					: ['text_en', 'footnotes_en', 'commentary_name_en', 'commentary_shortName_en', 'commentary_author_en', 'body_en', 'body_en_search', 'book_name_search_en', 'book_shortName_search_en', 'title_en', 'title_en_search', 'title_search_en', 'footnote_en', 'footnote_en_search', 'chain_en', 'chain_en_search', 'intro_en', 'intro_search_en', 'h1_title_en', 'h2_title_en', 'h3_title_en', 'h1_intro_en', 'h2_intro_en', 'h3_intro_en']);
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

function buildSearchFilters(selectedFilters) {
	var filters = [];
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

function isQuranCommentarySearch(selectedFilters) {
	return Array.isArray(selectedFilters)
		&& selectedFilters.indexOf('quran') >= 0
		&& selectedFilters.indexOf('commentaries') >= 0
		&& selectedFilters.indexOf('toc') < 0;
}

function isQuranOnlySearch(selectedFilters) {
	return Array.isArray(selectedFilters)
		&& selectedFilters.length === 1
		&& selectedFilters[0] === 'quran';
}

function shouldRunQuranFirstSearch(selectedFilters) {
	return isQuranCommentarySearch(selectedFilters);
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

function applyElasticHighlights(item) {
	var highlight = item?._highlight;
	if (!highlight)
		return;
	applyHighlightField(item, highlight, 'title');
	applyHighlightField(item, highlight, 'title_en');
	applyHighlightField(item, highlight, 'body');
	applyHighlightField(item, highlight, 'body_en');
	applyHighlightField(item, highlight, 'chain');
	applyHighlightField(item, highlight, 'chain_en');
	applyHighlightField(item, highlight, 'footnote');
	applyHighlightField(item, highlight, 'footnote_en');
	applyHighlightField(item, highlight, 'intro');
	applyHighlightField(item, highlight, 'intro_en');
	applyHighlightField(item, highlight, 'title_search_ar', 'title');
	applyHighlightField(item, highlight, 'title_en_search', 'title_en');
	applyHighlightField(item, highlight, 'title_search_en', 'title_en');
	applyHighlightField(item, highlight, 'body_en_search', 'body_en');
	applyHighlightField(item, highlight, 'footnote_en_search', 'footnote_en');
	applyHighlightField(item, highlight, 'chain_en_search', 'chain_en');
	applyHighlightField(item, highlight, 'intro_search_ar', 'intro');
	applyHighlightField(item, highlight, 'intro_search_en', 'intro_en');
	applyHighlightField(item, highlight, 'text');
	applyHighlightField(item, highlight, 'text_en');
	applyHighlightField(item, highlight, 'footnotes');
	applyHighlightField(item, highlight, 'footnotes_en');
	applyTocHighlights(item);
}

function formatCommentarySearchResult(item, lang) {
	var surah = Surahs.find(Number(item?.surah));
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

function commentaryFragmentHtml(item, lang) {
	var fragment = firstHighlightedFragment(item, lang);
	if (!fragment)
		fragment = lang === 'ar' ? firstText(item.text, item.footnotes) : firstText(item.text_en, item.footnotes_en);
	return highlightFragmentToHtml(Utils.truncate(cleanCommentaryFragment(fragment), 700, true));
}

function commentaryUrl(item) {
	var surah = Number(item?.surah);
	var ayahFrom = Number(item?.ayahFrom);
	var ayahTo = Number(item?.ayahTo);
	var range = Number.isInteger(ayahTo) && ayahTo > ayahFrom ? `${ayahFrom}-${ayahTo}` : `${ayahFrom}`;
	return `/quran:${surah}:${range}#open-tafsir=${encodeURIComponent(item?.commentary_alias || '')}`;
}

function commentaryTitle(item) {
	return Utils.trimToEmpty(item?.commentary_shortName_en || item?.commentary_name_en || item?.commentary_shortName || item?.commentary_name || item?.commentary_alias);
}

function commentaryArabicTitle(item) {
	return Utils.trimToEmpty(item?.commentary_shortName || item?.commentary_name || item?.commentary_shortName_en || item?.commentary_name_en || item?.commentary_alias);
}

function commentaryRangeLabel(item) {
	var ayahFrom = Number(item?.ayahFrom);
	var ayahTo = Number(item?.ayahTo);
	return `${item?.surah}:${ayahFrom}${Number.isInteger(ayahTo) && ayahTo > ayahFrom ? `-${ayahTo}` : ''}`;
}

function commentarySectionUrl(item) {
	var path = Utils.trimToEmpty(item?.section_path);
	if (!path && Number.isFinite(Number(item?.h1)) && Number.isFinite(Number(item?.h2)))
		path = `quran/${Number(item.h1)}/${Number(item.h2)}`;
	return path ? `/${path.replace(/^\/+/, '')}#tafsir=${encodeURIComponent(item?.commentary_alias || '')}` : '';
}

function stripMarkdownEscapes(s) {
	return (s || '').toString().replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, '$1');
}

function cleanCommentaryFragment(s) {
	return stripMarkdownEscapes(s)
		.replace(/^#{1,6}\s+[^\r\n]+[\r\n]+/, '')
		.replace(/^\[\^[^\]]+\]:\s*/, '')
		.replace(/\[\^[^\]]+\]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

function applyTocHighlights(item) {
	var level = Number.isFinite(item?.level) ? item.level : parseInt(item?.level, 10);
	if (item?.doctype !== 'toc' || ![1, 2, 3].includes(level))
		return;
	copyHighlightValue(item, `h${level}_title`, item.title);
	copyHighlightValue(item, `h${level}_title_en`, item.title_en);
	copyHighlightValue(item, `h${level}_intro`, item.intro);
	copyHighlightValue(item, `h${level}_intro_en`, item.intro_en);
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
	return Array.from(new Set(b.filter(Boolean)));
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
