/* jslint node:true, esversion:9 */
'use strict';

const HomeDir = require('os').homedir();
const util = require('util');
const MySQL = require('mysql');
const axios = require('axios');
const Utils = require('../lib/Utils');

const MySQLConfig = require(HomeDir + '/.hadithdb/store.json');
var dbPool = MySQL.createPool(MySQLConfig.connection);
var query = util.promisify(dbPool.query).bind(dbPool);

const indexUrl = 'http://search.quranunlocked.com/hadiths/_bulk';
const headers = {
	'Content-Type': 'application/x-ndjson'
};

(async () => {
	console.log(`retreiving data to index...`);
	var books = await query(`SELECT * FROM books ORDER BY id`);
	for (var b = 0; b < books.length; b++) {
		console.log(`creating index for ${books[b].shortName_en}...`);
		var rows = await getData(books[b].id);
		console.log(`indexing ${rows.length} docs...`);
		var bulk = '';
		for (var i = 0; i < rows.length; i++) {
			delete rows[i].highlight;
			var data = {};
			if (rows[i].num)
				data.ref = rows[i].book_alias + ':' + rows[i].num;
			else
				data.ref = rows[i].book_alias + '/' + rows[i].h1 + '#S' + rows[i].h2;
			if (i > 0 && rows[i].book_id == rows[i - 1].book_id)
				data.prevId = rows[i - 1].hId;
			if (i < (rows.length - 1) && rows[i].book_id == rows[i + 1].book_id)
				data.nextId = rows[i + 1].hId;
			for (var k in rows[i])
				data[k] = rows[i][k];
			bulk += `{ "index" : { "_index":"hadiths","_id":"${rows[i].hId}" } }\n${JSON.stringify(data)}\n`;
			if (i > 0 && (i % 100) == 0) {
				Utils.msleep(500);
				console.log(`POSTing ${data.ref}`);
				var res = await axios.post(indexUrl, bulk + '\n', { headers });
				console.log(`${res.status} errors=${res.data.errors}`);
				bulk = "";
			}
		}
		if (bulk.length > 0) {
			Utils.msleep(500);
			console.log(`POSTing last batch`);
			var res = await axios.post(indexUrl, bulk + '\n', { headers });
			console.log(`${res.status} errors=${res.data.errors}`);
			bulk = "";
		}
	}
	console.log('indexing complete');
})();

async function getData(bookId) {
	var rows = await query(`
		SELECT * FROM v_hadiths_searchindex
		WHERE
			book_id = ${bookId}
		ORDER BY 
			book_id, h1, numInChapter
		-- LIMIT 10`);
	dbPool.end();
	return rows;
}
