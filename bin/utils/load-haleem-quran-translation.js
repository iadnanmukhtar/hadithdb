#!/usr/bin/env node
/* jslint node:true, esversion:9 */
'use strict';

require('dotenv').config();
require('../../lib/Globals');

const fs = require('fs');
const path = require('path');
const MySQL = require('mysql');

const SOURCE_FILE = path.resolve(__dirname, '../../data/haleem.json');
const EXPECTED_AYAHS = 6236;
const BATCH_SIZE = 250;

(async () => {
	try {
		const translations = loadTranslations(SOURCE_FILE);
		const existingRefs = await loadQuranRefs();
		validateCoverage(translations, existingRefs);
		const changed = await updateTranslations(translations);
		console.log(`Updated ${changed} Quran translation row(s) from ${path.relative(process.cwd(), SOURCE_FILE)}.`);
	} finally {
		global.dbPool.end();
	}
})().catch(err => {
	console.error(err.message);
	process.exit(1);
});

function loadTranslations(filename) {
	const document = JSON.parse(fs.readFileSync(filename, 'utf8'));
	const entries = Object.entries(document);
	if (entries.length !== EXPECTED_AYAHS)
		throw new Error(`Expected ${EXPECTED_AYAHS} translations in ${filename}, found ${entries.length}.`);

	const translations = new Map();
	for (const [ref, value] of entries) {
		if (!/^[1-9][0-9]*:[1-9][0-9]*$/.test(ref))
			throw new Error(`Invalid Quran ref '${ref}' in ${filename}.`);
		if (!value || typeof value.t !== 'string' || value.t.trim() === '')
			throw new Error(`Missing translation text for '${ref}' in ${filename}.`);
		if (translations.has(ref))
			throw new Error(`Duplicate Quran ref '${ref}' in ${filename}.`);
		translations.set(ref, value.t.trim());
	}
	return translations;
}

async function loadQuranRefs() {
	const rows = await global.query(`
		SELECT num
		FROM hadiths
		WHERE bookId=0
			AND num REGEXP '^[0-9]+:[1-9][0-9]*$'`);
	const refs = new Set(rows.map(row => row.num));
	if (refs.size !== EXPECTED_AYAHS)
		throw new Error(`Expected ${EXPECTED_AYAHS} Quran ayah rows in hadiths, found ${refs.size}.`);
	return refs;
}

function validateCoverage(translations, existingRefs) {
	for (const ref of translations.keys()) {
		if (!existingRefs.has(ref))
			throw new Error(`Translation source contains '${ref}', but no matching Quran row exists.`);
	}
	for (const ref of existingRefs) {
		if (!translations.has(ref))
			throw new Error(`Quran row '${ref}' has no Haleem translation.`);
	}
}

async function updateTranslations(translations) {
	let changed = 0;
	await global.query('START TRANSACTION');
	try {
		const rows = Array.from(translations.entries());
		for (let i = 0; i < rows.length; i += BATCH_SIZE)
			changed += await updateBatch(rows.slice(i, i + BATCH_SIZE));
		await global.query('COMMIT');
		return changed;
	} catch (err) {
		await global.query('ROLLBACK');
		throw err;
	}
}

async function updateBatch(rows) {
	const selects = rows.map(([ref, text]) =>
		`SELECT ${MySQL.escape(ref)} AS num, ${MySQL.escape(text)} AS body_en`
	).join(' UNION ALL ');
	const result = await global.query(`
		UPDATE hadiths h
		JOIN (${selects}) vals ON vals.num=h.num
		SET h.body_en=vals.body_en,
			h.lastfixed=CURRENT_TIMESTAMP()
		WHERE h.bookId=0
			AND BINARY COALESCE(h.body_en, '') <> BINARY vals.body_en`);
	return result.changedRows || result.affectedRows || 0;
}
