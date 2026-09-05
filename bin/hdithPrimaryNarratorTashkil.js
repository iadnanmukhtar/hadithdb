#!/usr/bin/env node
/* jslint node:true, esversion:11 */
'use strict';

require('dotenv').config();
const fs = require('fs');
const mysql = require('mysql');
const path = require('path');
const util = require('util');
const { connectionSettings } = require('./initializeHadithAttributions');

const DEFAULT_FILE = path.join(__dirname, '..', 'data', 'hdith-primary-narrators.txt');
const HEADER = ['source_slug', 'name', 'name_tashkil', 'ala_lc', 'hadith_count'];
const LEGACY_HEADER = ['source_slug', 'name', 'name_tashkil', 'hadith_count'];

function cleanField(value) {
	return String(value || '').replace(/[\t\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function withoutTashkil(value) {
	return cleanField(value).normalize('NFKC').replace(/[ـً-ٰٟۖ-ۭ]/gu, '');
}

function serializeRows(rows) {
	return `${HEADER.join('\t')}\n${rows.map(row => [
		cleanField(row.source_slug), cleanField(row.name), cleanField(row.name_tashkil), cleanField(row.ala_lc), Number(row.hadith_count) || 0
	].join('\t')).join('\n')}\n`;
}

function parseCorrections(text) {
	const lines = String(text || '').replace(/^\uFEFF/u, '').split(/\r?\n/u).filter(line => line.trim());
	const header = lines[0] === HEADER.join('\t') ? HEADER : (lines[0] === LEGACY_HEADER.join('\t') ? LEGACY_HEADER : null);
	if (!header) throw new Error(`Expected tab-separated header: ${HEADER.join('\t')}`);
	return lines.slice(1).map((line, index) => {
		const fields = line.split('\t');
		if (fields.length !== header.length) throw new Error(`Line ${index + 2}: expected ${header.length} tab-separated fields.`);
		const [sourceSlug, name, nameTashkil, alaLc] = header === HEADER
			? fields.map(cleanField) : [cleanField(fields[0]), cleanField(fields[1]), cleanField(fields[2]), ''];
		if (!/^p-[0-9]+$/u.test(sourceSlug)) throw new Error(`Line ${index + 2}: invalid source_slug ${sourceSlug}.`);
		if (!name) throw new Error(`Line ${index + 2}: name is required.`);
		if (nameTashkil && withoutTashkil(nameTashkil) !== withoutTashkil(name))
			throw new Error(`Line ${index + 2}: name_tashkil must differ from name only by tashkil.`);
		if (nameTashkil && header === HEADER && !alaLc) throw new Error(`Line ${index + 2}: ala_lc is required.`);
		return { sourceSlug, name, nameTashkil, alaLc };
	}).filter(row => row.nameTashkil);
}

async function exportRows(query, file) {
	const rows = await query(`SELECT n.source_slug, n.name, COALESCE(n.name_tashkil, '') AS name_tashkil,
		COALESCE(n.name_ala_lc, '') AS ala_lc, COUNT(*) AS hadith_count
		FROM hdith_hadith_narrators hn JOIN hdith_narrators n ON n.id=hn.narrator_id
		WHERE hn.ordinal=1 GROUP BY n.id, n.source_slug, n.name, n.name_tashkil, n.name_ala_lc
		ORDER BY n.name, n.source_slug`);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, serializeRows(rows), 'utf8');
	return rows;
}

async function importCorrections(query, file) {
	const corrections = parseCorrections(fs.readFileSync(file, 'utf8'));
	await query('START TRANSACTION');
	try {
		let affectedHadiths = 0;
		for (const row of corrections) {
			const narrators = await query('SELECT id, name FROM hdith_narrators WHERE source_slug=? LIMIT 1', [row.sourceSlug]);
			if (!narrators.length) throw new Error(`Unknown narrator ${row.sourceSlug}.`);
			if (withoutTashkil(narrators[0].name) !== withoutTashkil(row.name))
				throw new Error(`${row.sourceSlug}: file name does not match the database name.`);
			await query('UPDATE hdith_narrators SET name_tashkil=?, name_ala_lc=? WHERE id=?',
				[row.nameTashkil, row.alaLc || null, narrators[0].id]);
			const result = await query(`UPDATE hdith_hadith_metadata m
				JOIN hdith_hadith_narrators hn ON hn.hadith_id=m.hadith_id AND hn.ordinal=1
				SET m.narrator=?, m.narrator_en=? WHERE hn.narrator_id=?`,
				[row.nameTashkil, row.alaLc || null, narrators[0].id]);
			affectedHadiths += result.affectedRows;
		}
		await query('COMMIT');
		return { corrections: corrections.length, affectedHadiths };
	} catch (err) {
		await query('ROLLBACK');
		throw err;
	}
}

async function ensureSchema(query) {
	const columns = await query(`SELECT 1 FROM information_schema.columns
		WHERE table_schema=DATABASE() AND table_name='hdith_narrators' AND column_name='name_tashkil' LIMIT 1`);
	if (!columns.length) await query('ALTER TABLE hdith_narrators ADD COLUMN name_tashkil TEXT NULL AFTER name');
	const alaLcColumns = await query(`SELECT 1 FROM information_schema.columns
		WHERE table_schema=DATABASE() AND table_name='hdith_narrators' AND column_name='name_ala_lc' LIMIT 1`);
	if (!alaLcColumns.length) await query('ALTER TABLE hdith_narrators ADD COLUMN name_ala_lc TEXT NULL AFTER name_tashkil');
}

async function main() {
	const action = process.argv[2] || 'export';
	const file = path.resolve(process.argv[3] || DEFAULT_FILE);
	if (!['export', 'import'].includes(action)) throw new Error('Usage: node bin/hdithPrimaryNarratorTashkil.js [export|import] [file]');
	const connection = mysql.createConnection(connectionSettings());
	const query = (sql, values) => util.promisify(connection.query).call(connection, sql, values);
	try {
		await util.promisify(connection.connect).call(connection);
		await ensureSchema(query);
		if (action === 'export') {
			const rows = await exportRows(query, file);
			console.log(`Exported ${rows.length} primary narrators to ${file}`);
		} else {
			const result = await importCorrections(query, file);
			console.log(`Imported ${result.corrections} corrected narrator names; updated ${result.affectedHadiths} hadith metadata rows.`);
		}
	} finally {
		await util.promisify(connection.end).call(connection);
	}
}

if (require.main === module)
	main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });

module.exports = { DEFAULT_FILE, HEADER, cleanField, importCorrections, parseCorrections, serializeRows, withoutTashkil };
