/* jslint node:true, esversion:9 */
'use strict';

const HomeDir = require('os').homedir();
const si = require('search-index');
const util = require('util');
const MySQL = require('mysql');
const SearchIndex = require('../lib/SearchIndex');

(async () => {
	global.searchIdx = await si({ name: `${HomeDir}/.hadithdb/si` });
	console.log(`retreiving data to index...`);
	var rows = await getData();
	console.log(`creating index...`);
	await global.searchIdx.FLUSH();
	var batch = [];
	for (var i = 0; i < rows.length; i++) {
		var data = {
			_id: rows[i].hId
		};
		if (i > 0 && rows[i].bookId == rows[i - 1].bookId)
			data.prevId = rows[i - 1].hId;
		if (i < (rows.length - 1) && rows[i].bookId == rows[i + 1].bookId)
			data.nextId = rows[i + 1].hId;
		for (var k in rows[i])
			data[k] = rows[i][k];
		if (batch.length > 1000) {
			console.log(`PUT ${data.bookAlias}:${data.num}`);
			await global.searchIdx.PUT(batch, SearchIndex.TOKENIZER_OPTIONS);
			batch = [];
		}
		batch.push(data);
	}
	console.log(`PUT last batch`);
	await global.searchIdx.PUT(batch, SearchIndex.TOKENIZER_OPTIONS);
	var result = await global.searchIdx.SEARCH(['abu'], { DOCUMENTS: true });
	console.log(result.RESULT.length);
	console.log('done');
})();

async function getData() {
	const MySQLConfig = require(HomeDir + '/.hadithdb/store.json');
	var dbPool = MySQL.createPool(MySQLConfig.connection);
	var query = util.promisify(dbPool.query).bind(dbPool);
	var rows = await query(`
		SELECT * FROM v_hadiths 
		ORDER BY bookId, h1, numInChapter, num0
		-- LIMIT 1`);
	dbPool.end();
	return rows;
}

async function getTestData() {
	return [
		{
			test1: 'Abū Hurayrah 1:3',
			test2: 'ابو هريرة'
		}
	];
}
