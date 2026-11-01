#!/usr/bin/env node
'use strict';

require('dotenv').config();
require('../../lib/Globals');

const Utils = require('../../lib/Utils');
const RuntimeRefresh = require('../../lib/RuntimeRefresh');

// Recompute hadiths.numInChapter for the 'history' sirah book as a sequential
// 1..N counter within each chapter (h1), ordered by ordinal. The original
// import assigned numInChapter relative to each leaf heading (h2 or h3), which
// reset the counter at subsection boundaries and scrambled the section-page
// sort order (items appeared as 1, 9, 2, 10, ...).
async function main() {
	const apply = process.argv.includes('--apply');
	const rows = await global.query(`
		SELECT h.id, h.h1, h.numInChapter
		FROM hadiths h
		JOIN books b ON b.id=h.bookId AND b.alias='history' AND b.type='sirah'
		ORDER BY h.ordinal, h.id`);

	let currentH1 = null;
	let counter = 0;
	const plan = rows.map(row => {
		const h1 = Number(row.h1);
		if (h1 !== currentH1) {
			currentH1 = h1;
			counter = 0;
		}
		counter++;
		return { id: row.id, numInChapter: counter };
	});

	const changed = plan.filter((item, index) => Number(rows[index].numInChapter) !== item.numInChapter).length;
	console.log(JSON.stringify({ apply, passages: rows.length, changed }));

	if (!apply)
		return;

	const result = await global.query(`
		UPDATE hadiths h
		JOIN (
			SELECT id, ROW_NUMBER() OVER (PARTITION BY h1 ORDER BY ordinal, id) AS rn
			FROM hadiths
			WHERE bookId = (SELECT id FROM books WHERE alias='history')
		) n ON n.id = h.id
		SET h.numInChapter = n.rn
		WHERE h.bookId = (SELECT id FROM books WHERE alias='history')`);
	if (Number(result.affectedRows) !== rows.length)
		throw new Error(`Expected to update ${rows.length} passages, updated ${result.affectedRows}`);

	await global.query("UPDATE books SET content_lastmod=NOW() WHERE alias='history'");
	await RuntimeRefresh.publish();
	await Promise.all([Utils.flushCacheContaining('history'), Utils.flushCacheContaining('book:history')]);
	console.log(`Renumbered ${rows.length} history passages. Rebuild the hadith index before serving them.`);
}

if (require.main === module)
	main().then(() => process.exit(0)).catch(error => {
		console.error(error.stack || error);
		process.exit(1);
	});
