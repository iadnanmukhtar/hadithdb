#!/usr/bin/env node
/* jslint node:true, esversion:9 */
'use strict';

require('dotenv').config();
const { execFileSync } = require('child_process');
const mysql = require('mysql');
const os = require('os');
const path = require('path');

async function run(argv = process.argv.slice(2)) {
	const options = readOptions(argv);
	const db = await connectDb();
	let backupTable = null;
	let changed = false;
	try {
		const book = await getBook(db, options.alias);
		const sourceColumn = resolveSourceColumn(book, options);
		const quranSurahs = await getQuranSurahs(db);
		const rows = await getRows(db, book.id, sourceColumn);
		const originalCoverage = validateCoverage(rows, quranSurahs, options.alias);
		const groups = findMergeGroups(rows);
		const rowsRemoved = groups.reduce((total, group) => total + group.deleteIds.length, 0);
		const eligibleRows = rows.filter(row => commentaryAfterTranslation(row.sourceText)).length;

		console.log(`${options.dryRun ? 'Checking' : 'Compacting'} '${options.alias}' ${sourceColumn} by commentary after each leading translation.`);
		console.log(`Found ${groups.length} range(s) to merge and ${rowsRemoved} duplicate row(s) to remove from ${rows.length} rows.`);
		if (eligibleRows !== rows.length)
			console.log(`Skipping ${rows.length - eligibleRows} row(s) without commentary after a leading translation.`);
		if (options.showRanges) {
			for (const group of groups)
				console.log(`${group.surah}:${group.ayahFrom}-${group.ayahTo} keep=${group.keepId} delete=${group.deleteIds.join(',')}`);
		}

		if (options.dryRun || groups.length < 1)
			return;

		backupTable = await createBackup(db, book.id);
		await query(db, 'START TRANSACTION');
		try {
			await mergeGroups(db, groups, sourceColumn);
			await query(db, `
				UPDATE hadiths_commentary
				SET passageNum=ayahFrom
				WHERE bookId=${Number(book.id)}`);
			await query(db, `
				UPDATE books
				SET content_lastmod=CURRENT_TIMESTAMP()
				WHERE id=${Number(book.id)}`);
			const updatedRows = await getRows(db, book.id, sourceColumn);
			validateCoverage(updatedRows, quranSurahs, options.alias, originalCoverage);
			const remainingGroups = findMergeGroups(updatedRows);
			if (remainingGroups.length > 0)
				throw new Error(`Verification found ${remainingGroups.length} mergeable range(s) after compaction.`);
			if (updatedRows.length !== rows.length - rowsRemoved)
				throw new Error(`Expected ${rows.length - rowsRemoved} rows after compaction, found ${updatedRows.length}.`);
			await query(db, 'COMMIT');
			changed = true;
			console.log(`Backup table: ${backupTable}`);
			console.log(`Compacted '${options.alias}' to ${updatedRows.length} passages; its ${originalCoverage.size}-ayah coverage is unchanged.`);
		} catch (err) {
			await query(db, 'ROLLBACK');
			throw err;
		}
	} finally {
		await closeDb(db);
	}

	if (changed && options.buildIndex) {
		console.log(`Rebuilding the commentary index for '${options.alias}'...`);
		execFileSync(process.execPath, [
			path.resolve(__dirname, '../buildCommentariesIndex.js'),
			'--tafsir', options.alias
		], {
			stdio: 'inherit',
			env: Object.assign({}, process.env, {
				COMMENTARY_INDEX_BATCH_SIZE: process.env.COMMENTARY_INDEX_BATCH_SIZE || '25'
			})
		});
	}
}

async function getBook(db, alias) {
	const rows = await query(db, `
		SELECT id, alias, type, source, lang
		FROM books
		WHERE alias=${mysql.escape(alias)}
		LIMIT 1`);
	if (rows.length !== 1)
		throw new Error(`Commentary '${alias}' was not found.`);
	const book = rows[0];
	if (book.type !== 'tafsir' || book.source !== 'local')
		throw new Error(`'${alias}' must be a local tafsir; found type='${book.type}', source='${book.source}'.`);
	return book;
}

