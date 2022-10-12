/* jslint node:true, esversion:8 */
'use strict';

const fs = require('fs');
const http = require('sync-request');
const cheerio = require('cheerio');

function getPage(url) {
	return http('GET', url).getBody().toString();
}

function getHadiths(url, page) {
	if (!page)
		page = getPage(url);
	var path = url.split('/');
	var $ = cheerio.load(page);

	var ha = [];
	$('.actualHadithContainer').each(function (_, el) {
		var id = $(el).attr('id');
		var h = {};
		h.bookAlias = path[3];
		h.cNum = clean($('.book_page_number').text());
		var link = $(`#${id} .bottomItems .hadith_permalink .sharelink`).attr('onclick');
		try {
			h.hNum = /([0-9]+.*?)'\)/.exec(link)[1];
		} catch (err) {
		}
		h.hChain = clean($(`#${id} .arabic_sanad:nth-child(1)`).text());
		h.hText = clean($(`#${id} .arabic_text_details`).text());
		h.hFooter = clean($(`#${id} .arabic_sanad:nth-child(2)`).text());
		h.hChain_en = clean($(`#${id} .englishcontainer .hadith_narrated`).text());
		h.hBody_en = clean($(`#${id} .englishcontainer .text_details`).text());
		h.hGrade = clean($(`#${id} .gradetable tr:nth-child(1) td:nth-child(2)`).text());
		ha.push(h);
	});

	return ha;
}

function getChapter(url, page) {
	if (!page)
		page = getPage(url);
	var path = url.split('/');
	var $ = cheerio.load(page);

	var c = {};

	c.bookAlias = path[3];
	c.cNum = clean($('.book_page_number').text());
	c.cName_en = clean($('.book_page_english_name').text());
	c.cName = clean($('.book_page_arabic_name').text());
	c.cIntro_en = clean($('.ebookintro').text());
	c.cIntro = clean($('.abookintro').text());

	c.titles = [];
	var i = 0;
	$('.echapno').each(function (_, el) {
		var t = {};
		t.tIdx = ++i;
		t.tNum = clean($(el).text());
		c.titles.push(t);
	});
	i = 0;
	$('.englishchapter').each(function (_, el) {
		c.titles[i++].tText_en = clean($(el).text());
	});
	i = 0;
	$('.arabicchapter').each(function (_, el) {
		c.titles[i++].tText = clean($(el).text());
	});
	i = 0;
	$('.achapintro').each(function (_, el) {
		var elChapter = $(el).prev();
		if (elChapter && elChapter.attr('class') != undefined) {
			while (!(elChapter.hasClass('chapter') || elChapter.hasClass('surah'))) {
				elChapter = elChapter.prev();
				if (!elChapter)
					throw "prev sibling not found";
			}
			var tNum = clean(elChapter.children().first().text());
			var tText_en = clean(elChapter.children().first().next().text());
			var i = c.titles.findIndex(function (val, i, arr) {
				if (val.tText_en == tText_en && val.tNum == tNum)
					return true;
			});
			c.titles[i].tIntro = clean($(el).text());
		}
	});
	$('.chapter').each(function (_, el) {
		var tNum = clean($(el).children().first().text());
		var tText_en = clean($(el).children().first().next().text());
		var i = c.titles.findIndex(function (val, i, arr) {
			if (val.tText_en == tText_en && val.tNum == tNum)
				return true;
		});
		var elHadith = $(el).next().next();
		if ($(el).next().hasClass('achapintro'))
			elHadith = elHadith.next();
		if (elHadith.hasClass('actualHadithContainer')) {
			var elHadithId = elHadith.attr('id');
			var link = $(`#${elHadithId} .bottomItems .hadith_permalink .sharelink`).attr('onclick');
			c.titles[i].hStartNum = /([0-9]+.*?)'\)/.exec(link)[1];
		}
	});

	return c;
}

function clean(s) {
	if (s)
		s = s.replace(/\u200f/g, '').trim();
	return s;
}

function msleep(n) {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, n);
}

