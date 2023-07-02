/* jslint node:true, esversion:8 */
'use strict';

const http = require('sync-request');
const cheerio = require('cheerio');
const Utils = require('../../lib/Utils');

const flag_insertHeadings = true;

const book = {
	id: 7,
	alias: 'malik',
	pages: 61,
	url: 'https://www.iium.edu.my/deed/hadith/malik/###_mmt.html'
}

var h1 = 0;
var h2 = null;
var numInChapter = 1;

function parsePage(book, url, page) {
	if (!page)
		page = getPage(url);
	var $ = cheerio.load(page);
	var headings = [];
	$('h1, h3').each(function () {
		console.log($(this).text());
	});
}

function getPage(url) {
	console.error(url);
	return http('GET', url).getBody().toString();
}

for (var i = 0; i < book.pages; i++) {
	parsePage(book, book.url.replace(/###/, ('' + (i + 1)).padStart(3, '0')));
	Utils.msleep(500);
}
