/* jslint node:true, esversion:6 */
'use strict';

const Hadith = require('../lib/Hadith');
const SearchResult = require('../lib/SearchResult');
const Database = require('better-sqlite3');
const AdmZip = require("adm-zip");

global.HILITE_START = '❮';
global.HILITE_END = '❯';
global.PROXIMITY = 200;
global.SURROUND_LENGTH = 200;

class Search {

	static getRandom() {
		try {
			var i = Math.floor(Math.random() * (global.hadiths.length - 1));
			return new Hadith(global.hadiths[i]);
		} catch (err) {
			console.error(`Search broke on lookupByRef for Ref [${q}]\n${err.stack}`);
			throw err;
		}
	}

	static lookupByRef(q) {
		try {
			var results = [];
			var toks = q.split(/:/);
			var book = null;
			var bookRef = '';
			var num = '';
			var reNum;
			var i = 0;
			if (toks.length == 2) {
				bookRef = toks[0];
				num = toks[1];
				book = global.books.find(function (value) {
					return (value.alias == bookRef || value.id == bookRef);
				});
				if (book) {
					reNum = new RegExp('^' + num + '([^0-9]|$)', 'i');
					for (i = 0; i < global.hadiths.length; i++) {
						if (global.hadiths[i].bookId == book.id && global.hadiths[i].num.match(reNum))
							results.push(new Hadith(global.hadiths[i]));
					}
				}
			} else {
				num = toks[0];
				reNum = new RegExp('^' + num + '([^0-9]|$)', 'i');
				for (i = 0; i < global.hadiths.length; i++) {
					if (global.hadiths[i].num.match(reNum))
						results.push(new Hadith(global.hadiths[i]));
				}
			}
			return results;
		} catch (err) {
			console.error(`Search broke on lookupByRef for Ref [${q}]\n${err.stack}`);
			throw err;
		}
	}

	static removeDiacritics(s) {
		return s.replace(/[\u064B\u064C\u064D\u064E\u064F\u0650\u0651\u0652\u0670]+/g, '');
	}

	static searchText(qs) {
		if (qs.match(/[a-z]/))
			return search(toQueryPattern(qs), 'en');
		else
			return search(toQueryPattern(qs), 'ar');
	}

}

module.exports = Search;

/*
 * Private methods
 */

// load data
const dbFile = __dirname + '/../data/hadiths.db.zip';
var zip = new AdmZip(dbFile);
var sqlite = new Database(zip.readFile(zip.getEntries()[0]));
global.books = sqlite.prepare('SELECT * from books').all();
global.hadiths = sqlite.prepare('SELECT bookId,num,lastmod,grade,chain_en,body_en,chain,body from hadiths').all();
for (var i = 0; i < global.hadiths.length; i++) {
	var hadith = global.hadiths[i];
	hadith.rowNum = i;
	hadith.num = (hadith.num + '').replace(/ /g, '');
	hadith.search_chain = Search.removeDiacritics(hadith.chain);
	hadith.search_body = Search.removeDiacritics(hadith.body);
}
sqlite.close();
sqlite = null;

function toQueryPattern(s) {
	s = Search.removeDiacritics(s);
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

function search(qs, lang) {
	var results = [];
	// search exact
	var q = new RegExp('(' + qs + ')', 'ig');
	results = results.concat(searchQ(q, lang));
	// search proximity
	var proxmity = global.PROXIMITY;
	if (lang == 'ar') proxmity *= 2;
	var prevq = q;
	var qt = qs.split(/[\s\-\_\,\.\']+/);
	q = '';
	for (var i = 0; i < qt.length; i++) {
		q += qt[i];
		if (i < qt.length - 1) q += `.{0,${proxmity}}`;
	}
	q = new RegExp('(' + q + ')', 'ig');
	if (prevq != q) {
		results = results.concat(searchQ(q, lang).filter(function (value) {
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
	// search either or
	prevq = q;
	qt = qs.split(/[\s\-\_\,\.\']+/);
	q = '';
	for (i = 0; i < qt.length; i++) {
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
		results = results.concat(searchQ(q, lang).filter(function (value) {
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

	return results;
}

function searchQ(q, lang) {
	var results = [];
	for (var i = 0; i < global.hadiths.length; i++) {
		var hadith = global.hadiths[i];
		try {
			var matches = [];
			if (results.length > 1500)
				break;
			if (lang == 'en') {
				if (hadith.body_en && hadith.body_en.match(q))
					matches.push({ body_en: hilite(q, hadith, 'body_en', lang) });
				if (hadith.chain_en && hadith.chain_en.match(q))
					matches.push({ body_en: hilite(q, hadith, 'chain_en', lang) });
			} else if (lang == 'ar') {
				if (hadith.search_body.match(q))
					matches.push({ body: hilite(q, hadith, 'body', lang) });
				if (hadith.search_chain.match(q))
					matches.push({ chain: hilite(q, hadith, 'chain', lang) });
			}
			if (matches.length > 0)
				results.push(new SearchResult(hadith, matches));
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
