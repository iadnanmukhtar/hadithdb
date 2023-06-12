/* jslint node:true, esversion:8 */
'use strict';

const http = require('sync-request');
const cheerio = require('cheerio');

const flag_insertHeadings = true;

const book = {
	id: 7,
	alias: 'malik',
	pages: 75,
	url: 'http://www.al-eman.com/%D8%A7%D9%84%D9%83%D8%AA%D8%A8/%D9%85%D9%88%D8%B7%D8%A3%20%D9%85%D8%A7%D9%84%D9%83%20**/i5'
}

var h1 = 0;
var h2 = null;
var numInChapter = 1;

function parsePage(book, url, page) {
	if (!page)
		page = getPage(url);
	var $ = cheerio.load(page);
	var headings = [];
	$('#page_content bdo').children().each(function () {
		var $heading = $(this).find('font');
		if ($heading.length > 0 && !/15[0-9]{2}/.test($(this).text())) {
			var content = $heading.first().text().trim();
			var n = extract(content, /(\d+)/);
			var title = extract(content, /\d+ - (.+)/);
			var level = 0;
			if (title.startsWith('كتاب')) {
				h1 = n;
				level = 1;
				numInChapter = 1;
			} else if (title.startsWith('باب')) {
				h2 = n;
				level = 2;
			}
			var heading = {};
			heading.bookId = book.id;
			heading.level = level;
			heading.h1 = h1;
			heading.h2 = h2;
			heading.h3 = null;
			heading.title_en = null;
			heading.title = clean(title);
			heading.intro_en = null;
			heading.intro = null;
			heading.start = null;
			heading.end = null;
			heading.start0 = -1;
			heading.end0 = -1;
			headings.push(heading);
		} else {
			var content = $(this).text().trim();
			var n = extract(content, /(\d+)/);
			if (n) {
				var text = extract(content, /\d+\s*-\s*(.+)/);
				var hadith = {};
				hadith.bookId = book.id;
				hadith.h1 = h1;
				hadith.h2 = h2;
				hadith.h3 = null;
				hadith.numActual = n;
				hadith.numInChapter = numInChapter;
				hadith.gradeText = null;
				hadith.num = clean(n);
				hadith.num0 = n;
				hadith.chain_en = null;
				hadith.chain = null;
				hadith.body_en = null;
				hadith.footnote_en = null;
				hadith.footnote = null;
				hadith.text_en = null;
				hadith.text = clean(text);
				hadith.chain = null;
				hadith.body = clean(text);
				if (book.id == 7) {
					hadith.num = clean(`${h1}-${numInChapter}`);
					hadith.num0 = h1 + (numInChapter) / 1000.;
				}
				insertHadith(hadith);
				numInChapter++;
				if (headings.length > 0) {
					for (var i = 0; i < headings.length; i++) {
						headings[i].start = hadith.num;
						headings[i].start0 = hadith.num0;
						insertHeading(headings[i]);
					}
					headings = [];
				}
			}
		}
	});
}

function insertHeading(heading) {
	if (flag_insertHeadings) {
		console.log(sql(`
	INSERT INTO toc_${book.alias}
		(bookId, level, h1, h2, h3, title_en, title, 
			intro_en, intro, start, start0)
	VALUES (
		${heading.bookId}, ${heading.level}, ${heading.h1}, ${heading.h2}, ${heading.h3}, ${heading.title_en}, ${heading.title},
			${heading.intro_en}, ${heading.intro}, ${heading.start}, ${heading.start0}
		);
	`));
	}
}

function insertHadith(hadith) {
	console.log(sql(`
	INSERT INTO hadiths_${book.alias}
		(bookId, h1, h2, h3, num, num0, numActual, numInChapter, gradeText,
			chain_en, chain, body_en, body, footnote_en, footnote, text_en, text, lastmod)
	VALUES (
		${hadith.bookId}, ${hadith.h1}, ${hadith.h2}, ${hadith.h3}, ${hadith.num}, ${hadith.num0}, ${hadith.numActual}, ${hadith.numInChapter}, ${hadith.gradeText},
			${hadith.chain_en}, ${hadith.chain}, ${hadith.body_en}, ${hadith.body}, ${hadith.footnote_en}, ${hadith.footnote}, ${hadith.text_en}, ${hadith.text},
			STR_TO_DATE("1970-01-01 00:00:00", "%Y-%m-%d %H:%i:%s")
		);
	`));
}

function getPage(url) {
	console.error(url);
	return http('GET', url).getBody().toString();
}

function clean(s) {
	if (s) {
		s = s + '';
		s = s.replace(/\u200f/g, '').trim();
		s = s.replace(/\"/g, '\\"').replace(/\'/g, "\\'").replace(/‘/g, "\\‘");
		s = s.replace(/^Chapter\s*:\s*/, '');
		return '"' + s + '"';
	}
	return null;
}

function emptyIfNull(s) {
	if (!s) s = '';
	return s;
}

function sql(s) {
	return s.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
}

function extract(s, re) {
	var arr = re.exec(s);
	if (arr)
		return arr[1];
	return null;
}

function sleep(n) {
	msleep(n * 1000);
}

function msleep(n) {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, n);
}

for (var i = 0; i < book.pages; i++) {
	parsePage(book, book.url + '&n' + (i + 1) + '&p1');
}
