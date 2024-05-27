/* jslint node:true, esversion:9 */
'use strict';

require('dotenv').config();
require('../lib/Globals');
const fs = require('fs');
const Index = require('../lib/Index');

(async () => {
	try {
		log(`retreiving data to index...`);
		var books = await global.query(`SELECT * FROM books b ORDER BY id`);
		for (var i = 0; i < books.length; i++) {
			await indexDocs('hadiths', books[i]);
			await indexDocs('toc', books[i]);
		}
	} finally {
		global.dbPool.end();
		log('indexing complete');
	}
})();

async function getData(indexName, book) {
	var rows = await global.query(`
		SELECT * FROM v_${indexName}
		WHERE
			book_id = ${book.id}
		ORDER BY 
			book_id, h1, numInChapter
		-- LIMIT 10`);
	return rows;
}

async function indexDocs(indexName, book) {
	log(`\n*****\ncreating ${indexName} index for ${book.shortName_en}...`);
	var rows = await getData(indexName, book);
	await Index.updateBulk(indexName, rows, true);
}

function log(message) {
	console.log(message);
	fs.appendFileSync('buildSearchIndex.log', message + '\n');
}