function resolveSourceColumn(book, options = {}) {
	if (options.column) {
		if (!['text', 'text_en'].includes(options.column))
			throw new Error(`Unsupported commentary column '${options.column}'. Use 'text' or 'text_en'.`);
		return options.column;
	}
	const languages = String(book && book.lang || '').toLowerCase().split('-').filter(Boolean);
	let language = String(options.language || '').toLowerCase();
	if (language && !/^[a-z][a-z0-9]{1,15}$/.test(language))
		throw new Error(`Invalid language code '${options.language}'.`);
	if (language && languages.length > 0 && !languages.includes(language))
		throw new Error(`'${book.alias}' does not declare language '${language}' (lang='${book.lang}').`);
	if (!language) {
		if (languages.length !== 1)
			throw new Error(`'${book.alias}' declares multiple languages (${book.lang}); specify --language or --column.`);
		language = languages[0];
	}
	return language === 'en' ? 'text_en' : 'text';
}

async function getQuranSurahs(db) {
	const rows = await query(db, `
		SELECT CAST(SUBSTRING_INDEX(num, ':', 1) AS UNSIGNED) AS surah, COUNT(*) AS ayahCount
		FROM hadiths
		WHERE bookId=0
			AND num REGEXP '^[0-9]+:[1-9][0-9]*$'
		GROUP BY CAST(SUBSTRING_INDEX(num, ':', 1) AS UNSIGNED)
		ORDER BY surah`);
	return new Map(rows.map(row => [Number(row.surah), Number(row.ayahCount)]));
}

async function getRows(db, bookId, sourceColumn) {
	if (!['text', 'text_en'].includes(sourceColumn))
		throw new Error(`Unsupported commentary column '${sourceColumn}'.`);
	return query(db, `
		SELECT id, bookId, hadithId, surah, ayahFrom, ayahTo, passageNum, ${sourceColumn} AS sourceText
		FROM hadiths_commentary
		WHERE bookId=${Number(bookId)}
		ORDER BY surah, ayahFrom, ayahTo, id`);
}

function splitTranslationAndCommentary(text) {
	const value = String(text || '').replace(/\r\n?/g, '\n');
	const separator = /\n[ \t]*\n/.exec(value);
	if (!separator)
		return null;
	const translation = value.slice(0, separator.index).trim();
	const commentary = value.slice(separator.index + separator[0].length).trim();
	return translation && commentary ? { translation, commentary } : null;
}

function commentaryAfterTranslation(text) {
	const parts = splitTranslationAndCommentary(text);
	return parts ? parts.commentary : null;
}

function prefixedTranslation(translation, ayahFrom, ayahTo) {
	const label = Number(ayahTo) > Number(ayahFrom) ? `${Number(ayahFrom)}-${Number(ayahTo)}` : `${Number(ayahFrom)}`;
	const value = String(translation || '').replace(/\s*\n\s*/g, ' ').trim();
	return `${label}. ${value}`;
}

function mergedSourceText(translations, commentary) {
	return `${translations.map(item => prefixedTranslation(item.translation, item.ayahFrom, item.ayahTo)).join('\n')}\n\n${commentary}`;
}

function appendMergeGroup(groups, group) {
	if (!group || group.deleteIds.length < 1)
		return;
	group.sourceText = mergedSourceText(group.translations, group.commentary);
	groups.push(group);
}

