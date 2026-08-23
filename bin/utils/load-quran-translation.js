#!/usr/bin/env node
/* jslint node:true, esversion:9 */
'use strict';

require('dotenv').config();
require('../../lib/Globals');

const fs = require('fs');
const path = require('path');
const MySQL = require('mysql');

const EXPECTED_AYAHS = 6236;
const BATCH_SIZE = 200;
const INLINE_MARKERS = Object.freeze({
	plural: 'pl',
	singular: 'sg',
	dual: 'dl'
});

const options = readOptions(process.argv.slice(2));

(async () => {
	try {
		const translations = loadTranslations(options.file);
		const book = await loadBook(options.alias);
		const rows = await loadRows(book.id);
		validateCoverage(translations, rows, book.alias);
		const changes = changedRows(translations, rows);
		if (options.dryRun) {
			console.log(`Would update ${changes.length} of ${EXPECTED_AYAHS} ${book.alias} row(s) from ${displayPath(options.file)}.`);
			return;
		}
		await updateTranslations(book.id, changes);
		console.log(`Updated ${changes.length} of ${EXPECTED_AYAHS} ${book.alias} row(s) from ${displayPath(options.file)}.`);
	} finally {
		global.dbPool.end();
	}
})().catch(err => {
	console.error(err.stack || err.message);
	process.exit(1);
});

function readOptions(argv) {
	const parsed = { alias: '', file: '', dryRun: false };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--alias') {
			parsed.alias = optionValue(argv, ++i, arg).trim();
		} else if (arg === '--file') {
			parsed.file = path.resolve(process.cwd(), optionValue(argv, ++i, arg));
		}
		else if (arg === '--dry-run')
			parsed.dryRun = true;
		else if (arg === '--help' || arg === '-h') {
			console.log(usage());
			process.exit(0);
		} else
			throw new Error(`Unknown option '${arg}'.\n\n${usage()}`);
	}
	if (!/^[A-Za-z0-9_-]+$/.test(parsed.alias))
		throw new Error(`--alias must be a local Quran translation alias.\n\n${usage()}`);
	if (!parsed.file)
		throw new Error(`--file is required.\n\n${usage()}`);
	return parsed;
}

function optionValue(argv, index, option) {
	const value = argv[index];
	if (!value || value.startsWith('--'))
		throw new Error(`${option} requires a value.\n\n${usage()}`);
	return value;
}

function usage() {
	return [
		'Usage: node bin/utils/load-quran-translation.js --alias <alias> --file <json> [options]',
		'',
		'Loads a complete 6,236-ayah JSON translation into an existing local translation book.',
		'Each JSON value may be a string or an object with a string `t` property.',
		'Annotations use [[plural]], [[singular]], [[dual]], or [[footnote text]].',
		'',
		'Options:',
		'  --alias <alias>  Existing local Quran translation alias',
		'  --file <json>    Source JSON keyed by surah:ayah',
		'  --dry-run        Validate and report changes without writing',
		'  --help           Show this help'
	].join('\n');
}

function displayPath(filename) {
	const relative = path.relative(process.cwd(), filename);
	return relative && !relative.startsWith('..') ? relative : filename;
}

function loadTranslations(filename) {
	const document = JSON.parse(fs.readFileSync(filename, 'utf8'));
	const entries = Object.entries(document);
	if (entries.length !== EXPECTED_AYAHS)
		throw new Error(`Expected ${EXPECTED_AYAHS} translations in ${filename}, found ${entries.length}.`);

	const translations = new Map();
	for (const [ref, value] of entries) {
		if (!/^[1-9][0-9]*:[1-9][0-9]*$/.test(ref))
			throw new Error(`Invalid Quran ref '${ref}' in ${filename}.`);
		const text = typeof value === 'string' ? value : value && value.t;
		if (typeof text !== 'string' || text.trim() === '')
			throw new Error(`Missing translation text for '${ref}' in ${filename}.`);
		translations.set(ref, parseTranslation(text.trim(), ref));
	}
	return translations;
}

