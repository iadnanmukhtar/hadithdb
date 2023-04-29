/* jslint node:true, esversion:9 */
'use strict';

const axios = require('axios');
const createError = require('http-errors');
const Hadith = require('../lib/Hadith');
const SearchResult = require('../lib/SearchResult');
const Arabic = require('../lib/Arabic');

global.HILITE_START = '❮';
global.HILITE_END = '❯';
global.PROXIMITY = 100;
global.SURROUND_LENGTH = 200;
global.MAX_RESULTS = 100;

class Search {

	static async a_getRandom() {
		var results = await global.query(`
				SELECT * FROM hadiths AS t1 
				JOIN (SELECT id FROM hadiths WHERE remark = 0 ORDER BY RAND() LIMIT 1)
				AS t2 ON t1.id=t2.id;
			`);
		if (results.length > 0) {
			var hadith = new Hadith(results[0]);
			return hadith;
		} else
			throw createError(424, `Unable to find a random ḥadīth`);
	}

	static async a_lookupByRef(bookAlias, num) {
		var results = [];
		var book = global.books.find(function (value) {
			return (value.alias == bookAlias);
		});
		if (book) {
			var reNum = '^' + num + '([^0-9]|$)';
			var hadiths = await global.query(`SELECT * FROM hadiths
					WHERE
						bookId = ${book.id}
					AND REGEXP_LIKE(num, "${reNum}", "i")`);
			if (hadiths.length > 0) {
				var prevAndNextHadiths = await global.query(`SELECT * FROM hadiths
						WHERE ordinal=${hadiths[0].ordinal}-1 OR ordinal=${hadiths[hadiths.length - 1].ordinal}+1`);
				if (prevAndNextHadiths) {
					if (prevAndNextHadiths && hadiths[0].ordinal > prevAndNextHadiths[0].ordinal)
						hadiths[0].prev = prevAndNextHadiths[0];
					if (hadiths[hadiths.length - 1].ordinal < prevAndNextHadiths[prevAndNextHadiths.length - 1].ordinal)
						hadiths[hadiths.length - 1].next = prevAndNextHadiths[prevAndNextHadiths.length - 1];
				}
				for (var i = 0; i < hadiths.length; i++) {
					var hadith = new Hadith(hadiths[i]);
					await Hadith.a_dbHadithInit(hadith);
					results.push(hadith);
				}
			} else
				throw createError(404, `Reference '${bookAlias}:${num}' does not exist`);
		} else
			throw createError(404, `Book '${bookAlias}' does not exist`);
		return results;
	}

	static async a_lookupQuranByRange(surah, ayah1, ayah2) {
		var results = [{
			book: global.books[0]
		}];
		var rs = await global.query(`SELECT * FROM hadiths
				WHERE
					bookId = 0
				AND h1 = ${surah}
				AND (numInChapter BETWEEN ${ayah1} AND ${ayah2})`);
		var body_en = '', body = '';
		if (rs.length > 0) {
			var firstAyah = null;
			for (var i = 0; i < rs.length; i++) {
				var ayah = new Hadith(rs[i]);
				await Hadith.a_dbHadithInit(ayah);
				if (i == 0) {
					firstAyah = ayah;
					results[0].title_en = ayah.section.title_en;
					results[0].title = ayah.section.title;
					results[0].chapter = ayah.chapter;
					results[0].section = ayah.section;
					body_en += `<sup>${ayah.h1}:${ayah.numInChapter}</sup>`;
				} else {
					body_en += ` <sup>${ayah.numInChapter}</sup>`;
				}
				body_en += ` ${ayah.body_en}`;
				if (i == 0)
					body += `${ayah.body} <sup>${Arabic.toArabicDigits(ayah.h1)}:${Arabic.toArabicDigits(ayah.numInChapter)}</sup> ۝ `;
				else
					body += `${ayah.body} <sup>${Arabic.toArabicDigits(ayah.numInChapter)}</sup> ۝ `;
			}
			results[0].body_en = body_en.trim();
			results[0].body = body.trim();
			results[0].num = `${firstAyah.h1}:${firstAyah.numInChapter}-${rs[rs.length - 1].numInChapter}`;
			results[0].num_ar = `${Arabic.toArabicDigits(firstAyah.h1)} ${Arabic.toArabicDigits(firstAyah.numInChapter)}-${Arabic.toArabicDigits(rs[rs.length - 1].numInChapter)}`;
			results[0].numStart = firstAyah.numInChapter;
			results[0].numEnd = rs[rs.length - 1].numInChapter;
		} else
			throw createError(404, `Reference 'passage:${ayah1}-${ayah2}' does not exist`);
		return results;
	}

	static async a_searchText(qs) {
		try {
			if (qs.match(/[a-z]/))
				return await a_search(qs, 'en');
			else
				return await a_search(qs, 'ar');
		} catch (err) {
			err.message = `Unable to perform text search for [${qs}]`;
			console.error(`${err.message}\n${err.stack}`);
			throw createError(500, err.mesage);
		}
	}

}