function findMergeGroups(rows) {
	const groups = [];
	let current = null;

	for (const row of rows) {
		const parts = splitTranslationAndCommentary(row.sourceText);
		if (!current || !parts ||
			row.bookId !== current.bookId ||
			row.surah !== current.surah ||
			Number(row.ayahFrom) !== current.ayahTo + 1 ||
			parts.commentary !== current.commentary) {
			appendMergeGroup(groups, current);
			current = {
				bookId: row.bookId,
				surah: Number(row.surah),
				ayahFrom: Number(row.ayahFrom),
				ayahTo: Number(row.ayahTo),
				keepId: row.id,
				commentary: parts && parts.commentary,
				translations: parts ? [{
					ayahFrom: Number(row.ayahFrom),
					ayahTo: Number(row.ayahTo),
					translation: parts.translation
				}] : [],
				deleteIds: []
			};
			continue;
		}

		current.ayahTo = Number(row.ayahTo);
		current.translations.push({
			ayahFrom: Number(row.ayahFrom),
			ayahTo: Number(row.ayahTo),
			translation: parts.translation
		});
		current.deleteIds.push(row.id);
	}

	appendMergeGroup(groups, current);
	return groups;
}

function validateCoverage(rows, quranSurahs, alias, expectedCoverage) {
	if (quranSurahs.size !== 114)
		throw new Error(`Expected 114 Quran surahs, found ${quranSurahs.size}.`);
	const previousTo = new Map();
	const coverage = new Set();
	for (const row of rows) {
		const surah = Number(row.surah);
		const ayahFrom = Number(row.ayahFrom);
		const ayahTo = Number(row.ayahTo);
		const ayahCount = quranSurahs.get(surah);
		if (!Number.isInteger(surah) || !Number.isInteger(ayahFrom) || !Number.isInteger(ayahTo) ||
			!ayahCount || ayahFrom < 1 || ayahTo < ayahFrom || ayahTo > ayahCount)
			throw new Error(`'${alias}' has an invalid Quran range at ${surah}:${ayahFrom}-${ayahTo}.`);
		if (previousTo.has(surah) && ayahFrom <= previousTo.get(surah))
			throw new Error(`'${alias}' has overlapping or out-of-order ranges at ${surah}:${ayahFrom}-${ayahTo}.`);
		previousTo.set(surah, ayahTo);
		for (let ayah = ayahFrom; ayah <= ayahTo; ayah++)
			coverage.add(`${surah}:${ayah}`);
	}
	if (expectedCoverage) {
		if (coverage.size !== expectedCoverage.size)
			throw new Error(`'${alias}' coverage changed from ${expectedCoverage.size} to ${coverage.size} ayahs.`);
		for (const ref of expectedCoverage) {
			if (!coverage.has(ref))
				throw new Error(`'${alias}' no longer covers ${ref}.`);
		}
	}
	return coverage;
}

async function createBackup(db, bookId) {
	const table = `hadiths_commentary_backup_compact_ranges_${timestamp()}`;
	await query(db, `CREATE TABLE ${table} LIKE hadiths_commentary`);
	await query(db, `
		INSERT INTO ${table}
		SELECT *
		FROM hadiths_commentary
		WHERE bookId=${Number(bookId)}`);
	return table;
}

async function mergeGroups(db, groups, sourceColumn) {
	if (!['text', 'text_en'].includes(sourceColumn))
		throw new Error(`Unsupported commentary column '${sourceColumn}'.`);
	for (let offset = 0; offset < groups.length; offset += 25) {
		const batch = groups.slice(offset, offset + 25);
		await query(db, `
			UPDATE hadiths_commentary
			SET ayahTo=CASE id
				${batch.map(group => `WHEN ${Number(group.keepId)} THEN ${group.ayahTo}`).join('\n\t\t\t\t')}
			END,
				${sourceColumn}=CASE id
				${batch.map(group => `WHEN ${Number(group.keepId)} THEN ${mysql.escape(group.sourceText)}`).join('\n\t\t\t\t')}
			END,
				passageNum=ayahFrom,
				lastmod=CURRENT_TIMESTAMP()
			WHERE id IN (${batch.map(group => Number(group.keepId)).join(',')})`);
	}

	const deleteIds = groups.flatMap(group => group.deleteIds).map(Number);
	for (let offset = 0; offset < deleteIds.length; offset += 1000) {
		const batch = deleteIds.slice(offset, offset + 1000);
		await query(db, `
			DELETE FROM hadiths_commentary
			WHERE id IN (${batch.join(',')})`);
	}
}

