// @ts-check
'use strict';

const debug = require('debug')('hadithdb:Search');
const createError = require('http-errors');
const Arabic = require('../lib/Arabic');
const Index = require('./Index');
const { Item } = require('./Model');

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
			'title_search_ar^4',
			'title^4',
			'intro_search_ar^2',
			'intro^2'
		]),
		en: Object.freeze([
			'title_en^4',
			'title_search_en^4',
			'title_search_en_prefix^3',
			'intro_en^2',
			'intro_search_en^2'
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

	static isExpressionQuery(qs) {
		return (qs || '').toString().trim().charAt(0) === '=';
	}

	static describeBookFilters(b) {
		return normalizeBookFilters(b).map(filter => {
			if (filter === 'toc')
				return 'Headings';
			if (BOOK_FILTER_GROUPS[filter])
				return BOOK_FILTER_GROUPS[filter].label;
			var book = global.books.find(book => book.alias === filter);
			return book ? book.shortName_en : filter;
		});
	}

}

module.exports = Search;

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
	var _results = await Index.docsFromQuery('hadiths,toc', query, offset, undefined, SEARCH_ORDER_BY, true);
	var totalResults = Number.isFinite(_results.total) ? _results.total : _results.length;
	_results.sort(compareSearchResults);
	debug(`${_results.length} items found`);
	var results = [];
	try {
		for (var i = 0; i < _results.length; i++) {
			var hadith = _results[i];
			try {
				applyElasticHighlights(hadith);
				results.push(new Item(hadith));
			} catch (err) {
				debug(`Search broke on Hadith ${hadith.bookId}:${hadith.num} for Query [${qs}]\n${err.stack}`);
			}
		}
	} catch (err) {
		debug(err);
		results = _results.map(item => new Item(item));
	}
	results.total = totalResults;
	return results;
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

function buildSearchFilters(selectedFilters) {
	var filters = [];
	if (!selectedFilters || selectedFilters.length < 1)
		return filters;
	if (selectedFilters.indexOf('toc') >= 0)
		filters.push({ term: { doctype: 'toc' } });
	var bookAliases = expandBookFilters(selectedFilters.filter(filter => filter !== 'toc'));
	if (bookAliases.length > 0)
		filters.push({ terms: { book_alias: bookAliases } });
	return filters;
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
	applyTocHighlights(item);
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
