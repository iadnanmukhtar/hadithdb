#!/usr/bin/env node
/* jslint node:true, esversion:9 */
'use strict';

require('dotenv').config();
require('../../lib/Globals');

const COLUMN_NAME = 'size';

const options = readOptions(process.argv.slice(2));

(async () => {
	try {
		const rows = await loadTafsirArabicSizes();
		const nonEmptyRows = rows.filter(row => row.arabicChars > 0);
		const medianChars = median(nonEmptyRows.map(row => row.arabicChars));
		const smallMaxExclusive = medianChars / 2;
		const largeMinInclusive = medianChars * 2;
		const classifiedRows = rows.map(row => ({
			...row,
			size: classifySize(row.arabicChars, smallMaxExclusive, largeMinInclusive)
		}));

		console.log(`Arabic tafsir books with content: ${nonEmptyRows.length}`);
		console.log(`Median Arabic content size: ${formatInteger(medianChars)} characters`);
		console.log(`sm: < ${formatInteger(Math.floor(smallMaxExclusive))} chars`);
		console.log(`md: ${formatInteger(Math.floor(smallMaxExclusive))}-${formatInteger(Math.ceil(largeMinInclusive) - 1)} chars`);
		console.log(`lg: >= ${formatInteger(Math.ceil(largeMinInclusive))} chars`);
		printSummary(classifiedRows);

		if (options.dryRun)
			return;

		await ensureColumn();
		await updateRows(classifiedRows);
		console.log(`Updated ${classifiedRows.length} books_commentaries row(s).`);
	} catch (err) {
		console.error(`ERROR: ${err.message}`);
		process.exitCode = 1;
	} finally {
		global.dbPool.end();
	}
})();

function readOptions(args) {
	return {
		dryRun: args.includes('--dry-run')
	};
}

async function loadTafsirArabicSizes() {
	const rows = await global.query(`
		SELECT
			bc.id,
			bc.alias,
			bc.lang,
			bc.source,
			COUNT(hc.id) AS row_count,
			COALESCE(SUM(CHAR_LENGTH(COALESCE(hc.text, '')) + CHAR_LENGTH(COALESCE(hc.footnotes, ''))), 0) AS arabic_chars
		FROM books_commentaries bc
		LEFT JOIN hadiths_commentary hc ON hc.bookCommentaryId=bc.id
		WHERE COALESCE(bc.type, 'tafsir')='tafsir'
		GROUP BY bc.id
		ORDER BY arabic_chars DESC, bc.id`);
	return rows.map(row => ({
		id: Number(row.id),
		alias: row.alias,
		lang: row.lang,
		source: row.source,
		rowCount: Number(row.row_count || 0),
		arabicChars: Number(row.arabic_chars || 0)
	}));
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

function printSummary(rows) {
	const counts = rows.reduce((acc, row) => {
		acc[row.size || 'unknown'] = (acc[row.size || 'unknown'] || 0) + 1;
		return acc;
	}, {});
	console.log(`Classified: sm=${counts.sm || 0}, md=${counts.md || 0}, lg=${counts.lg || 0}, unknown=${counts.unknown || 0}`);
	for (const row of rows.filter(row => row.size))
		console.log(`${row.alias}\t${row.size}\t${formatInteger(row.arabicChars)}`);
}

async function ensureColumn() {
	const columns = await global.query(`
		SHOW COLUMNS
		FROM books_commentaries
		LIKE '${COLUMN_NAME}'`);
	if (columns.length > 0)
		return;
	await global.query(`
		ALTER TABLE books_commentaries
		ADD COLUMN ${COLUMN_NAME} ENUM('sm', 'md', 'lg') NULL DEFAULT NULL
		COMMENT 'DB-derived total Arabic tafsir content size class'
		AFTER aqidah`);
	console.log(`Added books_commentaries.${COLUMN_NAME}.`);
}

async function updateRows(rows) {
	for (const row of rows) {
		const value = row.size ? `'${row.size}'` : 'NULL';
		await global.query(`
			UPDATE books_commentaries
			SET ${COLUMN_NAME}=${value}
			WHERE id=${row.id}`);
	}
}

function formatInteger(value) {
	return Math.round(value).toLocaleString('en-US');
}
