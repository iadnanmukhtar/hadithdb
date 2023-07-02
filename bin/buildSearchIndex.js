/* jslint node:true, esversion:9 */
'use strict';

const HomeDir = require('os').homedir();
const util = require('util');
const MySQL = require('mysql');
const axios = require('axios');
//const SearchIndex = require('../lib/SearchIndex');

const indexUrl = 'http://search.quranunlocked.com/hadiths/_bulk';
const headers = {
	'Content-Type': 'application/x-ndjson'
};

(async () => {
	console.log(`retreiving data to index...`);
	var rows = await getData();
	console.log(`creating index...`);
	var bulk = '';
	for (var i = 0; i < rows.length; i++) {
		delete rows[i].highlight;
		var data = {
			ref: `${rows[i].book_alias}:${rows[i].num}`
		};
		if (i > 0 && rows[i].book_id == rows[i - 1].book_id)
			data.prevId = rows[i - 1].hId;
		if (i < (rows.length - 1) && rows[i].book_id == rows[i + 1].book_id)
			data.nextId = rows[i + 1].hId;
		for (var k in rows[i])
			data[k] = rows[i][k];
		bulk += `{ "index" : { "_index":"hadiths","_id":"${rows[i].hId}" } }\n${JSON.stringify(data)}\n`;
		if (i > 0 && (i % 100) == 0) {
			console.log(`POSTing ${data.book_alias}:${data.num}`);
			var res = await axios.post(indexUrl, bulk + '\n', { headers });
			console.log(`${res.status} errors=${res.data.errors}`);
			bulk = "";
		}
	}
	if (bulk.length > 0) {
		console.log(`POSTing last batch`);
		var res = await axios.post(indexUrl, bulk + '\n', { headers });
		console.log(`${res.status} errors=${res.data.errors}`);
		bulk = "";
	}
	console.log('indexing complete');
})();

async function getData() {
	const MySQLConfig = require(HomeDir + '/.hadithdb/store.json');
	var dbPool = MySQL.createPool(MySQLConfig.connection);
	var query = util.promisify(dbPool.query).bind(dbPool);
	var rows = await query(`
		SELECT * FROM v_hadiths_searchindex
		-- WHERE hId IN (SELECT DISTINCT hadithId FROM hadiths_tags WHERE tagId=166)
		-- WHERE book_id=0
		ORDER BY ordinal
		-- LIMIT 10`);
	dbPool.end();
	return rows;
}
