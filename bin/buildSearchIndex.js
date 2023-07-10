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

const headers = {
	'Content-Type': 'application/x-ndjson'
};

(async () => {
	try {
		console.log(`retreiving data to index...`);
		var books = await query(`SELECT * FROM books b WHERE b.id > 12 ORDER BY id`);
		for (var i = 0; i < books.length; i++) {
			await indexDocs('hadiths', books[i]);
			// await indexDocs('toc', books[i]);
		}
	} finally {
		dbPool.end();
		console.log('indexing complete');
	}
})();

async function indexDocs(indexName, book) {
	console.log(`\n*****\ncreating ${indexName} index for ${book.shortName_en}...`);
	var indexURL = 'http://search.quranunlocked.com/' + indexName + '/_bulk';
	var rows = await getData(indexName, book);
	console.log(`indexing ${rows.length} docs...`);
	var bulk = '';
	for (var i = 0; i < rows.length; i++) {
		delete rows[i].highlight;
		var data = {};
		if (rows[i].num)
			data.ref = rows[i].book_alias + ':' + rows[i].num;
		else {
			data.ref = rows[i].book_alias + '/' + rows[i].h1;
			if (rows[i].h2)
				data.ref += '#S' + rows[i].h2;
		}
		if (i > 0 && rows[i].book_id == rows[i - 1].book_id)
			data.prevId = rows[i - 1].hId;
		if (i < (rows.length - 1) && rows[i].book_id == rows[i + 1].book_id)
			data.nextId = rows[i + 1].hId;
		for (var k in rows[i])
			data[k] = rows[i][k];
		bulk += `{ "index" : { "_index":"${indexName}","_id":"${rows[i].hId}" } }\n${JSON.stringify(data)}\n`;
		if (i > 0 && (i % 50) == 0) {
			Utils.msleep(250);
			console.log(`POSTing ${data.ref}`);
			var res = await axios.post(indexURL, bulk + '\n', { headers });
			console.log(`${res.status} errors=${res.data.errors}`);
			bulk = "";
		}
	}
	if (bulk.length > 0) {
		Utils.msleep(500);
		console.log(`POSTing last batch`);
		var res = await axios.post(indexURL, bulk + '\n', { headers });
		console.log(`${res.status} errors=${res.data.errors}`);
		bulk = "";
	}
}

async function getData(indexName, book) {
	var rows = await query(`
		SELECT * FROM v_${indexName}
		WHERE
			book_id = ${book.id}
		ORDER BY 
			book_id, h1, numInChapter
		-- LIMIT 10`);
	return rows;
}