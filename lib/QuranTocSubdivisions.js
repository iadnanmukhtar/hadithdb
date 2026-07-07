/* jslint node:true, esversion:9 */
'use strict';

const MySQL = require('mysql');

let columnsEnsured = false;

async function ensureColumns() {
	if (columnsEnsured)
		return;
	await ensureColumn('quran_subdivision', 'varchar(16) NULL');
	await ensureColumn('quran_verse_mapping', 'json NULL');
	columnsEnsured = true;
}

async function ensureColumn(name, definition) {
	var rows = await global.query(`SHOW COLUMNS FROM toc LIKE ${MySQL.escape(name)}`);
	if (rows.length > 0)
		return;
	await global.query(`ALTER TABLE toc ADD COLUMN ${name} ${definition}`);
}

async function juzRows() {
	await ensureColumns();
	var rows = await global.query(`
		SELECT id, h1 AS num, title_en, title, start, end, count, quran_verse_mapping
		FROM toc
		WHERE bookId=(SELECT id FROM books WHERE alias='quran' LIMIT 1)
			AND quran_subdivision='juz'
		ORDER BY h1`);
	return rows.map(normalizeJuzRow);
}

function normalizeJuzRow(row) {
	var mapping = row.quran_verse_mapping;
	if (typeof mapping === 'string' && mapping.trim() !== '') {
		try {
			mapping = JSON.parse(mapping);
		} catch (err) {
			mapping = {};
		}
	}
	row.num = Number(row.num);
	row.count = Number(row.count) || 0;
	row.quran_verse_mapping = mapping && typeof mapping === 'object' ? mapping : {};
	return row;
}

module.exports = {
	ensureColumns,
	juzRows
};
