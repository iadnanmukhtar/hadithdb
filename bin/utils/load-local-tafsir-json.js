#!/usr/bin/env node
/* jslint node:true, esversion:9 */
'use strict';

require('dotenv').config();
require('../../lib/Globals');
const fs = require('fs');
const path = require('path');
const MySQL = require('mysql');

const TAFSIRS = {
	'en-maarifulquran': {
		ordinal: 4,
		shortName_en: "Ma'ariful Qur'an",
		name_en: "Ma'ariful Qur'an",
		author_en: 'Mufti Muhammad Shafi',
		directory: 'data/en-maarifulquran'
	},
	'en-tazkirulquran': {
		ordinal: 5,
		shortName_en: 'Tazkirul Quran',
		name_en: 'Tazkirul Quran',
		author_en: 'Maulana Wahiduddin Khan',
		directory: 'data/en-tazkirulquran'
	}
};
const options = readOptions(process.argv.slice(2));

(async () => {
	const connection = await getConnection();
	try {
		const quran = await loadQuranAyahs(connection);
		for (const alias of options.aliases)
			await importTafsir(connection, alias, quran);
	} catch (err) {
		console.error(`ERROR: ${err.message}`);
		process.exitCode = 1;
	} finally {
		connection.release();
		global.dbPool.end();
	}
})();

async function importTafsir(connection, alias, quran) {
	const config = TAFSIRS[alias];
	const passages = loadPassages(config, quran);
	console.log(`${options.dryRun ? 'Checking' : 'Loading'} ${passages.length} '${alias}' passages...`);
	if (options.dryRun)
		return;

	await query(connection, 'START TRANSACTION');
	try {
		const bookCommentaryId = await upsertCommentary(connection, alias, config);
		for (let offset = 0; offset < passages.length; offset += 250)
			await upsertPassages(connection, bookCommentaryId, passages.slice(offset, offset + 250));
		await query(connection, 'COMMIT');
		console.log(`Loaded '${alias}'.`);
	} catch (err) {
		await query(connection, 'ROLLBACK');
		throw err;
	}
}

async function loadQuranAyahs(connection) {
	const rows = await query(connection, `
		SELECT id, num, body_en
		FROM hadiths
		WHERE bookId=0
			AND num REGEXP '^[0-9]+:[1-9][0-9]*$'`);
	const quran = new Map(rows.map(row => [row.num, row]));
	if (quran.size !== 6236)
		throw new Error(`Expected 6236 Quran ayahs, found ${quran.size}.`);
	return quran;
}

function loadPassages(config, quran) {
	const directory = path.resolve(__dirname, '../..', config.directory);
	const passages = [];
	const seen = new Set();
	for (let surah = 1; surah <= 114; surah++) {
		const filename = path.join(directory, `${surah}.json`);
		const document = JSON.parse(fs.readFileSync(filename, 'utf8'));
		if (!Array.isArray(document.ayahs))
			throw new Error(`${filename} does not contain an ayahs array.`);
		for (const ayah of document.ayahs) {
			const ref = `${surah}:${ayah.ayah}`;
			const quranAyah = quran.get(ref);
			if (!quranAyah)
				throw new Error(`Quran ayah '${ref}' was not found.`);
			if (ayah.surah !== surah || !Number.isInteger(ayah.ayah) || ayah.ayah < 1)
				throw new Error(`Invalid ayah in ${filename}: ${JSON.stringify(ayah)}`);
			if (seen.has(ref))
				throw new Error(`Duplicate ayah '${ref}' in ${filename}.`);
			seen.add(ref);
			passages.push({
				hadithId: quranAyah.id,
				surah,
				ayah: ayah.ayah,
				text_en: plainTextToMarkdown([quranAyah.body_en, ayah.text].filter(Boolean).join('\n\n'))
			});
		}
	}
	if (passages.length !== quran.size)
		throw new Error(`Expected ${quran.size} passages in '${config.directory}', found ${passages.length}.`);
	return passages;
}

async function upsertCommentary(connection, alias, config) {
	await query(connection, `
		INSERT INTO books_commentaries
			(ordinal, alias, type, shortName_en, hidden, source, lang, format, name_en, author_en)
		VALUES
			(${config.ordinal}, ${MySQL.escape(alias)}, 'tafsir', ${MySQL.escape(config.shortName_en)},
				0, 'local', 'en', 'md', ${MySQL.escape(config.name_en)}, ${MySQL.escape(config.author_en)})
		ON DUPLICATE KEY UPDATE
			ordinal=VALUES(ordinal),
			type=VALUES(type),
			shortName_en=VALUES(shortName_en),
			hidden=VALUES(hidden),
			source=VALUES(source),
			lang=VALUES(lang),
			format=VALUES(format),
			name_en=VALUES(name_en),
			author_en=VALUES(author_en)`);
	const rows = await query(connection, `
		SELECT id
		FROM books_commentaries
		WHERE alias=${MySQL.escape(alias)}
			AND source='local'
		LIMIT 1`);
	if (rows.length !== 1)
		throw new Error(`Local commentary '${alias}' was not found after upsert.`);
	return rows[0].id;
}

async function upsertPassages(connection, bookCommentaryId, passages) {
	const values = passages.map(passage => `(
		${bookCommentaryId},
		${passage.hadithId},
		${passage.surah},
		${passage.ayah},
		${passage.ayah},
		${passage.ayah},
		${MySQL.escape(passage.text_en)}
	)`).join(',\n');
	await query(connection, `
		INSERT INTO hadiths_commentary
			(bookCommentaryId, hadithId, surah, ayahFrom, ayahTo, passageNum, text_en)
		VALUES ${values}
		ON DUPLICATE KEY UPDATE
			hadithId=VALUES(hadithId),
			passageNum=VALUES(passageNum),
			text_en=VALUES(text_en)`);
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

function plainTextToMarkdown(text) {
	return text.split(/\n+/).filter(Boolean).map(line => {
		return line.replace(/[\\`*_[\]{}()#+\-.!|<>~]/g, '\\$&');
	}).join('\n\n');
}

function readOptions(argv) {
	const aliases = [];
	let dryRun = false;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--tafsir') {
			const alias = argv[++i];
			if (!TAFSIRS[alias])
				throw new Error(`Unknown tafsir '${alias || ''}'.`);
			aliases.push(alias);
		} else if (arg === '--dry-run')
			dryRun = true;
		else if (arg === '--help' || arg === '-h') {
			console.log(usage());
			process.exit(0);
		} else
			throw new Error(`Unknown option '${arg}'.\n\n${usage()}`);
	}
	return { aliases: aliases.length ? aliases : Object.keys(TAFSIRS), dryRun };
}

function usage() {
	return [
		'Usage: node bin/utils/load-local-tafsir-json.js [options]',
		'',
		'Loads bundled Quran.com tafsir JSON into local commentary rows.',
		'Each ayah stores the Quran translation first, followed by the commentary.',
		'',
		'Options:',
		'  --tafsir <alias>  Load only en-maarifulquran or en-tazkirulquran',
		'  --dry-run         Validate source files without changing MySQL',
		'  --help            Show this help'
	].join('\n');
}
