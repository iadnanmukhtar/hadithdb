/* jslint node:true, esversion:9 */
'use strict';

const HomeDir = require('os').homedir();
const fs = require('fs');
const util = require('util');
const MySQL = require('mysql');
const Index = require('../lib/Index');

const MySQLConfig = require(HomeDir + '/.hadithdb/store.json');
var dbPool = MySQL.createPool(MySQLConfig.connection);
var query = util.promisify(dbPool.query).bind(dbPool);

(async () => {
	try {
		log(`retreiving data to index...`);
		var books = await query(`SELECT * FROM books b ORDER BY id`);
		for (var i = 0; i < books.length; i++) {
			// await indexDocs('hadiths', books[i]);
			await indexDocs('toc', books[i]);
		}
	} finally {
		dbPool.end();
		log('indexing complete');
	}
})();

async function indexDocs(indexName, book) {
	log(`\n*****\ncreating ${indexName} index for ${book.shortName_en}...`);
	var rows = await getData(indexName, book);
	await Index.updateBulk(indexName, rows);
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

function log(message) {
	console.log(message);
	fs.appendFileSync('buildSearchIndex.log', message + '\n');
}