function connectDb() {
	const settings = require(path.join(os.homedir(), '.hadithdb', 'settings.json'));
	const db = mysql.createConnection(settings.mysql.connection);
	return new Promise((resolve, reject) => db.connect(err => err ? reject(err) : resolve(db)));
}

function query(db, sql) {
	return new Promise((resolve, reject) => db.query({ sql, timeout: 600000 }, (err, result) => err ? reject(err) : resolve(result)));
}

function closeDb(db) {
	return new Promise((resolve, reject) => db.end(err => err ? reject(err) : resolve()));
}

function timestamp() {
	const now = new Date();
	return [
		now.getFullYear(),
		pad(now.getMonth() + 1),
		pad(now.getDate()),
		pad(now.getHours()),
		pad(now.getMinutes()),
		pad(now.getSeconds()),
		String(now.getMilliseconds()).padStart(3, '0')
	].join('');
}

function pad(value) {
	return String(value).padStart(2, '0');
}

function readOptions(argv) {
	const options = {
		alias: '',
		language: '',
		column: '',
		dryRun: true,
		showRanges: false,
		buildIndex: true
	};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--alias')
			options.alias = requiredValue(argv, ++i, arg);
		else if (arg === '--language' || arg === '--lang')
			options.language = requiredValue(argv, ++i, arg);
		else if (arg === '--column')
			options.column = requiredValue(argv, ++i, arg);
		else if (arg === '--apply')
			options.dryRun = false;
		else if (arg === '--dry-run')
			options.dryRun = true;
		else if (arg === '--show-ranges')
			options.showRanges = true;
		else if (arg === '--no-index')
			options.buildIndex = false;
		else if (arg === '--help' || arg === '-h') {
			console.log(usage());
			return process.exit(0);
		} else
			throw new Error(`Unknown option '${arg}'.\n\n${usage()}`);
	}
	if (!options.alias)
		throw new Error(`--alias is required.\n\n${usage()}`);
	return options;
}

function requiredValue(argv, index, option) {
	if (!argv[index] || argv[index].startsWith('--'))
		throw new Error(`${option} requires a value.`);
	return argv[index];
}

function usage() {
	return [
		'Usage: node bin/utils/compact-tafsir-translation-ranges.js --alias <alias> [options]',
		'',
		'Combines consecutive local tafsir rows whose commentary is identical after',
		'the leading ayah-translation paragraph. Every translation is retained, prefixed',
		'by its ayah number, followed once by the shared commentary.',
		'English source text uses text_en; other primary languages use text. Rows without',
		'a leading translation separator are left unchanged. Existing coverage is preserved.',
		'Default mode is a read-only dry run.',
		'',
		'Options:',
		'  --alias <alias>     Local tafsir alias (required)',
		'  --language <code>   Source language; required for multilingual books',
		'  --column <column>    Override source column: text or text_en',
		'  --apply             Back up and update MySQL, then rebuild the commentary index',
		'  --dry-run           Validate and report only (default)',
		'  --show-ranges       Print every range that would be merged',
		'  --no-index          Do not rebuild the commentary index after applying',
		'  --help              Show this help'
	].join('\n');
}

if (require.main === module)
	run().catch(err => {
		console.error(`ERROR: ${err.stack || err.message}`);
		process.exitCode = 1;
	});

module.exports = {
	commentaryAfterTranslation,
	findMergeGroups,
	mergedSourceText,
	resolveSourceColumn,
	splitTranslationAndCommentary,
	validateCoverage
};
