/* jslint node:true, esversion:9 */
'use strict';

require('../lib/Globals');
const fs = require('fs');
const Index = require('../lib/Index');
const { Item, Heading } = require('../lib/Model');

const date = '1999-12-31';

(async () => {
	try {
		await reindexChangedBooks();
	} finally {
		global.dbPool.end();
		logfile('indexing complete');
	}
})();

async function reindexChangedBooks() {
	var books = await global.query(`
		SELECT DISTINCT book_id AS id, book_alias AS alias
		FROM (
			SELECT book_id, book_alias FROM v_hadiths WHERE lastmod >= '${date}'
			UNION
			SELECT book_id, book_alias FROM v_toc WHERE lastmod >= '${date}'
		) changed
		ORDER BY id`);
	logfile(`found ${books.length} books with search-index changes since ${date}`);
	for (var i = 0; i < books.length; i++)
		await reindexBook(books[i]);
}

async function reindexBook(book) {
	logfile(`\n*****\nrebuilding search indexes for book ${book.alias} (${book.id})...`);
	await Index.deleteByBook(Heading.INDEX, book);
	await Index.deleteByBook(Item.INDEX, book);
	var headings = await global.query(`SELECT * FROM v_toc
		WHERE book_id = ${book.id}
		ORDER BY ordinal`);
	await indexDocs(Heading.INDEX, headings);
	var items = await global.query(`SELECT * FROM v_hadiths
		WHERE book_id = ${book.id}
		ORDER BY ordinal`);
	await indexDocs(Item.INDEX, items);
}

async function indexDocs(indexName, recs) {
	logfile(`reindexing ${recs.length} records in index ${indexName}...`);
	await Index.updateBulk(indexName, recs, true);
}

function logfile(message) {
	console.log(message);
	fs.appendFileSync('reindexItems.log', message + '\n');
}
