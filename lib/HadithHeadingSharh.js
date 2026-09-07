/* jslint node:true, esversion:11 */
'use strict';

const HadithBilingualPairs = require('./HadithBilingualPairs');

let schemaPromise = null;

async function ensureSchema(query = global.query) {
	if (schemaPromise) return schemaPromise;
	schemaPromise = query(`CREATE TABLE IF NOT EXISTS hdith_toc_sharh (
		id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
		toc_id INT NOT NULL,
		ordinal SMALLINT UNSIGNED NULL,
		source_id INT NOT NULL,
		source_entry_id INT NOT NULL,
		page_num INT NULL,
		title VARCHAR(255) NULL,
		title_en VARCHAR(255) NULL,
		text LONGTEXT NOT NULL,
		text_en LONGTEXT NULL,
		format VARCHAR(8) NOT NULL DEFAULT 'md',
		source_url VARCHAR(512) NOT NULL DEFAULT '',
		UNIQUE KEY hdith_toc_sharh_entry (toc_id, source_id, source_entry_id),
		KEY hdith_toc_sharh_source (source_id),
		CONSTRAINT hdith_toc_sharh_toc_fk FOREIGN KEY (toc_id) REFERENCES toc(id) ON DELETE CASCADE ON UPDATE CASCADE,
		CONSTRAINT hdith_toc_sharh_source_fk FOREIGN KEY (source_id) REFERENCES hdith_sharh_sources(id) ON DELETE CASCADE ON UPDATE CASCADE
	) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`).catch(err => {
		schemaPromise = null;
		throw err;
	});
	return schemaPromise;
}

async function attach(headings, query = global.query) {
	const list = (Array.isArray(headings) ? headings : [headings]).filter(Boolean);
	const ids = [...new Set(list.map(heading => Number(heading.id || heading.tId)).filter(Number.isSafeInteger))];
	for (const heading of list) heading.shuruh = [];
	if (!ids.length) return list;
	await ensureSchema(query);
	const [rows, managedPairs] = await Promise.all([query(`SELECT ts.id, ts.toc_id, ts.ordinal, ts.source_entry_id, ts.page_num,
		ts.text, ts.text_en, ts.format, ts.source_url,
		COALESCE(NULLIF(ts.title, ''), ss.title) AS title,
		COALESCE(NULLIF(ts.title_en, ''), NULLIF(ss.title_en, '')) AS title_en,
		ss.author, ss.source_book_id,
		(ss.source_book_id=-1) AS custom, (ss.source_book_id<0) AS local
		FROM hdith_toc_sharh ts JOIN hdith_sharh_sources ss ON ss.id=ts.source_id
		WHERE ts.toc_id IN (${ids.join(',')}) ORDER BY ts.toc_id, COALESCE(ts.ordinal, 65535), ts.id`),
		HadithBilingualPairs.managed('sharh_title', query)]);
	const byId = new Map(ids.map(id => [id, []]));
	for (const row of rows) {
		const pair = HadithBilingualPairs.resolve(managedPairs, 'sharh_title', row.title, row.title_en);
		byId.get(Number(row.toc_id))?.push(Object.assign({}, row, { title: pair.value_ar, title_en: pair.value_en }));
	}
	for (const heading of list) heading.shuruh = byId.get(Number(heading.id || heading.tId)) || [];
	return list;
}

function resetSchemaForTests() {
	schemaPromise = null;
}

module.exports = { attach, ensureSchema, resetSchemaForTests };
