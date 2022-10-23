/* jslint node:true, esversion:8 */
'use strict';

const Hadith = require('../lib/Hadith');
const SearchResult = require('../lib/SearchResult');
const Arabic = require('../lib/Arabic');

global.HILITE_START = '❮';
global.HILITE_END = '❯';
global.PROXIMITY = 100;
global.SURROUND_LENGTH = 200;

class Search {

	static async a_getRandom() {
		try {
			var results = await global.query(`
				SELECT * FROM hadiths AS t1 
				JOIN (SELECT id FROM hadiths WHERE remark = 0 ORDER BY RAND() LIMIT 1)
				AS t2 ON t1.id=t2.id;
			`);
			var hadith = new Hadith(results[0]);
			await Hadith.a_dbHadithInit(hadith);
			return hadith;
		} catch (err) {
			console.error(`Search broke on random lookup ${err.stack}`);
			throw err;
		}
	}

	static async a_lookupByRef(bookAlias, num) {
		try {
			var results = [];
			var book = global.books.find(function (value) {
				return (value.alias == bookAlias || value.id == bookAlias);
			});
			if (book) {
				var reNum = '^' + num + '([^0-9]|$)';
				var sql = `
				SELECT * FROM hadiths
				WHERE
					bookId = ${book.id}
				AND REGEXP_LIKE(num, "${reNum}", "i")
				`;
				var hadiths = await global.query(sql);
				for (var i = 0; i < hadiths.length; i++) {
					var hadith = new Hadith(hadiths[i]);
					await Hadith.a_dbHadithInit(hadith);
					results.push(hadith);
				}
			}
			return results;
		} catch (err) {
			console.error(`Search broke on lookupByRef for Ref [${bookAlias}:${num}]\n${err.stack}`);
			throw err;
		}
	}

	static async a_searchText(qs) {
		if (qs.match(/[a-z]/))
			return a_search(toQueryPattern(qs), 'en');
		else
			return a_search(toQueryPattern(qs), 'ar');
	}

}

module.exports = Search;

/*
 * Private methods
 */

function toQueryPattern(s) {
	s = Arabic.removeArabicDiacritics(s);
	s = s.replace(/[اءأآإ]/g, '[اءأآإ]');
	s = s.replace(/[يىئ]/g, '[يىئ]');
	s = s.replace(/[ؤو]/g, '[ؤو]');
	s = s.replace(/[`\'ʾʿ]/g, '[`\'ʾʿ]?');
	s = s.replace(/[āá]/gi, '([aāá]|aa)');
	s = s.replace(/ī/gi, '([iī]|ee)');
	s = s.replace(/ū/gi, '([uū]|oo|uu)');
	s = s.replace(/ḥ/gi, '[hḥ]');
	s = s.replace(/ṣ/gi, '[sṣ]');
	s = s.replace(/ḍ/gi, '[dḍ]');
	s = s.replace(/ṭ/gi, '[tṭ]');
	s = s.replace(/ẓ/gi, '[zẓ]');
	return s;
}

async function a_search(qs, lang) {
	var results = [];

	// search exact
	var q = new RegExp('(' + qs + ')', 'ig');
	results = results.concat(await a_searchQ(q, lang, 'exact'));

	// search proximity
	var proxmity = global.PROXIMITY;
	if (lang == 'ar') proxmity *= 2;
	var prevq = q;
	var qt = qs.split(/[\s\-\_\,\.\']+/);
	q = '';
	for (var i = 0; i < qt.length; i++) {
		q += `(${qt[i]})`;
		if (i < qt.length - 1) q += `.{0,${proxmity}}`;
	}
	q = new RegExp('(' + q + ')', 'ig');
	if (prevq != q) {
		results = results.concat((await a_searchQ(q, lang, 'prox')).filter(function (value) {
			var add = true;
			for (var i = 0; i < results.length; i++) {
				if (results[i].bookId == value.bookId && results[i].num == value.num) {
					add = false;
					break;
				}
			}
			return add;
		}));
	}
	if (qt.length > 2) {
		for (var z = 0; z <= qt.length; z++) {
			var qz = [...qt];
			qz.splice(z, 1);
			q = '';
			for (var i = 0; i < qz.length; i++) {
				q += `(${qz[i]})`;
				if (i < qz.length - 1) q += `.{0,${proxmity}}`;
			}
			q = new RegExp('(' + q + ')', 'ig');
			if (prevq != q) {
				results = results.concat((await a_searchQ(q, lang, 'prox')).filter(function (value) {
					var add = true;
					for (var i = 0; i < results.length; i++) {
						if (results[i].bookId == value.bookId && results[i].num == value.num) {
							add = false;
							break;
						}
					}
					return add;
				}));
			}
		}
	}

	if (results.length == 0) {
		// search any word
		prevq = q;
		qt = qs.split(/[\s\-\_\,\.\']+/);
		q = '';
		for (var i = 0; i < qt.length; i++) {
			if (i > 0) q += `.{0,${proxmity}}`;
			q += '(';
			for (var j = 0; j < qt.length; j++) {
				q += qt[j];
				if (j < qt.length - 1)
					q += '|';
			}
			q += ')';
		}
		q = new RegExp('(' + q + ')', 'ig');
		if (prevq != q) {
			results = results.concat((await a_searchQ(q, lang, 'any')).filter(function (value) {
				var add = true;
				for (var i = 0; i < results.length; i++) {
					if (results[i].bookId == value.bookId && results[i].num == value.num) {
						add = false;
						break;
					}
				}
				return add;
			}));
		}
	}

	return results;
}

async function a_searchQ(q, lang, matchType) {
	var sqlre = (q + '').replace(/^\//, '').replace(/\/gi/, '');
	var sql = '';
	if (lang == 'ar')
		sql = `
			SELECT * FROM hadiths 
			WHERE
				REGEXP_LIKE(search_chain, "${sqlre}", "i")
			 OR REGEXP_LIKE(search_body, "${sqlre}", "i")
		`;
	else if (lang == 'en')
		sql = `
			SELECT * FROM hadiths 
			WHERE
				REGEXP_LIKE(chain_en, "${sqlre}", "i")
			 OR REGEXP_LIKE(body_en, "${sqlre}", "i")
		`;
	var hadiths = await global.query(sql);
	var results = [];
	for (var i = 0; i < hadiths.length; i++) {
		var hadith = hadiths[i];
		try {
			var matches = [];
			if (results.length > 500)
				break;
			if (lang == 'en') {
				if (hadith.body_en && hadith.body_en.match(q))
					matches.push({ body_en: hilite(q, hadith, 'body_en', lang) });
				if (hadith.chain_en && hadith.chain_en.match(q))
					matches.push({ body_en: hilite(q, hadith, 'chain_en', lang) });
			} else if (lang == 'ar') {
				if (hadith.search_body && hadith.search_body.match(q))
					matches.push({ body: hilite(q, hadith, 'body', lang) });
				if (hadith.search_chain && hadith.search_chain.match(q))
					matches.push({ chain: hilite(q, hadith, 'chain', lang) });
			}
			if (matches.length > 0)
				results.push(new SearchResult(hadith, matches, matchType));
		} catch (err) {
			console.error(`Search broke on Hadith ${hadith.bookId}:${hadith.num} for Query [${q}]\n${err.stack}`);
			throw err;
		}
	}
	return results;
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
		return shortenedText;
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
