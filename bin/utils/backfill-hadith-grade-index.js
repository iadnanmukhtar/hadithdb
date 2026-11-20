#!/usr/bin/env node
'use strict';

const mysql = require('mysql');
const { promisify } = require('util');
const GradeIndex = require('../../lib/HadithGradeIndex');
const SearchHttp = require('../../lib/SearchHttp');

// Run after all index writers have been updated. Uses existing physical
// documents only; a retry skips documents already upgraded by an edit.
async function main() {
	const apply = process.argv.includes('--apply');
	global.settings = require(require('os').homedir() + '/.hadithdb/settings.json');
	const db = mysql.createConnection(global.settings.mysql.connection);
	const query = promisify(db.query).bind(db);
	const domain = global.settings.search.domain;
	let last = 0, checked = 0, indexed = 0;
	try {
		for (;;) {
			const rows = await query(`SELECT h.id FROM hadiths h JOIN books b ON b.id=h.bookId
				WHERE h.id>${last} AND b.id<>0 AND b.virtual=0 ORDER BY h.id LIMIT 500`);
			if (!rows.length) break;
			const ids = rows.map(row => Number(row.id));
			if (apply) indexed += await GradeIndex.refresh(ids, query, true);
			else {
				const { data } = await SearchHttp.post(domain + '/hadiths/_mget', { ids: ids.map(String) },
					{ params: { _source: 'hId,grader_opinions_version' } });
				for (const doc of data.docs) {
					if (doc.error) throw Error(JSON.stringify(doc.error));
					if (doc.found && Number(doc._source.hId) === Number(doc._id) && doc._source.grader_opinions_version !== GradeIndex.VERSION) indexed++;
				}
			}
			checked += rows.length;
			last = ids.at(-1);
			if (checked % 10000 === 0) console.log({ checked, indexed, last });
		}
		if (apply && indexed) await SearchHttp.post(domain + '/hadiths/_refresh');
		console.log({ checked, [apply ? 'updated' : 'wouldUpdate']: indexed });
	} finally { db.end(); }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