function sleep(n) {
	msleep(n * 1000);
}

var urls = [
	'https://sunnah.com/abudawud/1',
	'https://sunnah.com/abudawud/2',
	'https://sunnah.com/abudawud/3',
	'https://sunnah.com/abudawud/4',
	'https://sunnah.com/abudawud/5',
	'https://sunnah.com/abudawud/6',
	'https://sunnah.com/abudawud/7',
	'https://sunnah.com/abudawud/8',
	'https://sunnah.com/abudawud/9',
	'https://sunnah.com/abudawud/10',
	'https://sunnah.com/abudawud/11',
	'https://sunnah.com/abudawud/12',
	'https://sunnah.com/abudawud/13',
	'https://sunnah.com/abudawud/14',
	'https://sunnah.com/abudawud/15',
	'https://sunnah.com/abudawud/16',
	'https://sunnah.com/abudawud/17',
	'https://sunnah.com/abudawud/18',
	'https://sunnah.com/abudawud/19',
	'https://sunnah.com/abudawud/20',
	'https://sunnah.com/abudawud/21',
	'https://sunnah.com/abudawud/22',
	'https://sunnah.com/abudawud/23',
	'https://sunnah.com/abudawud/24',
	'https://sunnah.com/abudawud/25',
	'https://sunnah.com/abudawud/26',
	'https://sunnah.com/abudawud/27',
	'https://sunnah.com/abudawud/28',
	'https://sunnah.com/abudawud/29',
	'https://sunnah.com/abudawud/30',
	'https://sunnah.com/abudawud/31',
	'https://sunnah.com/abudawud/32',
	'https://sunnah.com/abudawud/33',
	'https://sunnah.com/abudawud/34',
	'https://sunnah.com/abudawud/35',
	'https://sunnah.com/abudawud/36',
	'https://sunnah.com/abudawud/37',
	'https://sunnah.com/abudawud/38',
	'https://sunnah.com/abudawud/39',
	'https://sunnah.com/abudawud/40',
	'https://sunnah.com/abudawud/41',
	'https://sunnah.com/abudawud/42',
	'https://sunnah.com/abudawud/43',
	'https://sunnah.com/bukhari/1',
	'https://sunnah.com/bukhari/2',
	'https://sunnah.com/bukhari/3',
	'https://sunnah.com/bukhari/4',
	'https://sunnah.com/bukhari/5',
	'https://sunnah.com/bukhari/6',
	'https://sunnah.com/bukhari/7',
	'https://sunnah.com/bukhari/8',
	'https://sunnah.com/bukhari/9',
	'https://sunnah.com/bukhari/10',
	'https://sunnah.com/bukhari/11',
	'https://sunnah.com/bukhari/12',
	'https://sunnah.com/bukhari/13',
	'https://sunnah.com/bukhari/14',
	'https://sunnah.com/bukhari/15',
	'https://sunnah.com/bukhari/16',
	'https://sunnah.com/bukhari/17',
	'https://sunnah.com/bukhari/18',
	'https://sunnah.com/bukhari/19',
	'https://sunnah.com/bukhari/20',
	'https://sunnah.com/bukhari/21',
	'https://sunnah.com/bukhari/22',
	'https://sunnah.com/bukhari/23',
	'https://sunnah.com/bukhari/24',
	'https://sunnah.com/bukhari/25',
	'https://sunnah.com/bukhari/26',
	'https://sunnah.com/bukhari/27',
	'https://sunnah.com/bukhari/28',
	'https://sunnah.com/bukhari/29',
	'https://sunnah.com/bukhari/30',
	'https://sunnah.com/bukhari/31',
	'https://sunnah.com/bukhari/32',
	'https://sunnah.com/bukhari/33',
	'https://sunnah.com/bukhari/34',
	'https://sunnah.com/bukhari/35',
	'https://sunnah.com/bukhari/36',
	'https://sunnah.com/bukhari/37',
	'https://sunnah.com/bukhari/38',
	'https://sunnah.com/bukhari/39',
	'https://sunnah.com/bukhari/40',
	'https://sunnah.com/bukhari/41',
	'https://sunnah.com/bukhari/42',
	'https://sunnah.com/bukhari/43',
	'https://sunnah.com/bukhari/44',
	'https://sunnah.com/bukhari/45',
	'https://sunnah.com/bukhari/46',
	'https://sunnah.com/bukhari/47',
	'https://sunnah.com/bukhari/48',
	'https://sunnah.com/bukhari/49',
	'https://sunnah.com/bukhari/50',
	'https://sunnah.com/bukhari/51',
	'https://sunnah.com/bukhari/52',
	'https://sunnah.com/bukhari/53',
	'https://sunnah.com/bukhari/54',
	'https://sunnah.com/bukhari/55',
	'https://sunnah.com/bukhari/56',
	'https://sunnah.com/bukhari/57',
	'https://sunnah.com/bukhari/58',
	'https://sunnah.com/bukhari/59',
	'https://sunnah.com/bukhari/60',
	'https://sunnah.com/bukhari/61',
	'https://sunnah.com/bukhari/62',
	'https://sunnah.com/bukhari/63',
	'https://sunnah.com/bukhari/64',
	'https://sunnah.com/bukhari/65',
	'https://sunnah.com/bukhari/66',
	'https://sunnah.com/bukhari/67',
	'https://sunnah.com/bukhari/68',
	'https://sunnah.com/bukhari/69',
	'https://sunnah.com/bukhari/70',
	'https://sunnah.com/bukhari/71',
	'https://sunnah.com/bukhari/72',
	'https://sunnah.com/bukhari/73',
	'https://sunnah.com/bukhari/74',
	'https://sunnah.com/bukhari/75',
	'https://sunnah.com/bukhari/76',
	'https://sunnah.com/bukhari/77',
	'https://sunnah.com/bukhari/78',
	'https://sunnah.com/bukhari/79',
	'https://sunnah.com/bukhari/80',
	'https://sunnah.com/bukhari/81',
	'https://sunnah.com/bukhari/82',
	'https://sunnah.com/bukhari/83',
	'https://sunnah.com/bukhari/84',
	'https://sunnah.com/bukhari/85',
	'https://sunnah.com/bukhari/86',
	'https://sunnah.com/bukhari/87',
	'https://sunnah.com/bukhari/88',
	'https://sunnah.com/bukhari/89',
	'https://sunnah.com/bukhari/90',
	'https://sunnah.com/bukhari/91',
	'https://sunnah.com/bukhari/92',
	'https://sunnah.com/bukhari/93',
	'https://sunnah.com/bukhari/94',
	'https://sunnah.com/bukhari/95',
	'https://sunnah.com/bukhari/96',
	'https://sunnah.com/bukhari/97',
	'https://sunnah.com/ibnmajah/introduction',
	'https://sunnah.com/ibnmajah/1',
	'https://sunnah.com/ibnmajah/2',
	'https://sunnah.com/ibnmajah/3',
	'https://sunnah.com/ibnmajah/4',
	'https://sunnah.com/ibnmajah/5',
	'https://sunnah.com/ibnmajah/6',
	'https://sunnah.com/ibnmajah/7',
	'https://sunnah.com/ibnmajah/8',
	'https://sunnah.com/ibnmajah/9',
	'https://sunnah.com/ibnmajah/10',
	'https://sunnah.com/ibnmajah/11',
	'https://sunnah.com/ibnmajah/12',
	'https://sunnah.com/ibnmajah/13',
	'https://sunnah.com/ibnmajah/14',
	'https://sunnah.com/ibnmajah/15',
	'https://sunnah.com/ibnmajah/16',
	'https://sunnah.com/ibnmajah/17',
	'https://sunnah.com/ibnmajah/18',
	'https://sunnah.com/ibnmajah/19',
	'https://sunnah.com/ibnmajah/20',
	'https://sunnah.com/ibnmajah/21',
	'https://sunnah.com/ibnmajah/22',
	'https://sunnah.com/ibnmajah/23',
	'https://sunnah.com/ibnmajah/24',
	'https://sunnah.com/ibnmajah/25',
	'https://sunnah.com/ibnmajah/26',
	'https://sunnah.com/ibnmajah/27',
	'https://sunnah.com/ibnmajah/28',
	'https://sunnah.com/ibnmajah/29',
	'https://sunnah.com/ibnmajah/30',
	'https://sunnah.com/ibnmajah/31',
	'https://sunnah.com/ibnmajah/32',
	'https://sunnah.com/ibnmajah/33',
	'https://sunnah.com/ibnmajah/34',
	'https://sunnah.com/ibnmajah/35',
	'https://sunnah.com/ibnmajah/36',
	'https://sunnah.com/ibnmajah/37',
	'https://sunnah.com/muslim/introduction',
	'https://sunnah.com/muslim/1',
	'https://sunnah.com/muslim/2',
	'https://sunnah.com/muslim/3',
	'https://sunnah.com/muslim/4',
	'https://sunnah.com/muslim/5',
	'https://sunnah.com/muslim/6',
	'https://sunnah.com/muslim/7',
	'https://sunnah.com/muslim/8',
	'https://sunnah.com/muslim/9',
	'https://sunnah.com/muslim/10',
	'https://sunnah.com/muslim/11',
	'https://sunnah.com/muslim/12',
	'https://sunnah.com/muslim/13',
	'https://sunnah.com/muslim/14',
	'https://sunnah.com/muslim/15',
	'https://sunnah.com/muslim/16',
	'https://sunnah.com/muslim/17',
	'https://sunnah.com/muslim/18',
	'https://sunnah.com/muslim/19',
	'https://sunnah.com/muslim/20',
	'https://sunnah.com/muslim/21',
	'https://sunnah.com/muslim/22',
	'https://sunnah.com/muslim/23',
	'https://sunnah.com/muslim/24',
	'https://sunnah.com/muslim/25',
	'https://sunnah.com/muslim/26',
	'https://sunnah.com/muslim/27',
	'https://sunnah.com/muslim/28',
	'https://sunnah.com/muslim/29',
	'https://sunnah.com/muslim/30',
	'https://sunnah.com/muslim/31',
	'https://sunnah.com/muslim/32',
	'https://sunnah.com/muslim/33',
	'https://sunnah.com/muslim/34',
	'https://sunnah.com/muslim/35',
	'https://sunnah.com/muslim/36',
	'https://sunnah.com/muslim/37',
	'https://sunnah.com/muslim/38',
	'https://sunnah.com/muslim/39',
	'https://sunnah.com/muslim/40',
	'https://sunnah.com/muslim/41',
	'https://sunnah.com/muslim/42',
	'https://sunnah.com/muslim/43',
	'https://sunnah.com/muslim/44',
	'https://sunnah.com/muslim/45',
	'https://sunnah.com/muslim/46',
	'https://sunnah.com/muslim/47',
	'https://sunnah.com/muslim/48',
	'https://sunnah.com/muslim/49',
	'https://sunnah.com/muslim/50',
	'https://sunnah.com/muslim/52',
	'https://sunnah.com/muslim/53',
	'https://sunnah.com/muslim/54',
	'https://sunnah.com/muslim/55',
	'https://sunnah.com/muslim/56',
	'https://sunnah.com/nasai/1',
	'https://sunnah.com/nasai/2',
	'https://sunnah.com/nasai/3',
	'https://sunnah.com/nasai/4',
	'https://sunnah.com/nasai/5',
	'https://sunnah.com/nasai/6',
	'https://sunnah.com/nasai/7',
	'https://sunnah.com/nasai/8',
	'https://sunnah.com/nasai/9',
	'https://sunnah.com/nasai/10',
	'https://sunnah.com/nasai/11',
	'https://sunnah.com/nasai/12',
	'https://sunnah.com/nasai/13',
	'https://sunnah.com/nasai/14',
	'https://sunnah.com/nasai/15',
	'https://sunnah.com/nasai/16',
	'https://sunnah.com/nasai/17',
	'https://sunnah.com/nasai/18',
	'https://sunnah.com/nasai/19',
	'https://sunnah.com/nasai/20',
	'https://sunnah.com/nasai/21',
	'https://sunnah.com/nasai/22',
	'https://sunnah.com/nasai/23',
	'https://sunnah.com/nasai/24',
	'https://sunnah.com/nasai/25',
	'https://sunnah.com/nasai/26',
	'https://sunnah.com/nasai/27',
	'https://sunnah.com/nasai/28',
	'https://sunnah.com/nasai/29',
	'https://sunnah.com/nasai/30',
	'https://sunnah.com/nasai/31',
	'https://sunnah.com/nasai/32',
	'https://sunnah.com/nasai/33',
	'https://sunnah.com/nasai/34',
	'https://sunnah.com/nasai/35',
	'https://sunnah.com/nasai/35b',
	'https://sunnah.com/nasai/36',
	'https://sunnah.com/nasai/37',
	'https://sunnah.com/nasai/38',
	'https://sunnah.com/nasai/39',
	'https://sunnah.com/nasai/40',
	'https://sunnah.com/nasai/41',
	'https://sunnah.com/nasai/42',
	'https://sunnah.com/nasai/43',
	'https://sunnah.com/nasai/44',
	'https://sunnah.com/nasai/45',
	'https://sunnah.com/nasai/46',
	'https://sunnah.com/nasai/47',
	'https://sunnah.com/nasai/48',
	'https://sunnah.com/nasai/49',
	'https://sunnah.com/nasai/50',
	'https://sunnah.com/nasai/51',
	'https://sunnah.com/tirmidhi/1',
	'https://sunnah.com/tirmidhi/2',
	'https://sunnah.com/tirmidhi/3',
	'https://sunnah.com/tirmidhi/4',
	'https://sunnah.com/tirmidhi/5',
	'https://sunnah.com/tirmidhi/6',
	'https://sunnah.com/tirmidhi/7',
	'https://sunnah.com/tirmidhi/8',
	'https://sunnah.com/tirmidhi/9',
	'https://sunnah.com/tirmidhi/10',
	'https://sunnah.com/tirmidhi/11',
	'https://sunnah.com/tirmidhi/12',
	'https://sunnah.com/tirmidhi/13',
	'https://sunnah.com/tirmidhi/14',
	'https://sunnah.com/tirmidhi/15',
	'https://sunnah.com/tirmidhi/16',
	'https://sunnah.com/tirmidhi/17',
	'https://sunnah.com/tirmidhi/18',
	'https://sunnah.com/tirmidhi/19',
	'https://sunnah.com/tirmidhi/20',
	'https://sunnah.com/tirmidhi/21',
	'https://sunnah.com/tirmidhi/22',
	'https://sunnah.com/tirmidhi/23',
	'https://sunnah.com/tirmidhi/24',
	'https://sunnah.com/tirmidhi/25',
	'https://sunnah.com/tirmidhi/26',
	'https://sunnah.com/tirmidhi/27',
	'https://sunnah.com/tirmidhi/28',
	'https://sunnah.com/tirmidhi/29',
	'https://sunnah.com/tirmidhi/30',
	'https://sunnah.com/tirmidhi/31',
	'https://sunnah.com/tirmidhi/32',
	'https://sunnah.com/tirmidhi/33',
	'https://sunnah.com/tirmidhi/34',
	'https://sunnah.com/tirmidhi/35',
	'https://sunnah.com/tirmidhi/36',
	'https://sunnah.com/tirmidhi/37',
	'https://sunnah.com/tirmidhi/38',
	'https://sunnah.com/tirmidhi/39',
	'https://sunnah.com/tirmidhi/40',
	'https://sunnah.com/tirmidhi/41',
	'https://sunnah.com/tirmidhi/42',
	'https://sunnah.com/tirmidhi/43',
	'https://sunnah.com/tirmidhi/44',
	'https://sunnah.com/tirmidhi/45',
	'https://sunnah.com/tirmidhi/46',
	'https://sunnah.com/tirmidhi/47',
	'https://sunnah.com/tirmidhi/48',
	'https://sunnah.com/tirmidhi/49',
	'https://sunnah.com/malik/1',
	'https://sunnah.com/malik/2',
	'https://sunnah.com/malik/3',
	'https://sunnah.com/malik/4',
	'https://sunnah.com/malik/5',
	'https://sunnah.com/malik/6',
	'https://sunnah.com/malik/7',
	'https://sunnah.com/malik/8',
	'https://sunnah.com/malik/9',
	'https://sunnah.com/malik/10',
	'https://sunnah.com/malik/11',
	'https://sunnah.com/malik/12',
	'https://sunnah.com/malik/13',
	'https://sunnah.com/malik/14',
	'https://sunnah.com/malik/15',
	'https://sunnah.com/malik/16',
	'https://sunnah.com/malik/17',
	'https://sunnah.com/malik/18',
	'https://sunnah.com/malik/19',
	'https://sunnah.com/malik/20',
	'https://sunnah.com/malik/21',
	'https://sunnah.com/malik/22',
	'https://sunnah.com/malik/23',
	'https://sunnah.com/malik/24',
	'https://sunnah.com/malik/25',
	'https://sunnah.com/malik/26',
	'https://sunnah.com/malik/27',
	'https://sunnah.com/malik/28',
	'https://sunnah.com/malik/29',
	'https://sunnah.com/malik/30',
	'https://sunnah.com/malik/31',
	'https://sunnah.com/malik/32',
	'https://sunnah.com/malik/33',
	'https://sunnah.com/malik/34',
	'https://sunnah.com/malik/35',
	'https://sunnah.com/malik/36',
	'https://sunnah.com/malik/37',
	'https://sunnah.com/malik/38',
	'https://sunnah.com/malik/39',
	'https://sunnah.com/malik/40',
	'https://sunnah.com/malik/41',
	'https://sunnah.com/malik/42',
	'https://sunnah.com/malik/43',
	'https://sunnah.com/malik/44',
	'https://sunnah.com/malik/45',
	'https://sunnah.com/malik/46',
	'https://sunnah.com/malik/47',
	'https://sunnah.com/malik/48',
	'https://sunnah.com/malik/49',
	'https://sunnah.com/malik/50',
	'https://sunnah.com/malik/51',
	'https://sunnah.com/malik/52',
	'https://sunnah.com/malik/53',
	'https://sunnah.com/malik/54',
	'https://sunnah.com/malik/55',
	'https://sunnah.com/malik/56',
	'https://sunnah.com/malik/57',
	'https://sunnah.com/malik/58',
	'https://sunnah.com/malik/59',
	'https://sunnah.com/malik/60',
	'https://sunnah.com/malik/61',
	'https://sunnah.com/ahmad/1',
	'https://sunnah.com/ahmad/2',
	'https://sunnah.com/ahmad/3',
	'https://sunnah.com/ahmad/4',
	'https://sunnah.com/ahmad/5',
	'https://sunnah.com/ahmad/6',
	'https://sunnah.com/ahmad/7'
];

// var chapters = [];
// for (var i = 0; i < urls.length; i++) {
// 	if (i >= 0) sleep(1);
// 	console.log(urls[i]);
// 	chapters.push(getChapter(urls[i]));
// }
// fs.writeFileSync('data/sunnah-toc.json', JSON.stringify(chapters, null, 4));

var hadiths = [];
for (var i = 0; i < urls.length; i++) {
	console.log(urls[i]);
	try {
		hadiths.push(getHadiths(urls[i]));
	} catch (err) {
		console.log(err);
		break;
	}
}
fs.writeFileSync(`data/sunnah-hadiths.json`, JSON.stringify(hadiths, null, 4));

// fs.writeFileSync('data/c.json', JSON.stringify(getChapter('https://sunnah.com/bukhari/65'), null, 4));
// fs.writeFileSync('data/sunnah-hadiths.json', JSON.stringify(getHadiths('https://sunnah.com/tirmidhi/33'), null, 4));
