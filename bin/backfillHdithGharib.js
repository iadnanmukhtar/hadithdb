#!/usr/bin/env node
/* jslint node:true, esversion:11 */
'use strict';

require('dotenv').config();
const fs = require('fs');
const mysql = require('mysql');
const path = require('path');
const util = require('util');
const zlib = require('zlib');
const { parseGharib } = require('./utils/import-hdith-six-books-enrichment');
const { connectionSettings } = require('./initializeHadithAttributions');

const CACHE_DIR = process.env.HDITH_CACHE_DIR || '/tmp/hadithdb-hdith-six-books-enrichment';

function cachedGharib() {
	const rows = [];
	if (!fs.existsSync(CACHE_DIR)) return rows;
	for (const sourceBookSlug of fs.readdirSync(CACHE_DIR).filter(name => /^b-\d+$/.test(name))) {
		const directory = path.join(CACHE_DIR, sourceBookSlug);
		if (!fs.statSync(directory).isDirectory()) continue;
		for (const filename of fs.readdirSync(directory)) {
			if (!/\.json(?:\.gz)?$/.test(filename)) continue;
			const buffer = fs.readFileSync(path.join(directory, filename));
			const json = filename.endsWith('.gz') ? zlib.gunzipSync(buffer) : buffer;
			const payload = JSON.parse(json.toString());
			const hadith = payload.hadith || payload;
			const sourceEntryId = Number(hadith.id);
			const gharib = parseGharib(hadith.gharib);
			if (Number.isSafeInteger(sourceEntryId) && sourceEntryId > 0 && gharib.length)
				rows.push([sourceBookSlug, sourceEntryId, JSON.stringify(gharib)]);
		}
	}
	return rows;
}

async function main() {
	const rows = cachedGharib();
	const connection = mysql.createConnection(connectionSettings());
	const query = (sql, values) => util.promisify(connection.query).call(connection, sql, values);
	try {
		await util.promisify(connection.connect).call(connection);
		const columns = await query(`SELECT 1 FROM information_schema.columns
			WHERE table_schema=DATABASE() AND table_name='hdith_hadith_metadata' AND column_name='gharib_json' LIMIT 1`);
		if (!columns.length)
			await query('ALTER TABLE hdith_hadith_metadata ADD COLUMN gharib_json JSON NULL AFTER chain_type');
		await query(`CREATE TEMPORARY TABLE hdith_gharib_backfill (
			source_book_slug VARCHAR(16) NOT NULL, source_entry_id INT NOT NULL, gharib_json JSON NOT NULL,
			PRIMARY KEY (source_book_slug, source_entry_id)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
		for (let offset = 0; offset < rows.length; offset += 250) {
			const batch = rows.slice(offset, offset + 250);
			await query(`INSERT INTO hdith_gharib_backfill (source_book_slug, source_entry_id, gharib_json)
				VALUES ${batch.map(() => '(?, ?, ?)').join(',')}
				ON DUPLICATE KEY UPDATE gharib_json=VALUES(gharib_json)`, batch.flat());
		}
		const result = await query(`UPDATE hdith_hadith_metadata m JOIN hdith_gharib_backfill b
			ON b.source_book_slug=m.source_book_slug AND b.source_entry_id=m.source_entry_id
			SET m.gharib_json=b.gharib_json`);
		console.log(`cached=${rows.length} updated=${result.affectedRows}`);
	} finally {
		await util.promisify(connection.end).call(connection);
	}
}

if (require.main === module)
	main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });

module.exports = { CACHE_DIR, cachedGharib };
