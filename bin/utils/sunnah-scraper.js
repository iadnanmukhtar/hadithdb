/* jslint node:true, esversion:8 */
'use strict';

const http = require('sync-request');
const cheerio = require('cheerio');

const urls = [
	// 'https://sunnah.com/abudawud/1',
	// 'https://sunnah.com/abudawud/2',
	// 'https://sunnah.com/abudawud/3',
	// 'https://sunnah.com/abudawud/4',
	// 'https://sunnah.com/abudawud/5',
	// 'https://sunnah.com/abudawud/6',
	// 'https://sunnah.com/abudawud/7',
	// 'https://sunnah.com/abudawud/8',
	// 'https://sunnah.com/abudawud/9',
	// 'https://sunnah.com/abudawud/10',
	// 'https://sunnah.com/abudawud/11',
	// 'https://sunnah.com/abudawud/12',
	// 'https://sunnah.com/abudawud/13',
	// 'https://sunnah.com/abudawud/14',
	// 'https://sunnah.com/abudawud/15',
	// 'https://sunnah.com/abudawud/16',
	// 'https://sunnah.com/abudawud/17',
	// 'https://sunnah.com/abudawud/18',
	// 'https://sunnah.com/abudawud/19',
	// 'https://sunnah.com/abudawud/20',
	// 'https://sunnah.com/abudawud/21',
	// 'https://sunnah.com/abudawud/22',
	// 'https://sunnah.com/abudawud/23',
	// 'https://sunnah.com/abudawud/24',
	// 'https://sunnah.com/abudawud/25',
	// 'https://sunnah.com/abudawud/26',
	// 'https://sunnah.com/abudawud/27',
	// 'https://sunnah.com/abudawud/28',
	// 'https://sunnah.com/abudawud/29',
	// 'https://sunnah.com/abudawud/30',
	// 'https://sunnah.com/abudawud/31',
	// 'https://sunnah.com/abudawud/32',
	// 'https://sunnah.com/abudawud/33',
	// 'https://sunnah.com/abudawud/34',
	// 'https://sunnah.com/abudawud/35',
	// 'https://sunnah.com/abudawud/36',
	// 'https://sunnah.com/abudawud/37',
	// 'https://sunnah.com/abudawud/38',
	// 'https://sunnah.com/abudawud/39',
	// 'https://sunnah.com/abudawud/40',
	// 'https://sunnah.com/abudawud/41',
	// 'https://sunnah.com/abudawud/42',
	// 'https://sunnah.com/abudawud/43',
	// 'https://sunnah.com/bukhari/1',
	// 'https://sunnah.com/bukhari/2',
	// 'https://sunnah.com/bukhari/3',
	// 'https://sunnah.com/bukhari/4',
	// 'https://sunnah.com/bukhari/5',
	// 'https://sunnah.com/bukhari/6',
	// 'https://sunnah.com/bukhari/7',
	// 'https://sunnah.com/bukhari/8',
	// 'https://sunnah.com/bukhari/9',
	// 'https://sunnah.com/bukhari/10',
	// 'https://sunnah.com/bukhari/11',
	// 'https://sunnah.com/bukhari/12',
	// 'https://sunnah.com/bukhari/13',
	// 'https://sunnah.com/bukhari/14',
	// 'https://sunnah.com/bukhari/15',
	// 'https://sunnah.com/bukhari/16',
	// 'https://sunnah.com/bukhari/17',
	// 'https://sunnah.com/bukhari/18',
	// 'https://sunnah.com/bukhari/19',
	// 'https://sunnah.com/bukhari/20',
	// 'https://sunnah.com/bukhari/21',
	// 'https://sunnah.com/bukhari/22',
	// 'https://sunnah.com/bukhari/23',
	// 'https://sunnah.com/bukhari/24',
	// 'https://sunnah.com/bukhari/25',
	// 'https://sunnah.com/bukhari/26',
	// 'https://sunnah.com/bukhari/27',
	// 'https://sunnah.com/bukhari/28',
	// 'https://sunnah.com/bukhari/29',
	// 'https://sunnah.com/bukhari/30',
	// 'https://sunnah.com/bukhari/31',
	// 'https://sunnah.com/bukhari/32',
	// 'https://sunnah.com/bukhari/33',
	// 'https://sunnah.com/bukhari/34',
	// 'https://sunnah.com/bukhari/35',
	// 'https://sunnah.com/bukhari/36',
	// 'https://sunnah.com/bukhari/37',
	// 'https://sunnah.com/bukhari/38',
	// 'https://sunnah.com/bukhari/39',
	// 'https://sunnah.com/bukhari/40',
	// 'https://sunnah.com/bukhari/41',
	// 'https://sunnah.com/bukhari/42',
	// 'https://sunnah.com/bukhari/43',
	// 'https://sunnah.com/bukhari/44',
	// 'https://sunnah.com/bukhari/45',
	// 'https://sunnah.com/bukhari/46',
	// 'https://sunnah.com/bukhari/47',
	// 'https://sunnah.com/bukhari/48',
	// 'https://sunnah.com/bukhari/49',
	// 'https://sunnah.com/bukhari/50',
	// 'https://sunnah.com/bukhari/51',
	// 'https://sunnah.com/bukhari/52',
	// 'https://sunnah.com/bukhari/53',
	// 'https://sunnah.com/bukhari/54',
	// 'https://sunnah.com/bukhari/55',
	// 'https://sunnah.com/bukhari/56',
	// 'https://sunnah.com/bukhari/57',
	// 'https://sunnah.com/bukhari/58',
	// 'https://sunnah.com/bukhari/59',
	// 'https://sunnah.com/bukhari/60',
	// 'https://sunnah.com/bukhari/61',
	// 'https://sunnah.com/bukhari/62',
	// 'https://sunnah.com/bukhari/63',
	// 'https://sunnah.com/bukhari/64',
	// 'https://sunnah.com/bukhari/65',
	// 'https://sunnah.com/bukhari/66',
	// 'https://sunnah.com/bukhari/67',
	// 'https://sunnah.com/bukhari/68',
	// 'https://sunnah.com/bukhari/69',
	// 'https://sunnah.com/bukhari/70',
	// 'https://sunnah.com/bukhari/71',
	// 'https://sunnah.com/bukhari/72',
	// 'https://sunnah.com/bukhari/73',
	// 'https://sunnah.com/bukhari/74',
	// 'https://sunnah.com/bukhari/75',
	// 'https://sunnah.com/bukhari/76',
	// 'https://sunnah.com/bukhari/77',
	// 'https://sunnah.com/bukhari/78',
	// 'https://sunnah.com/bukhari/79',
	// 'https://sunnah.com/bukhari/80',
	// 'https://sunnah.com/bukhari/81',
	// 'https://sunnah.com/bukhari/82',
	// 'https://sunnah.com/bukhari/83',
	// 'https://sunnah.com/bukhari/84',
	// 'https://sunnah.com/bukhari/85',
	// 'https://sunnah.com/bukhari/86',
	// 'https://sunnah.com/bukhari/87',
	// 'https://sunnah.com/bukhari/88',
	// 'https://sunnah.com/bukhari/89',
	// 'https://sunnah.com/bukhari/90',
	// 'https://sunnah.com/bukhari/91',
	// 'https://sunnah.com/bukhari/92',
	// 'https://sunnah.com/bukhari/93',
	// 'https://sunnah.com/bukhari/94',
	// 'https://sunnah.com/bukhari/95',
	// 'https://sunnah.com/bukhari/96',
	// 'https://sunnah.com/bukhari/97',
	// 'https://sunnah.com/ibnmajah/introduction',
	// 'https://sunnah.com/ibnmajah/1',
	// 'https://sunnah.com/ibnmajah/2',
	// 'https://sunnah.com/ibnmajah/3',
	// 'https://sunnah.com/ibnmajah/4',
	// 'https://sunnah.com/ibnmajah/5',
	// 'https://sunnah.com/ibnmajah/6',
	// 'https://sunnah.com/ibnmajah/7',
	// 'https://sunnah.com/ibnmajah/8',
	// 'https://sunnah.com/ibnmajah/9',
	// 'https://sunnah.com/ibnmajah/10',
	// 'https://sunnah.com/ibnmajah/11',
	// 'https://sunnah.com/ibnmajah/12',
	// 'https://sunnah.com/ibnmajah/13',
	// 'https://sunnah.com/ibnmajah/14',
	// 'https://sunnah.com/ibnmajah/15',
	// 'https://sunnah.com/ibnmajah/16',
	// 'https://sunnah.com/ibnmajah/17',
	// 'https://sunnah.com/ibnmajah/18',
	// 'https://sunnah.com/ibnmajah/19',
	// 'https://sunnah.com/ibnmajah/20',
	// 'https://sunnah.com/ibnmajah/21',
	// 'https://sunnah.com/ibnmajah/22',
	// 'https://sunnah.com/ibnmajah/23',
	// 'https://sunnah.com/ibnmajah/24',
	// 'https://sunnah.com/ibnmajah/25',
	// 'https://sunnah.com/ibnmajah/26',
	// 'https://sunnah.com/ibnmajah/27',
	// 'https://sunnah.com/ibnmajah/28',
	// 'https://sunnah.com/ibnmajah/29',
	// 'https://sunnah.com/ibnmajah/30',
	// 'https://sunnah.com/ibnmajah/31',
	// 'https://sunnah.com/ibnmajah/32',
	// 'https://sunnah.com/ibnmajah/33',
	// 'https://sunnah.com/ibnmajah/34',
	// 'https://sunnah.com/ibnmajah/35',
	// 'https://sunnah.com/ibnmajah/36',
	// 'https://sunnah.com/ibnmajah/37',
	// 'https://sunnah.com/muslim/introduction',
	// 'https://sunnah.com/muslim/1',
	// 'https://sunnah.com/muslim/2',
	// 'https://sunnah.com/muslim/3',
	// 'https://sunnah.com/muslim/4',
	// 'https://sunnah.com/muslim/5',
	// 'https://sunnah.com/muslim/6',
	// 'https://sunnah.com/muslim/7',
	// 'https://sunnah.com/muslim/8',
	// 'https://sunnah.com/muslim/9',
	// 'https://sunnah.com/muslim/10',
	// 'https://sunnah.com/muslim/11',
	// 'https://sunnah.com/muslim/12',
	// 'https://sunnah.com/muslim/13',
	// 'https://sunnah.com/muslim/14',
	// 'https://sunnah.com/muslim/15',
	// 'https://sunnah.com/muslim/16',
	// 'https://sunnah.com/muslim/17',
	// 'https://sunnah.com/muslim/18',
	// 'https://sunnah.com/muslim/19',
	// 'https://sunnah.com/muslim/20',
	// 'https://sunnah.com/muslim/21',
	// 'https://sunnah.com/muslim/22',
	// 'https://sunnah.com/muslim/23',
	// 'https://sunnah.com/muslim/24',
	// 'https://sunnah.com/muslim/25',
	// 'https://sunnah.com/muslim/26',
	// 'https://sunnah.com/muslim/27',
	// 'https://sunnah.com/muslim/28',
	// 'https://sunnah.com/muslim/29',
	// 'https://sunnah.com/muslim/30',
	// 'https://sunnah.com/muslim/31',
	// 'https://sunnah.com/muslim/32',
	// 'https://sunnah.com/muslim/33',
	// 'https://sunnah.com/muslim/34',
	// 'https://sunnah.com/muslim/35',
	// 'https://sunnah.com/muslim/36',
	// 'https://sunnah.com/muslim/37',
	// 'https://sunnah.com/muslim/38',
	// 'https://sunnah.com/muslim/39',
	// 'https://sunnah.com/muslim/40',
	// 'https://sunnah.com/muslim/41',
	// 'https://sunnah.com/muslim/42',
	// 'https://sunnah.com/muslim/43',
	// 'https://sunnah.com/muslim/44',
	// 'https://sunnah.com/muslim/45',
	// 'https://sunnah.com/muslim/46',
	// 'https://sunnah.com/muslim/47',
	// 'https://sunnah.com/muslim/48',
	// 'https://sunnah.com/muslim/49',
	// 'https://sunnah.com/muslim/50',
	// 'https://sunnah.com/muslim/52',
	// 'https://sunnah.com/muslim/53',
	// 'https://sunnah.com/muslim/54',
	// 'https://sunnah.com/muslim/55',
	// 'https://sunnah.com/muslim/56',
	// 'https://sunnah.com/nasai/1',
	// 'https://sunnah.com/nasai/2',
	// 'https://sunnah.com/nasai/3',
	// 'https://sunnah.com/nasai/4',
	// 'https://sunnah.com/nasai/5',
	// 'https://sunnah.com/nasai/6',
	// 'https://sunnah.com/nasai/7',
	// 'https://sunnah.com/nasai/8',
	// 'https://sunnah.com/nasai/9',
	// 'https://sunnah.com/nasai/10',
	// 'https://sunnah.com/nasai/11',
	// 'https://sunnah.com/nasai/12',
	// 'https://sunnah.com/nasai/13',
	// 'https://sunnah.com/nasai/14',
	// 'https://sunnah.com/nasai/15',
	// 'https://sunnah.com/nasai/16',
	// 'https://sunnah.com/nasai/17',
	// 'https://sunnah.com/nasai/18',
	// 'https://sunnah.com/nasai/19',
	// 'https://sunnah.com/nasai/20',
	// 'https://sunnah.com/nasai/21',
	// 'https://sunnah.com/nasai/22',
	// 'https://sunnah.com/nasai/23',
	// 'https://sunnah.com/nasai/24',
	// 'https://sunnah.com/nasai/25',
	// 'https://sunnah.com/nasai/26',
	// 'https://sunnah.com/nasai/27',
	// 'https://sunnah.com/nasai/28',
	// 'https://sunnah.com/nasai/29',
	// 'https://sunnah.com/nasai/30',
	// 'https://sunnah.com/nasai/31',
	// 'https://sunnah.com/nasai/32',
	// 'https://sunnah.com/nasai/33',
	// 'https://sunnah.com/nasai/34',
	// 'https://sunnah.com/nasai/35',
	// 'https://sunnah.com/nasai/35b',
	// 'https://sunnah.com/nasai/36',
	// 'https://sunnah.com/nasai/37',
	// 'https://sunnah.com/nasai/38',
	// 'https://sunnah.com/nasai/39',
	// 'https://sunnah.com/nasai/40',
	// 'https://sunnah.com/nasai/41',
	// 'https://sunnah.com/nasai/42',
	// 'https://sunnah.com/nasai/43',
	// 'https://sunnah.com/nasai/44',
	// 'https://sunnah.com/nasai/45',
	// 'https://sunnah.com/nasai/46',
	// 'https://sunnah.com/nasai/47',
	// 'https://sunnah.com/nasai/48',
	// 'https://sunnah.com/nasai/49',
	// 'https://sunnah.com/nasai/50',
	// 'https://sunnah.com/nasai/51',
	// 'https://sunnah.com/tirmidhi/1',
	// 'https://sunnah.com/tirmidhi/2',
	// 'https://sunnah.com/tirmidhi/3',
	// 'https://sunnah.com/tirmidhi/4',
	// 'https://sunnah.com/tirmidhi/5',
	// 'https://sunnah.com/tirmidhi/6',
	// 'https://sunnah.com/tirmidhi/7',
	// 'https://sunnah.com/tirmidhi/8',
	// 'https://sunnah.com/tirmidhi/9',
	// 'https://sunnah.com/tirmidhi/10',
	// 'https://sunnah.com/tirmidhi/11',
	// 'https://sunnah.com/tirmidhi/12',
	// 'https://sunnah.com/tirmidhi/13',
	// 'https://sunnah.com/tirmidhi/14',
	// 'https://sunnah.com/tirmidhi/15',
	// 'https://sunnah.com/tirmidhi/16',
	// 'https://sunnah.com/tirmidhi/17',
	// 'https://sunnah.com/tirmidhi/18',
	// 'https://sunnah.com/tirmidhi/19',
	// 'https://sunnah.com/tirmidhi/20',
	// 'https://sunnah.com/tirmidhi/21',
	// 'https://sunnah.com/tirmidhi/22',
	// 'https://sunnah.com/tirmidhi/23',
	// 'https://sunnah.com/tirmidhi/24',
	// 'https://sunnah.com/tirmidhi/25',
	// 'https://sunnah.com/tirmidhi/26',
	// 'https://sunnah.com/tirmidhi/27',
	// 'https://sunnah.com/tirmidhi/28',
	// 'https://sunnah.com/tirmidhi/29',
	// 'https://sunnah.com/tirmidhi/30',
	// 'https://sunnah.com/tirmidhi/31',
	// 'https://sunnah.com/tirmidhi/32',
	// 'https://sunnah.com/tirmidhi/33',
	// 'https://sunnah.com/tirmidhi/34',
	// 'https://sunnah.com/tirmidhi/35',
	// 'https://sunnah.com/tirmidhi/36',
	// 'https://sunnah.com/tirmidhi/37',
	// 'https://sunnah.com/tirmidhi/38',
	// 'https://sunnah.com/tirmidhi/39',
	// 'https://sunnah.com/tirmidhi/40',
	// 'https://sunnah.com/tirmidhi/41',
	// 'https://sunnah.com/tirmidhi/42',
	// 'https://sunnah.com/tirmidhi/43',
	// 'https://sunnah.com/tirmidhi/44',
	// 'https://sunnah.com/tirmidhi/45',
	// 'https://sunnah.com/tirmidhi/46',
	// 'https://sunnah.com/tirmidhi/47',
	// 'https://sunnah.com/tirmidhi/48',
	// 'https://sunnah.com/tirmidhi/49',
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
	// 'https://sunnah.com/ahmad/1',
	// 'https://sunnah.com/ahmad/2',
	// 'https://sunnah.com/ahmad/3',
	// 'https://sunnah.com/ahmad/4',
	// 'https://sunnah.com/ahmad/5',
	// 'https://sunnah.com/ahmad/6',
	// 'https://sunnah.com/ahmad/7',
	// 'https://sunnah.com/riyadussalihin/introduction',
	// 'https://sunnah.com/riyadussalihin/1',
	// 'https://sunnah.com/riyadussalihin/2',
	// 'https://sunnah.com/riyadussalihin/3',
	// 'https://sunnah.com/riyadussalihin/4',
	// 'https://sunnah.com/riyadussalihin/5',
	// 'https://sunnah.com/riyadussalihin/6',
	// 'https://sunnah.com/riyadussalihin/7',
	// 'https://sunnah.com/riyadussalihin/8',
	// 'https://sunnah.com/riyadussalihin/9',
	// 'https://sunnah.com/riyadussalihin/10',
	// 'https://sunnah.com/riyadussalihin/11',
	// 'https://sunnah.com/riyadussalihin/12',
	// 'https://sunnah.com/riyadussalihin/13',
	// 'https://sunnah.com/riyadussalihin/14',
	// 'https://sunnah.com/riyadussalihin/15',
	// 'https://sunnah.com/riyadussalihin/16',
	// 'https://sunnah.com/riyadussalihin/17',
	// 'https://sunnah.com/riyadussalihin/18',
	// 'https://sunnah.com/riyadussalihin/19'
];
const bookIdMap = [
	['bukhari', 1],
	['muslim', 2],
	['nasai', 3],
	['abudawud', 4],
	['tirmidhi', 5],
	['ibnmajah', 6],
	['malik', 7],
	['ahmad', 8],
	['riyadussalihin', 51]
];