function parseTranslation(source, ref) {
	const footnotes = [];
	const text = source.replace(/\[\[([\s\S]*?)\]\]/g, function (match, value) {
		value = value.trim();
		if (!value)
			throw new Error(`Empty annotation in '${ref}'.`);
		if (INLINE_MARKERS[value])
			return `<sup>${INLINE_MARKERS[value]}</sup>`;
		footnotes.push(value);
		return `[^${footnotes.length}]`;
	});
	if (text.includes('[[') || text.includes(']]'))
		throw new Error(`Unmatched annotation delimiter in '${ref}'.`);
	return {
		text: text,
		footnotes: footnotes.map((value, index) => `[^${index + 1}]: ${value}`).join('\n')
	};
}

async function loadBook(alias) {
	const rows = await global.query(`
		SELECT id, alias
		FROM books
		WHERE alias=${MySQL.escape(alias)}
			AND source='local'
			AND type='trans'
		LIMIT 2`);
	if (rows.length !== 1)
		throw new Error(`Expected one local translation book '${alias}', found ${rows.length}.`);
	return rows[0];
}

async function loadRows(bookId) {
	return global.query(`
		SELECT id, surah, ayahFrom, ayahTo, text_en, footnotes_en
		FROM hadiths_commentary
		WHERE bookId=${Number(bookId)}
			AND NOT (surah=1 AND ayahFrom=0 AND ayahTo=0)
		ORDER BY surah, ayahFrom, ayahTo, id`);
}

function validateCoverage(translations, rows, alias) {
	if (rows.length !== EXPECTED_AYAHS)
		throw new Error(`Expected ${EXPECTED_AYAHS} ${alias} rows, found ${rows.length}.`);
	const refs = new Set();
	for (const row of rows) {
		if (Number(row.ayahFrom) !== Number(row.ayahTo))
			throw new Error(`Expected a single-ayah row, found ${row.surah}:${row.ayahFrom}-${row.ayahTo}.`);
		const ref = `${Number(row.surah)}:${Number(row.ayahFrom)}`;
		if (refs.has(ref))
			throw new Error(`Duplicate ${alias} row '${ref}'.`);
		if (!translations.has(ref))
			throw new Error(`${alias} row '${ref}' has no source translation.`);
		refs.add(ref);
	}
	for (const ref of translations.keys()) {
		if (!refs.has(ref))
			throw new Error(`Translation source contains '${ref}', but no matching ${alias} row exists.`);
	}
}

function changedRows(translations, rows) {
	return rows.flatMap(row => {
		const ref = `${Number(row.surah)}:${Number(row.ayahFrom)}`;
		const next = translations.get(ref);
		return (row.text_en || '') === next.text && (row.footnotes_en || '') === next.footnotes
			? []
			: [{ id: Number(row.id), ...next }];
	});
}

async function updateTranslations(bookId, changes) {
	const connection = await getConnection();
	try {
		await query(connection, 'START TRANSACTION');
		for (let i = 0; i < changes.length; i += BATCH_SIZE)
			await updateBatch(connection, changes.slice(i, i + BATCH_SIZE));
		if (changes.length)
			await query(connection, `UPDATE books SET content_lastmod=CURRENT_TIMESTAMP() WHERE id=${Number(bookId)}`);
		await query(connection, 'COMMIT');
	} catch (err) {
		await query(connection, 'ROLLBACK');
		throw err;
	} finally {
		connection.release();
	}
}

function getConnection() {
	return new Promise((resolve, reject) => {
		global.dbPool.getConnection((err, connection) => err ? reject(err) : resolve(connection));
	});
}

function query(connection, sql) {
	return new Promise((resolve, reject) => {
		connection.query(sql, (err, result) => err ? reject(err) : resolve(result));
	});
}

async function updateBatch(connection, rows) {
	const values = rows.map(row =>
		`SELECT ${row.id} AS id, ${MySQL.escape(row.text)} AS text_en, ${MySQL.escape(row.footnotes)} AS footnotes_en`
	).join(' UNION ALL ');
	await query(connection, `
		UPDATE hadiths_commentary hc
		JOIN (${values}) vals ON vals.id=hc.id
		SET hc.text_en=vals.text_en,
			hc.footnotes_en=vals.footnotes_en,
			hc.lastmod=CURRENT_TIMESTAMP()`);
}
