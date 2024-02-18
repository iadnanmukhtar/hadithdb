/* jslint node:true, esversion:9 */
'use strict';

require('../lib/Globals');
const fs = require('fs');
const Index = require('../lib/Index');
const { Item, Heading } = require('../lib/Model');

const date = '2024-01-11';

(async () => {
	try {
		await reindexItems();
		await reindexTOC();
	} finally {
		global.dbPool.end();
		logfile('indexing complete');
	}
})();

async function reindexItems() {
	var items = await global.query(`SELECT * FROM v_hadiths
		WHERE lastmod >= '${date}'
		ORDER BY ordinal`);
	await indexDocs(Item.INDEX, items);
}

async function reindexTOC() {
	var headings = await global.query(`SELECT * FROM v_toc
		WHERE lastmod >= '${date}'
		ORDER BY ordinal`);
	await indexDocs(Heading.INDEX, headings);
	var items = await global.query(`SELECT h.* FROM toc t, v_hadiths h
		WHERE t.id = h.tId AND t.lastmod >= '${date}'
		ORDER BY t.ordinal`);
	await indexDocs(Item.INDEX, items);
}



async function indexDocs(indexName, recs) {
	logfile(`\n*****\nreindexing ${recs.length} records in index ${indexName}...`);
	await Index.updateBulk(indexName, recs);
}

function logfile(message) {
	console.log(message);
	fs.appendFileSync('reindexItems.log', message + '\n');
}