#!/usr/bin/env node
/* jslint node:true, esversion:9 */
'use strict';

require('dotenv').config();

const COLUMN_NAME = 'size';

async function run(argv = process.argv.slice(2)) {
	require('../../lib/Globals');
	const options = readOptions(argv);
	try {
		const rows = await loadTafsirContentSizes();
		const { classifiedRows, arabicThresholds, englishThresholds } = classifyRows(rows);

		printThresholds('Arabic', arabicThresholds);
		printThresholds('English-only', englishThresholds);
		printSummary(classifiedRows);

		if (options.dryRun)
			return;

		await ensureColumn();
		await updateRows(classifiedRows);
		console.log(`Updated ${classifiedRows.length} books row(s).`);
	} catch (err) {
		console.error(`ERROR: ${err.message}`);
		process.exitCode = 1;
	} finally {
		global.dbPool.end();
	}
}

function readOptions(args) {
	return {
		dryRun: args.includes('--dry-run')
	};
}

async function loadTafsirContentSizes() {
	const rows = await global.query(`
		SELECT
			bc.id,
			bc.alias,
			bc.lang,
			bc.source,
			COUNT(hc.id) AS row_count,
			COALESCE(SUM(CHAR_LENGTH(COALESCE(hc.text, '')) + CHAR_LENGTH(COALESCE(hc.footnotes, ''))), 0) AS arabic_chars,
			COALESCE(SUM(CASE
				WHEN CHAR_LENGTH(COALESCE(hc.text, '')) + CHAR_LENGTH(COALESCE(hc.footnotes, ''))=0
				THEN CHAR_LENGTH(COALESCE(hc.text_en, '')) + CHAR_LENGTH(COALESCE(hc.footnotes_en, ''))
				ELSE 0
			END), 0) AS english_only_chars
		FROM books bc
		LEFT JOIN hadiths_commentary hc ON hc.bookId=bc.id
		WHERE bc.type='tafsir'
		GROUP BY bc.id
		ORDER BY arabic_chars DESC, bc.id`);
	return rows.map(row => ({
		id: Number(row.id),
		alias: row.alias,
		lang: row.lang,
		source: row.source,
		rowCount: Number(row.row_count || 0),
		arabicChars: Number(row.arabic_chars || 0),
		englishOnlyChars: Number(row.english_only_chars || 0)
	}));
}

function classifyRows(rows) {
	const arabicThresholds = thresholds(rows.filter(row => row.arabicChars > 0).map(row => row.arabicChars));
	const englishThresholds = thresholds(rows
		.filter(row => row.arabicChars <= 0 && row.englishOnlyChars > 0)
		.map(row => row.englishOnlyChars));
	const classifiedRows = rows.map(row => {
		const englishOnly = row.arabicChars <= 0 && row.englishOnlyChars > 0;
		const chars = englishOnly ? row.englishOnlyChars : row.arabicChars;
		const rowThresholds = englishOnly ? englishThresholds : arabicThresholds;
		return {
			...row,
			contentLanguage: englishOnly ? 'en' : (row.arabicChars > 0 ? 'ar' : null),
			contentChars: chars,
			size: classifySize(chars, rowThresholds.smallMaxExclusive, rowThresholds.largeMinInclusive)
		};
	});
	return { classifiedRows, arabicThresholds, englishThresholds };
}

function thresholds(values) {
	const medianChars = median(values);
	return {
		count: values.length,
		medianChars,
		smallMaxExclusive: medianChars / 2,
		largeMinInclusive: medianChars * 2
	};
}

function median(values) {
	if (values.length < 1)
		return 0;
	const sorted = values.slice().sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function classifySize(chars, smallMaxExclusive, largeMinInclusive) {
	if (!Number.isFinite(chars) || chars <= 0)
		return null;
	if (chars < smallMaxExclusive)
		return 'sm';
	if (chars >= largeMinInclusive)
		return 'lg';
	return 'md';
}

function printThresholds(label, values) {
	console.log(`${label} tafsir books with content: ${values.count}`);
	console.log(`Median ${label} content size: ${formatInteger(values.medianChars)} characters`);
	console.log(`sm: < ${formatInteger(Math.floor(values.smallMaxExclusive))} chars`);
	console.log(`md: ${formatInteger(Math.floor(values.smallMaxExclusive))}-${formatInteger(Math.ceil(values.largeMinInclusive) - 1)} chars`);
	console.log(`lg: >= ${formatInteger(Math.ceil(values.largeMinInclusive))} chars`);
}

function printSummary(rows) {
	const counts = rows.reduce((acc, row) => {
		acc[row.size || 'unknown'] = (acc[row.size || 'unknown'] || 0) + 1;
		return acc;
	}, {});
	console.log(`Classified: sm=${counts.sm || 0}, md=${counts.md || 0}, lg=${counts.lg || 0}, unknown=${counts.unknown || 0}`);
	for (const row of rows.filter(row => row.size))
		console.log(`${row.alias}\t${row.size}\t${formatInteger(row.contentChars)}`);
}

async function ensureColumn() {
	const columns = await global.query(`
		SHOW COLUMNS
		FROM books
		LIKE '${COLUMN_NAME}'`);
	if (columns.length > 0)
		return;
	await global.query(`
		ALTER TABLE books
		ADD COLUMN ${COLUMN_NAME} ENUM('sm', 'md', 'lg') NULL DEFAULT NULL
		COMMENT 'DB-derived total tafsir content size class'
		AFTER aqidah`);
	console.log(`Added books.${COLUMN_NAME}.`);
}

async function updateRows(rows) {
	for (const row of rows) {
		const value = row.size ? `'${row.size}'` : 'NULL';
		await global.query(`
			UPDATE books
			SET ${COLUMN_NAME}=${value}
			WHERE id=${row.id}`);
	}
}

function formatInteger(value) {
	return Math.round(value).toLocaleString('en-US');
}

if (require.main === module)
	run().catch(err => { console.error(`ERROR: ${err.stack || err.message}`); process.exitCode = 1; });

module.exports = { classifyRows, classifySize, median, thresholds };
