/* jslint node:true, esversion:8 */
/*
 * Hadith Grades Parser for Shamela Book: https://old.shamela.ws/index.php/book/1733
 * Mu`jam al-Kabir of Tabarani
 * المعجم الكبير للطبراني
 */

const Database = require('better-sqlite3');
const Hadith = require('../../lib/Hadith');
const Arabic = require('../../lib/Arabic');
const Utils = require('../../lib/Utils');

const dbFile = __dirname + '/../../data/tabarani.db';
const readDb = new Database(dbFile);

const chaps = [
	'ألف',
	'باء',
	'تاء',
	'ثاء',
	'جيم',
	'حاء',
	'خاء',
	'دال',
	'ذال',
	'راء',
	'زاي',
	'سين',
	'شين',
	'صاد',
	'ضاد',
	'طاء',
	'ظاء',
	'عين',
	'غين',
	'فاء',
	'قاف',
	'كاف',
	'لام',
	'ميم',
	'نون',
	'واو',
	'هاء',
	'ياء',
];

var titles = [];
var start = -1;
var lastNum = 0;
var level = 0;
var h1 = 0;
var h2 = null;
var h3 = null;
var numInChapter = 1;
var prefixNum = 0;

var rows = readDb.prepare('SELECT * FROM b1733 ORDER BY id').all();
for (var i = 0; i < rows.length; i++) {

	var page = rows[i].nass;
	page = page.replace(/\\n/g, '\n');
	page = page.replace(/-\[\d+\]-/g, '');
	page = page.replace(/\[.+?\]/g, '');
	page = page.replace(/\u200f/g, '');

	var body = page;
	var hukm = 'No Grade';

	if (/^§[^0-9]/.test(body)) {
		start = -1;
		var title = body.substring(1);
		if (title == 'بَابُ مَنِ اسْمُهُ عُمَرُ') {
			level = 1;
			h1++;
			h2 = h3 = null;
			numInChapter = 1;
			titles.push({
				level: level,
				h1: h1,
				h2: h2,
				h3: h3,
				title: 'بَابُ الْعَيْنِ',
				intro: '',
				start: 0
			});
		} else if (title.startsWith('بَابُ ذِكْرُ سِنِّ فَاطِمَةَ')) {
			level = 2;
			if (!h2)
				h2 = 1;
			else
				h2++;
			h3 = null;
			titles.push({
				level: level,
				h1: h1,
				h2: h2,
				h3: h3,
				title: 'بَناتُ رَسُولِ اللهِ ﷺ',
				intro: '',
				start: 0
			});
		}
		if (isChap(title) || title.startsWith('مُسْنَدُ ') || title.startsWith('مقدمة')) {
			level = 1;
			h1++;
			h2 = h3 = null;
			numInChapter = 1;
		} else if (title.startsWith('بَابُ ') || title.startsWith('بَابٌ ') || title.startsWith('بَقِيَّةُ ')) {
			level = 2;
			if (!h2)
				h2 = 1;
			else
				h2++;
			h3 = null;
		} else {
			level = 3;
			if (!h2)
				h2 = 1;
			if (!h3)
				h3 = 1;
			else
				h3++;
		}
		var title = splitTitle(title);
		titles.push({
			level: level,
			h1: h1,
			h2: h2,
			h3: h3,
			title: title.title,
			intro: title.intro,
			start: 0
		});
	} else if (/^§?\d/.test(body)) {
		var numActual = '';
		var num = parseInt(Utils.regexExtract(body, /^§?(\d+)/));
		if (lastNum > num)
			prefixNum += lastNum;
		numActual = lastNum = num;
		num = (prefixNum + num);
		if (start == -1 && titles.length > 0)
			titles[titles.length - 1].start = num;
		var hadithText = Utils.regexExtract(body, /^§?\d+\s*-\s*(.+)/);
		if (hadithText) {
			numInChapter++;
			var splitText = Hadith.splitHadithText({ text: hadithText });
			console.log(`
				INSERT INTO hadiths
					(bookId,h1,numInChapter,h2,h3,remark,numActual,num,num0,gradeText,chain,body,text) VALUES
					(12, ${h1}, ${numInChapter}, ${h2}, ${h3}, 0, "${numActual}", "${num}", ${parseInt(num)}, 
					"${hukm}", "${esc(splitText.chain)}", "${esc(splitText.body)}", "${esc(hadithText)}");
				`.replace(/[\n\s]+/g, ' ').trim());
		}
	} else {
		numInChapter++;
		console.log(`
			INSERT INTO hadiths
				(bookId,h1,numInChapter,h2,h3,remark,num,num0,gradeText,chain,body,text) VALUES
				(12, ${h1}, ${numInChapter}, ${h2}, ${h3}, 1, "${num}", ${parseInt(num)}, 
				null, null, "${esc(hadithText)}", "${esc(hadithText)}");
			`.replace(/[\n\s]+/g, ' ').trim());
	}

}
for (var title of titles) {
	if (title.level < 4)
		console.log(`
			INSERT INTO  toc
			(bookId, level, h1, h2, h3, title, intro, start, start0) VALUES
			(12, ${title.level}, ${title.h1}, ${title.h2}, ${title.h3}, "${esc(title.title)}", "${esc(title.intro)}",
			"${title.start}", ${parseInt(title.start)});
		`.replace(/[\n\s]+/g, ' ').trim());
}

function splitTitle(s) {
	var title = '';
	var intro = '';
	var toks = s.split(/\n/);
	title = toks.splice(0, 1)[0];
	if (toks.length > 0) {
		intro = toks.join('\n');
	}
	return {
		title: title,
		intro: intro
	};
}

function isChap(s) {
	s = Arabic.removeArabicDiacritics(s);
	for (var i = 0; i < chaps.length; i++)
		if (s.startsWith('باب ال' + chaps[i]))
			return true;
	return false;
}

function esc(s) {
	return Utils.escSQL(s);
}