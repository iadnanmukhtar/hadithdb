#!/usr/bin/env node
/* jslint node:true, esversion:11 */
'use strict';

require('dotenv').config();
const fs = require('fs');
const mysql = require('mysql');
const path = require('path');
const util = require('util');
const zlib = require('zlib');
const Arabic = require('../lib/Arabic');
const { sourceNarratorNames, vocalizedNarratorName } = require('../lib/HdithMetadata');
const { CACHE_DIR, parsePrimaryNarrator } = require('./utils/import-hdith-six-books-enrichment');
const { connectionSettings } = require('./initializeHadithAttributions');

function cachedNarrators(options = {}) {
	const rows = [];
	let cacheFilesUpdated = 0;
	if (!fs.existsSync(CACHE_DIR)) return rows;
	for (const sourceBookSlug of fs.readdirSync(CACHE_DIR).filter(name => /^b-\d+$/.test(name))) {
		const directory = path.join(CACHE_DIR, sourceBookSlug);
		if (!fs.statSync(directory).isDirectory()) continue;
		for (const filename of fs.readdirSync(directory).filter(name => /^\d+\.json(?:\.gz)?$/.test(name))) {
			const file = path.join(directory, filename);
			const buffer = fs.readFileSync(file);
			const payload = JSON.parse((filename.endsWith('.gz') ? zlib.gunzipSync(buffer) : buffer).toString());
			const hadith = payload.hadith || payload;
			const sourceEntryId = Number(hadith.id);
			const capturedNarrator = compactNarrator(hadith.narrator || hadith.isnad?.[0]?.name);
			if (options.updateCaches && !hadith.narrator && capturedNarrator) {
				hadith.narrator = capturedNarrator;
				const serialized = Buffer.from(JSON.stringify(payload));
				const temporary = `${file}.${process.pid}.tmp`;
				fs.writeFileSync(temporary, filename.endsWith('.gz') ? zlib.gzipSync(serialized, { level: 1 }) : serialized);
				fs.renameSync(temporary, file);
				cacheFilesUpdated++;
			}
			const narrator = parsePrimaryNarrator(hadith);
			if (Number.isSafeInteger(sourceEntryId) && sourceEntryId > 0 && narrator) {
				rows.push([sourceBookSlug, sourceEntryId, narrator, Arabic.toALALCName(narrator)]);
			}
		}
	}
	rows.cacheFilesUpdated = cacheFilesUpdated;
	return rows;
}

function compactNarrator(value) {
	return String(value || '').replace(/^رواه\s+/u, '').replace(/\s+/g, ' ').trim();
}

async function ensureColumns(query) {
	const columns = new Map((await query('SHOW COLUMNS FROM hdith_hadith_metadata')).map(row => [row.Field, row.Type]));
	if (!columns.has('narrator'))
		await query('ALTER TABLE hdith_hadith_metadata ADD COLUMN narrator TEXT NULL AFTER chain_type');
	else if (!/text/i.test(columns.get('narrator')))
		await query('ALTER TABLE hdith_hadith_metadata MODIFY narrator TEXT NULL');
	if (!columns.has('narrator_en'))
		await query('ALTER TABLE hdith_hadith_metadata ADD COLUMN narrator_en TEXT NULL AFTER narrator');
	else if (!/text/i.test(columns.get('narrator_en')))
		await query('ALTER TABLE hdith_hadith_metadata MODIFY narrator_en TEXT NULL');
}

async function main() {
	const rows = cachedNarrators({ updateCaches: true });
	const connection = mysql.createConnection(connectionSettings());
	const query = (sql, values) => util.promisify(connection.query).call(connection, sql, values);
	try {
		await util.promisify(connection.connect).call(connection);
		await ensureColumns(query);
		await query(`CREATE TEMPORARY TABLE hdith_narrator_backfill (
			source_book_slug VARCHAR(16) NOT NULL, source_entry_id INT NOT NULL,
			narrator TEXT NOT NULL, narrator_en TEXT NOT NULL,
			PRIMARY KEY (source_book_slug, source_entry_id)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
		for (let offset = 0; offset < rows.length; offset += 500) {
			const batch = rows.slice(offset, offset + 500);
			await query(`INSERT INTO hdith_narrator_backfill (source_book_slug, source_entry_id, narrator, narrator_en)
				VALUES ${batch.map(() => '(?, ?, ?, ?)').join(',')}
				ON DUPLICATE KEY UPDATE narrator=VALUES(narrator), narrator_en=VALUES(narrator_en)`, batch.flat());
		}
		const cacheResult = await query(`UPDATE hdith_hadith_metadata m JOIN hdith_narrator_backfill b
			ON b.source_book_slug=m.source_book_slug AND b.source_entry_id=m.source_entry_id
			SET m.narrator=b.narrator, m.narrator_en=b.narrator_en
			WHERE NOT (m.narrator <=> b.narrator) OR NOT (m.narrator_en <=> b.narrator_en)`);

		const fallbacks = await query(`SELECT m.hadith_id, m.source_isnad_html, n.source_slug, n.source_url, n.name
			FROM hdith_hadith_metadata m
			JOIN hdith_hadith_narrators hn ON hn.hadith_id=m.hadith_id AND hn.ordinal=1
			JOIN hdith_narrators n ON n.id=hn.narrator_id
			WHERE m.narrator IS NULL OR m.narrator=''`);
		await query(`CREATE TEMPORARY TABLE hdith_narrator_fallback_values (
			hadith_id INT NOT NULL PRIMARY KEY, narrator TEXT NOT NULL, narrator_en TEXT NOT NULL
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
		for (let offset = 0; offset < fallbacks.length; offset += 500) {
			const batch = fallbacks.slice(offset, offset + 500).map(row => {
				const narrator = vocalizedNarratorName(row, sourceNarratorNames(row.source_isnad_html));
				return [narrator, Arabic.toALALCName(narrator), row.hadith_id];
			});
			if (batch.length)
				await query(`INSERT INTO hdith_narrator_fallback_values (narrator, narrator_en, hadith_id) VALUES ${batch.map(() => '(?, ?, ?)').join(',')}`, batch.flat());
		}
		const fallbackResult = fallbacks.length ? await query(`UPDATE hdith_hadith_metadata m JOIN hdith_narrator_fallback_values f ON f.hadith_id=m.hadith_id
			SET m.narrator=f.narrator, m.narrator_en=f.narrator_en`) : { affectedRows: 0 };
		console.log(`cached=${rows.length} cache_files_updated=${rows.cacheFilesUpdated} database_cache_updated=${cacheResult.affectedRows} relation_fallback_updated=${fallbackResult.affectedRows}`);
	} finally {
		await util.promisify(connection.end).call(connection);
	}
}

if (require.main === module)
	main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });

module.exports = { CACHE_DIR, cachedNarrators };
