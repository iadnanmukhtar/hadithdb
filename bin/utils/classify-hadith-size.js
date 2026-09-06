#!/usr/bin/env node
/* jslint node:true, esversion:9 */
'use strict';

require('dotenv').config();

const COLUMN_NAME = 'size';

async function run(argv = process.argv.slice(2)) {
	require('../../lib/Globals');
	const options = readOptions(argv);
	try {
		const rows = await loadHadithContentSizes();
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

async function loadHadithContentSizes() {
	const rows = await global.query(`
		SELECT
			b.id,
			b.alias,
			b.lang,
			b.source,
			COUNT(content.id) AS row_count,
			COALESCE(SUM(content.arabic_chars), 0) AS arabic_chars,
			COALESCE(SUM(CASE WHEN content.arabic_chars=0 THEN content.english_chars ELSE 0 END), 0) AS english_only_chars
		FROM books b
		LEFT JOIN (
			SELECT
				h.bookId,
				h.id,
				CHAR_LENGTH(COALESCE(h.chain, '')) + CHAR_LENGTH(COALESCE(h.body, '')) + CHAR_LENGTH(COALESCE(h.footnote, '')) AS arabic_chars,
				CHAR_LENGTH(COALESCE(h.chain_en, '')) + CHAR_LENGTH(COALESCE(h.body_en, '')) + CHAR_LENGTH(COALESCE(h.footnote_en, '')) AS english_chars
			FROM hadiths h
			JOIN books physical_book ON physical_book.id=h.bookId
			WHERE COALESCE(h.remark, 0)=0 AND COALESCE(physical_book.virtual, 0)=0
			UNION ALL
			SELECT
				hv.bookId,
				hv.id,
				CHAR_LENGTH(COALESCE(h.chain, '')) + CHAR_LENGTH(COALESCE(h.body, '')) + CHAR_LENGTH(COALESCE(h.footnote, '')) + CHAR_LENGTH(COALESCE(hv.note, '')) AS arabic_chars,
				CHAR_LENGTH(COALESCE(h.chain_en, '')) + CHAR_LENGTH(COALESCE(h.body_en, '')) + CHAR_LENGTH(COALESCE(h.footnote_en, '')) + CHAR_LENGTH(COALESCE(hv.note_en, '')) AS english_chars
			FROM hadiths_virtual hv
			JOIN hadiths h ON h.id=hv.hadithId
			JOIN books virtual_book ON virtual_book.id=hv.bookId
			WHERE COALESCE(h.remark, 0)=0 AND COALESCE(virtual_book.virtual, 0)=1
		) content ON content.bookId=b.id
		WHERE COALESCE(b.type, 'hadith')='hadith' AND b.alias<>'quran'
		GROUP BY b.id
		ORDER BY arabic_chars DESC, b.id`);
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
	console.log(`${label} hadith books with content: ${values.count}`);
	if (values.count < 1)
		return;
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
		COMMENT 'DB-derived book content size class'
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