const flag_insertHeadings = false;

function parseChapter(url, page) {
	if (!page)
		page = getPage(url);
	var path = url.split('/');
	var $ = cheerio.load(page);

	// chapter heading and intro
	var i = bookIdMap.findIndex(function (val, i, arr) {
		if (val[0] == path[3])
			return true;
	});
	var bookId = bookIdMap[i][1];
	var chapter = {};
	chapter.bookId = bookId;
	chapter.level = 1;
	chapter.h1 = ($('.book_page_number').text() || 0).trim();
	chapter.h2 = null;
	chapter.h3 = null;
	chapter.title_en = clean($('.book_page_english_name').text());
	chapter.title = clean($('.book_page_arabic_name').text());
	chapter.intro_en = clean($('.ebookintro').text());
	chapter.intro = clean($('.abookintro').text());
	chapter.start = null;
	chapter.end = null;
	chapter.start0 = -1;
	chapter.end0 = -1;
	var headings = [];
	var numInChapter = 1;
	var lastNum = -1;
	var h2InChapter = 1;
	var afterHadith = false;

	// section heading, intros, and hadith
	$('.AllHadith').children().each(function () {
		if ($(this).hasClass('chapter') || $(this).hasClass('surah')) {
			// flush previous headings
			if (afterHadith && headings.length > 0) {
				headings[headings.length - 1].end0 = hadithNumtoNumber(lastNum);
				headings[headings.length - 1].end = clean(lastNum);
				insertHeadings(headings);
				headings = [];
				afterHadith = false;
			}
			// parse new heading
			var heading = {};
			heading.bookId = bookId;
			heading.level = 2;
			heading.h1 = chapter.h1;
			heading.h2 = h2InChapter++;
			heading.h3 = null;
			heading.title_en = clean($(this).find('.englishchapter').text());
			heading.title = clean($(this).find('.arabicchapter').text());
			heading.intro_en = null;
			heading.intro = null;
			heading.start = null;
			heading.end = null;
			heading.start0 = -1;
			heading.end0 = -1;
			headings.push(heading);
		} else if ($(this).hasClass('achapintro')) {
			headings[headings.length - 1].intro = clean($(this).text());
		} else if ($(this).hasClass('actualHadithContainer')) {
			afterHadith = true;
			// parse new hadith
			var heading = {
				bookId: bookId,
				level: 2,
				h1: chapter.h1,
				h2: h2InChapter,
				h3: null,
				title_en: null,
				title: clean('باب'),
				intro_en: null,
				intro: null,
				start: null,
				end: null,
				start0: -1,
				end0: -1,
			};
			if (headings.length > 0)
				heading = headings[headings.length - 1];
			else {
				headings.push(heading);
				h2InChapter++;
			}
			var hadith = {};
			hadith.bookId = bookId;
			hadith.h1 = chapter.h1;
			hadith.h2 = heading.h2;
			hadith.h3 = null;
			hadith.numInChapter = numInChapter++;
			hadith.num = null;
			try {
				if (bookId != 7) {
					var link = $(this).find(`.bottomItems .hadith_permalink .sharelink`).attr('onclick');
					var n = extract(link, /([0-9]+.*?)'\)/);
					if (n && n.indexOf('/') >= 0)
						n = extract(n, /\/([0-9]+.*?)/);
				} else if (bookId == 7) {
					var ref = $(this).find(`.bottomItems .hadith_reference`).text();
					n = extract(ref, /Arabic\/English.+Hadith ([0-9]+)/);
					if (!n)
						n = extract(ref, /Arabic reference.+Hadith ([0-9]+)/) || '0';
				}
				lastNum = hadith.num = n;
			} catch (err) {
			}
			hadith.num0 = hadithNumtoNumber(hadith.num);
			hadith.num = clean(hadith.num);
			hadith.chain_en = clean($(this).find(`.englishcontainer .hadith_narrated`).text());
			hadith.chain = null;
			hadith.body_en = clean($(this).find(`.englishcontainer .text_details`).text());
			hadith.footnote_en = null;
			hadith.footnote = null;
			hadith.text_en = (emptyIfNull(hadith.chain_en) + ' ' + hadith.body_en).trim();
			hadith.text = hadith.body = $(this).find(`.arabic_hadith_full`).text();
			hadith = splitHadith(hadith);
			hadith.chain = clean(hadith.chain);
			hadith.body = clean(hadith.body);
			hadith.text = clean(hadith.text);
			hadith.gradeText = clean($(this).find(`.gradetable tr:nth-child(1) td:nth-child(2)`).text());
			if (chapter.start0 < 0) {
				chapter.start = hadith.num;
				chapter.start0 = hadith.num0;
			}
			if (heading.start0 < 0) {
				for (var i = 0; i < headings.length; i++) {
					headings[i].start = hadith.num;
					headings[i].start0 = hadith.num0;
				}
			}
			insertHadith(hadith);
		}
	});
	if (headings.length > 0) {
		chapter.end0 = headings[headings.length - 1].end0 = hadithNumtoNumber(lastNum);
		chapter.end = headings[headings.length - 1].end = clean(lastNum);
		insertHeadings(headings);
		insertHeading(chapter);
	}
}

function splitHadith(hadith) {
	// normalize
	if (hadith.text) {
		hadith.text = hadith.text.replace(/[\:\"\'،۔ـ\-\.\,]/g, '');
		hadith.text = hadith.text.replaceAll('صلى الله عليه وسلم', 'ﷺ');
		hadith.text = hadith.text.replace(/\s+/g, ' ').trim();
	}
	var textMarked = hadith.text + '';
	var bodyMarked = '';
	textMarked = textMarked.replace(/[ؐ-ًؕ-ٖٓ-ٟۖ-ٰٰۭ]/g, '');
	textMarked = textMarked.replace(/و?(حدثنا|حدثني|حدثناه|حدثه|ثنا) /g, '~ ');
	textMarked = textMarked.replace(/و?(أخبرنا|أخبرناه|أخبرني|أخبره|آنا) /g, '~ ');
	textMarked = textMarked.replace(/و?(أنبأنا|أنبأناه|أنبأني|أنبأه|آنبأ) /g, '~ ');
	textMarked = textMarked.replace(/و?(سمعت|سمعنا|سمعناه|سمع) /g, '~ ');
	textMarked = textMarked.replace(/(عن) /g, '~ ');
	textMarked = textMarked.replace(/(يبلغ به) /g, '~~ ');
	textMarked = textMarked.replace(/(أنه|أن|أنها) /g, '~ ');
	textMarked = textMarked.replace(/(قال|قالت) /g, '~ ');
	textMarked = textMarked.replace(/\s+/g, ' ').trim();
	// extract body
	var chainDelims = textMarked.split(/~/);
	if (chainDelims) {
		var chainToksWordCount = [];
		for (var tok of chainDelims)
			chainToksWordCount.push(wordCount(tok));
		for (var j = 0; j < chainDelims.length; j++) {
			if (chainDelims[j].match(/(نبي|رسول)/)) {
				bodyMarked = chainDelims.slice(j).join('~ ');
				break;
			} else if (chainToksWordCount[j] > 7 && !chainDelims[j].match(/ (بن|ابن) /)) {
				bodyMarked = chainDelims.slice(j).join('~ ');
				break;
			}
		}
		if (bodyMarked == '')
			bodyMarked = chainDelims[chainDelims.length - 1];
	}
	if (bodyMarked == null) {
		process.stdout.write('ERROR on: ' + hadith.bookId + ' ' + hadith.num + '\n');
		return;
	}
	bodyMarked = bodyMarked.replace(/\s+/g, ' ').trim();
	// extract chain and body
	var textToks = hadith.text.split(/ /);
	var textMarkedToks = textMarked.split(/ /);
	var bodyMarkedToks = bodyMarked.split(/ /);
	hadith.body = '';
	if (!textToks || !bodyMarkedToks || textToks.length == bodyMarkedToks.length)
		hadith.body = hadith.text;
	else {
		var diff = textToks.length - bodyMarkedToks.length;
		for (var j = (diff - 1); j >= 0; j--) {
			if (textMarkedToks[j].endsWith('~'))
				diff--;
			else
				break;
		}
		hadith.chain = textToks.slice(0, diff).join(' ').trim();
		hadith.body = textToks.slice(diff).join(' ').trim();
	}
	return hadith;
}

function insertHeadings(headings) {
	if (headings.length > 0) {
		for (var i = 0; i < headings.length; i++)
			insertHeading(headings[i]);
	}
}

function insertHeading(heading) {
	if (flag_insertHeadings) {
		console.log(sql(`
	INSERT INTO toc
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
	INSERT INTO hadiths
		(bookId, h1, h2, h3, num, num0, numInChapter, gradeText,
			chain_en, chain, body_en, body, footnote_en, footnote, text_en, text, lastmod)
	VALUES (
		${hadith.bookId}, ${hadith.h1}, ${hadith.h2}, ${hadith.h3}, ${hadith.num}, ${hadith.num0}, ${hadith.numInChapter}, ${hadith.gradeText},
			${hadith.chain_en}, ${hadith.chain}, ${hadith.body_en}, ${hadith.body}, ${hadith.footnote_en}, ${hadith.footnote}, ${hadith.text_en}, ${hadith.text},
			STR_TO_DATE("1970-01-01 00:00:00", "%Y-%m-%d %H:%i:%s")
		);
	`));
	// console.log(`UPDATE hadiths SET h1=${hadith.h1},h2=${hadith.h2},h3=${hadith.h3},numInChapter=${hadith.numInChapter} WHERE bookId=${hadith.bookId} and num0=${hadith.num0};`);
}

function getPage(url) {
	console.error(url);
	return http('GET', url).getBody().toString();
}

function wordCount(s) {
	return s.split(' ').length;
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

function hadithNumtoNumber(num) {
	var n = parseInt(extract(num, /^([0-9]+)/) || -1);
	var d = 0;
	var suffix = extract(num, /([a-z]+)/);
	if (suffix)
		d = parseInt(letterToNumber(suffix)) / 1000.;
	return n + d;
}

function letterToNumber(s) {
	s = s.toUpperCase();
	var out = 0, len = s.length;
	for (var pos = 0; pos < len; pos++) {
		out += (s.charCodeAt(pos) - 64) * Math.pow(26, len - pos - 1);
	}
	return out;
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

for (var i = 0; i < urls.length; i++) {
	parseChapter(urls[i]);
}

// //parseChapter('https://sunnah.com/muslim/introduction');

// console.log(letterToNumber('ad'));

// parseChapter('https://sunnah.com/muslim/51');
