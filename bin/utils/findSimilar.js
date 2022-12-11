/* jslint node:true, esversion:9 */
'use strict';

const HomeDir = require('os').homedir();
const util = require('util');
const MySQL = require('mysql');
const Arabic = require('../../lib/Arabic');
const stringSimilarity = require("string-similarity");

const MySQLConfig = require(HomeDir + '/.hadithdb/store.json');
var dbPool = MySQL.createPool(MySQLConfig.connection);
var query = util.promisify(dbPool.query).bind(dbPool);

(async () => {
	var go = false;
	var rows = await getData();
	for (var i = 0; i < rows.length; i++) {
		if (rows[i].bookId == 1 && rows[i].num0 == 4198) go = true;
		for (var j = 0; go && j < rows.length; j++) {
			if (rows[i].id === rows[j].id) continue;
			try {
				var source = (rows[i].body.length >= rows[j].body.length) ? rows[j].body : rows[i].body;
			var target = (rows[i].body.length >= rows[j].body.length) ? rows[i].body : rows[j].body;
			var match = stringSimilarity.findBestMatch(source, [target]);
				if (match.bestMatch.rating > 0.5) {
					console.log(`${rows[i].bookId}:${rows[i].num0} ~ ${rows[j].bookId}:${rows[j].num0}\t${rows[i].body.substring(0, 100)}\t${rows[j].body.substring(0, 100)}`);
					await query(`
					INSERT INTO hadith_sim_candidates VALUES (${rows[i].id}, ${rows[j].id}, ${match.bestMatch.rating})`);
				}
			} catch (err) {
				console.error(`${rows[i].bookId}:${rows[i].num0} ~ ${rows[j].bookId}:${rows[j].num0}\t${err}`);
			}
		}
	}
})();

function getMatchRatio(findWords, withinWords) {
	var stop = false;
	var withinMatch = false;
	var totalMatched = 0;
	var totalMismatched = 0;
	for (var i = 0; i < findWords.length && !stop; i++) {
		for (var j = 0; j < withinWords.length && !stop; i++) {
			var matched = matchWord(findWords[i], withinWords[i]);
			if (matched) {
				totalMatched++;
				withinMatch = true;
			} else
				totalMismatched++;
			if (withinMatch && totalMismatched > 2) stop = true;
		}
	}
	
}

function matchWord(a, b) {
	if (a === b)
		return true;
	else if (a.length >= 4 || b.length >= 4) {
		a = a.substring(0, a.length - 1);
		b = b.substring(0, b.length - 1);
		if (a === b) return true;
	}
	return false;
}

async function getData() {
	var rows = await query(`
		SELECT id, bookId, num0, body FROM hadiths 
		ORDER BY bookId, num0`);
	rows = rows.map((row) => {
		row.body = row.body.replace(/ًا/gu, '');
		row.body = row.body.replace(/[^\p{L} ]/gu, '');
		row.body = row.body.replace(/[ايوى]/g, '');
		row.body = row.body.replace(/[ة]/g, 'ت');
		row.body = row.body.replace(/[ؤئ]/g, 'ء');
		return row;
	});
	return rows;
}
