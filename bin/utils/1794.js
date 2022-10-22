/* jslint node:true, esversion:8 */
/*
 * Hadith Grades Parser for Shamela Book: https://old.shamela.ws/index.php/book/1734
 * Sahih Ibn Hibban, Authenticated by Shaykh Arna'ūt
 * مسند أحمد ط الرسالة
 */

const fs = require('fs');
const Database = require('better-sqlite3');
const Hadith = require('../../lib/Hadith');

const dbFile = __dirname + '/../../data/ibnhibban.db';
const readDb = new Database(dbFile);

var titles = [];
var start = -1;
var lastNum = -1;
var level = 0;
var h1 = 0;
var h2 = null;
var h3 = null;
var numInChapter = 1;

var headingsSql = [];

var rows = readDb.prepare('SELECT * from b1734').all();
for (var i = 0; i < rows.length; i++) {

	var page = rows[i].nass;
	page = page.replace(/\\n/g, '\n');
	page = page.replace(/-\[\d+\]-/g, '');
	page = page.replace(/\[.+?\]/g, '');

	var parts = page.split(/_+L/);
	var body = parts[0];
	var footer = '';
	var hukm = 'No Grade';
	var hasFooter = parts.length > 1;
	if (hasFooter)
		footer = parts[1].trim();

	if (/^§[^0-9]/.test(body)) {
		start = -1;
		var title = body.substring(1);
		if (title.startsWith('كِتَابُ ')) {
			level = 1;
			h1++;
			h2 = h3 = null;
			numInChapter = 1;
		} else if (!title.startsWith('ذِكْرُ ')) {
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
		titles.push({
			level: level,
			h1: h1,
			h2: h2,
			h3: h3,
			title: title.replace(/(['"])/g, '\\$1'),
			start: 0
		});
	} else if (/^§?\d/.test(body)) {
		var num = lastNum = parseInt(extract(body, /^§?(\d+)/));
		if (num == 255)
			var x = 1;
		if (start == -1 && titles.length > 0) {
			titles[titles.length - 1].start = num;
		}
		var hadithText = extract(body, /^§?\d+\s*-\s*(.+)/).trim().replace(/(['"])/g, '\\$1');
		if (hadithText) {
			numInChapter++;
			var splitText = Hadith.splitHadithText({ text: hadithText });
			if (hasFooter)
				hukm = extract(footer, /^(.+?)-/).trim();
			console.log(`
				INSERT INTO hadiths
					(bookId,h1,numInChapter,h2,h3,remark,num,num0,gradeText,chain,body,text) VALUES
					(11, ${h1}, ${numInChapter}, ${h2}, ${h3}, 0, "${num}", ${parseInt(num)}, 
					"${hukm}", "${splitText.chain}", "${splitText.body}", "${hadithText}");
				`.replace(/[\n\s]+/g, ' ').trim());
		}
	} else {
		numInChapter++;
		console.log(`
			INSERT INTO hadiths
				(bookId,h1,numInChapter,h2,h3,remark,num,num0,gradeText,chain,body,text) VALUES
				(11, ${h1}, ${numInChapter}, ${h2}, ${h3}, 1, "${num}", ${parseInt(num)}, 
				null, null, "${hadithText}", "${hadithText}");
			`.replace(/[\n\s]+/g, ' ').trim());
	}

}
console.log(`
	INSERT INTO  toc
	(bookId, level, h1, h2, h3, title, start, start0) VALUES
	(11, 1, 0, null, null, "المقدمة", "1", 1);
`.replace(/[\n\s]+/g, ' ').trim());
for (var title of titles) {
	if (title.level < 4)
		console.log(`
			INSERT INTO  toc
			(bookId, level, h1, h2, h3, title, start, start0) VALUES
			(11, ${title.level}, ${title.h1}, ${title.h2}, ${title.h3}, "${title.title}", 
			"${title.start}", ${parseInt(title.start)});
		`.replace(/[\n\s]+/g, ' ').trim());
}

function extract(s, re) {
	var arr = re.exec(s);
	if (arr)
		return arr[1];
	return '';
}