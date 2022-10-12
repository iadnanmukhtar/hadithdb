/* jslint node:true, esversion:8 */
'use strict';

const fs = require('fs');

const bookIdMap = [
	['bukhari', 1],
	['muslim', 2],
	['nasai', 3],
	['abudawud', 4],
	['tirmidhi', 5],
	['ibnmajah', 6],
	['malik', 7]
];

const toc = JSON.parse(fs.readFileSync('data/sunnah-toc2.json'));
for (var c = 0; c < toc.length; c++) {
	var i = bookIdMap.findIndex(function (val, i, arr) {
		if (val[0] == toc[c].bookAlias)
			return true;
	});
	toc[c].bookId = bookIdMap[i][1];
}
toc.sort(function (c0, c1) {
	if (parseInt(c0.bookId) == parseInt(c1.bookId)) {
		return parseInt(c0.cNum) < parseInt(c1.cNum) ? -1 : 1;
	  } else {
		return parseInt(c0.bookId) < parseInt(c1.bookId) ? -1 : 1;
	  }
});

var prevAlias = '';
var chId = 1;
for (var c = 0; c < toc.length; c++) {
	var i = bookIdMap.findIndex(function (val, i, arr) {
		if (val[0] == toc[c].bookAlias)
			return true;
	});
	toc[c].bookId = bookIdMap[i][1];
	if (prevAlias != toc[c].bookAlias)
		chId = 1;
	var sql = 'INSERT INTO toc (bookId, level, num1, title_en, title, intro_en, intro, start) VALUES ' +
		`(${toc[c].bookId}, 1, ${toc[c].cNum}, "${j(toc[c].cName_en)}", "${j(toc[c].cName)}", "${j(toc[c].cIntro_en)}", "${j(toc[c].cIntro)}", "${j(toc[c].titles[0].hStartNum)}");`;
	console.log(sql);
	prevAlias = toc[c].bookAlias;
	chId++;
}
for (var c = 0; c < toc.length; c++) {
	for (var t = 0; t < toc[c].titles.length; t++) {
		var sql = 'INSERT INTO toc (bookId, level, num1, num2, title_en, title, intro_en, intro, start) VALUES ' +
			`(${toc[c].bookId}, 2, ${toc[c].cNum}, ${t+1}, "${j(toc[c].titles[t].tText_en)}", "${j(toc[c].titles[t].tText)}", "${j(toc[c].titles[t].tIntro_en)}", "${j(toc[c].titles[t].tIntro)}", "${j(toc[c].titles[t].hStartNum)}");`;
		console.log(sql);
	}
}

function j(s) {
	if (s)
		s = s.replace(/[\n\r]+/g, ' ').replace(/"/g, '\\"').replace(/'/g, '\\\'');
	else
		s = '';
	return s;
}

function n(s) {
	s = j(s);
	try {
		s = /^\((\d+)/.exec(s)[1];
	} catch (err) {
	}
	return s;
}