module.exports = Search;

function toTokenRegexp(qs) {
	var qt = qs.split(/[\s\-\_\,\.\']+/);
	var q = '(';
	for (var j = 0; j < qt.length; j++) {
		q += qt[j];
		if (j < qt.length - 1)
			q += '|';
	}
	q += ')';
	return new RegExp(q, 'ig');
}

async function a_search(qs, lang, matchType) {
	var _hadiths = await axios.post(
		global.searchURL + '/_search',
		{
			"query": {
				"query_string": {
					"query": qs
				}
			},
			"from": 0,
			"size": 101,
			"sort": []
		},
		{ 'Content-Type': 'application/json' });
	var hadiths = [];
	if (Arabic.isArabic(qs)) {
		qs = Arabic.normalize(qs);
		for (var n = 0; n < _hadiths.data.hits.hits.length; n++) {
			var _hadith = _hadiths.data.hits.hits[n]._source;
			_hadith.score = _hadiths.data.hits.hits[n]._score;
			_hadith.search_chain = Arabic.normalize(_hadith.chain);
			_hadith.search_body = Arabic.normalize(_hadith.body);
			_hadith.search_footnote = Arabic.normalize(_hadith.footnote);
			hadiths.push(_hadith);
		}
	} else {
		for (var n = 0; n < _hadiths.data.hits.hits.length; n++) {
			var _hadith = _hadiths.data.hits.hits[n]._source;
			_hadith.score = _hadiths.data.hits.hits[n]._score;
			hadiths.push(_hadith);
		}
	}
	var results = [];
	var q = toTokenRegexp(qs);
	for (var i = 0; i < hadiths.length; i++) {
		var hadith = hadiths[i];
		try {
			var matches = [];
			if (results.length > global.MAX_RESULTS)
				break;
			if (lang == 'en') {
				if (hadith.body_en && hadith.body_en.match(q))
					matches.push({ body_en: hilite(q, hadith, 'body_en', lang) });
				if (hadith.chain_en && hadith.chain_en.match(q))
					matches.push({ chain_en: hilite(q, hadith, 'chain_en', lang) });
				if (hadith.footnote_en && hadith.footnote_en.match(q))
					matches.push({ footnote_en: hilite(q, hadith, 'footnote_en', lang) });
			} else if (lang == 'ar') {
				if (hadith.search_body && hadith.search_body.match(q))
					matches.push({ body: hilite(q, hadith, 'body', lang) });
				if (hadith.search_chain && hadith.search_chain.match(q))
					matches.push({ chain: hilite(q, hadith, 'chain', lang) });
				if (hadith.search_footnote && hadith.search_footnote.match(q))
					matches.push({ footnote: hilite(q, hadith, 'footnote', lang) });
			}
			results.push(new SearchResult(hadith, matches, matchType));
		} catch (err) {
			console.error(`Search broke on Hadith ${hadith.bookId}:${hadith.num} for Query [${q}]\n${err.stack}`);
			throw err;
		}
	}
	return results;
}

function cleanQuery(s) {
	if (s) {
		s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, '');
		s = s.replace(/[\p{P}]+/gu, ' ');
		s = s.replace(/[ʿʾ`']/g, '');
	}
	return s;
}

function hilite(q, hadith, attrName, lang) {
	var textHilited = '';
	if (lang == 'en')
		textHilited = hilite_en(q, hadith, attrName);
	else if (lang == 'ar')
		textHilited = hilite_ar(q, hadith, attrName);
	var m = new RegExp(global.HILITE_START).exec(textHilited);
	if (m) {
		var shortenStart = ((m.index - global.SURROUND_LENGTH) < 0) ? 0 : (m.index - global.SURROUND_LENGTH);
		var shortenEnd = m.index + global.SURROUND_LENGTH + 1;
		var shortenedText = textHilited.substring(shortenStart, shortenEnd);
		var hiliteStartsCount = (shortenedText.match(new RegExp(global.HILITE_START, 'g')) || []).length;
		var hiliteEndsCount = (shortenedText.match(new RegExp(global.HILITE_END, 'g')) || []).length;
		if (hiliteStartsCount > hiliteEndsCount)
			shortenedText += global.HILITE_END;
		shortenedText = shortenedText.replace(new RegExp(global.HILITE_START, 'g'), '<i>');
		shortenedText = shortenedText.replace(new RegExp(global.HILITE_END, 'g'), '</i>');
		if (shortenStart > 0)
			shortenedText = '…' + shortenedText;
		if (shortenEnd < textHilited.length)
			shortenedText = shortenedText + '…';
		return shortenedText + '</i>';
	}
	return textHilited;
}

function hilite_en(q, hadith, attrName) {
	var s = hadith[attrName].replace(new RegExp(q, 'gi'), global.HILITE_START + '$&' + global.HILITE_END);
	return s;
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
	return textHilited;
}