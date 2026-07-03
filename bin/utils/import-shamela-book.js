#!/usr/bin/env node
/* jslint node:true, esversion:9 */
'use strict';

const path = require('path');
const util = require('util');
const sqlite3 = require('sqlite3');
require('../../lib/Globals');

const DEFAULT_BATCH_SIZE = 250;

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const source = await openSqlite(options.source);
	const detected = await detectShamelaTables(source, options);
	const mainRow = (await sqliteGet(source, 'SELECT * FROM Main LIMIT 1')) || {};
	const headings = buildHeadings(await sqliteAll(source, `SELECT id, lvl, sub, tit FROM ${quoteSqliteIdentifier(detected.tocTable)} ORDER BY id`));
	const hadiths = buildHadiths(await sqliteAll(source, `SELECT id, hno, part, page, nass FROM ${quoteSqliteIdentifier(detected.textTable)} ORDER BY id`), headings);

	applyHeadingStats(headings, hadiths);
	console.log(`Prepared ${headings.length} headings and ${hadiths.length} hadith rows from ${options.source}`);
	console.log(`Using source tables: ${detected.textTable}, ${detected.tocTable}`);

	if (options.dryRun) {
		printPreview(options, mainRow, headings, hadiths);
		await closeSqlite(source);
		global.dbPool.end();
		return;
	}

	const connection = await getConnection();
	const query = util.promisify(connection.query).bind(connection);
	try {
		await query('START TRANSACTION');
		const bookId = await resolveBookId(query, options);
		await upsertBook(query, options, mainRow, bookId);
		await clearExistingBook(query, options.alias, bookId);
		const tocStartId = await nextTableId(query, 'toc');
		const hadithStartId = await nextTableId(query, 'hadiths');
		await insertHeadings(query, bookId, headings, tocStartId);
		await insertHadiths(query, bookId, headings, hadiths, hadithStartId, options.batchSize);
		await query('COMMIT');
		await verifyImport(bookId);
	} catch (err) {
		try {
			await query('ROLLBACK');
		} catch (_rollbackErr) {}
		throw err;
	} finally {
		connection.release();
		await closeSqlite(source);
		global.dbPool.end();
	}
}

async function detectShamelaTables(source, options) {
	if (options.textTable && options.tocTable)
		return { textTable: options.textTable, tocTable: options.tocTable };

	const tables = (await sqliteAll(source, "SELECT name FROM sqlite_master WHERE type='table'")).map(row => row.name);
	const textTables = tables.filter(name => /^b\d+$/i.test(name));
	const tocTables = tables.filter(name => /^t\d+$/i.test(name));
	if (options.bookNumber) {
		const textTable = options.textTable || `b${options.bookNumber}`;
		const tocTable = options.tocTable || `t${options.bookNumber}`;
		if (!tables.includes(textTable))
			throw new Error(`Source table '${textTable}' was not found`);
		if (!tables.includes(tocTable))
			throw new Error(`Source table '${tocTable}' was not found`);
		return { textTable, tocTable };
	}
	if (textTables.length !== 1 || tocTables.length !== 1)
		throw new Error('Unable to infer Shamela b*/t* tables. Pass --book-number or --text-table and --toc-table.');
	return { textTable: textTables[0], tocTable: tocTables[0] };
}

function buildHeadings(rows) {
	let h1 = 0;
	let h2 = null;
	let h3 = null;
	return rows.map((row, index) => {
		const level = Number(row.lvl) || 1;
		if (level === 1) {
			h1 += 1;
			h2 = null;
			h3 = null;
		} else if (level === 2) {
			h2 = h2 === null ? 1 : h2 + 1;
			h3 = null;
		} else {
			h3 = h3 === null ? 1 : h3 + 1;
		}
		return {
			key: `h${index + 1}`,
			ordinal: index + 1,
			sourceStart: Number(row.id),
			level,
			h1,
			h2,
			h3,
			title: cleanHeadingTitle(row.tit),
			start: Number(row.id),
			end: null,
			count: 0,
			tocId: null
		};
	});
}

function buildHadiths(rows, headings) {
	const segments = buildHadithSegments(rows);
	assertNoDuplicateExplicitNumbers(segments);
	applyUnnumberedVersions(segments);

	const numInChapter = new Map();
	const hadiths = [];
	for (const segment of segments) {
		const heading = headingForNum(headings, segment.baseNum);
		if (!heading)
			throw new Error(`No heading found for hadith ${segment.num}`);
		const current = (numInChapter.get(heading.key) || 0) + 1;
		numInChapter.set(heading.key, current);
		hadiths.push({
			ordinal: segment.ordinal,
			headingKey: heading.key,
			h1: heading.h1,
			h2: heading.h2,
			h3: heading.h3,
			numInChapter: current,
			num: segment.num,
			numActual: String(segment.baseNum),
			num0: segment.num0,
			baseNum: segment.baseNum,
			text: segment.text,
			chain: null,
			body: segment.text,
			part: segment.part,
			page: segment.page
		});
	}
	return hadiths;
}

function buildHadithSegments(rows) {
	const segments = [];
	let previousNumberedNum = null;
	for (const row of rows) {
		const text = cleanText(row.nass);
		if (!text || isHeadingOnlyText(text))
			continue;

		const markers = findHadithMarkers(text);
		const rowNum = parseNullableInt(row.hno);
		if (markers.length > 0) {
			const leading = text.slice(0, markers[0].start).trim();
			for (let i = 0; i < markers.length; i++) {
				const marker = markers[i];
				const end = i + 1 < markers.length ? markers[i + 1].start : text.length;
				let markerText = text.slice(marker.contentStart, end).trim();
				if (i === 0 && leading)
					markerText = `${leading}\n${markerText}`.trim();
				if (!markerText)
					continue;
				segments.push(segmentFromRow(row, marker.num, markerText, true));
				previousNumberedNum = marker.num;
			}
		} else if (rowNum) {
			segments.push(segmentFromRow(row, rowNum, text, true));
			previousNumberedNum = rowNum;
		} else if (previousNumberedNum) {
			segments.push(segmentFromRow(row, previousNumberedNum, text, false));
		}
	}
	segments.forEach((segment, index) => {
		segment.ordinal = index + 1;
	});
	return segments;
}

function segmentFromRow(row, baseNum, text, explicitlyNumbered) {
	return {
		sourceId: Number(row.id),
		baseNum,
		num: String(baseNum),
		numActual: String(baseNum),
		num0: baseNum,
		text: cleanHadithBody(text),
		explicitlyNumbered,
		part: row.part || null,
		page: row.page || null
	};
}

function assertNoDuplicateExplicitNumbers(segments) {
	const explicitByNum = new Map();
	for (const segment of segments) {
		if (!segment.explicitlyNumbered)
			continue;
		const arr = explicitByNum.get(segment.baseNum) || [];
		arr.push(segment);
		explicitByNum.set(segment.baseNum, arr);
	}
	const duplicates = Array.from(explicitByNum.entries())
		.filter(([, arr]) => arr.length > 1)
		.map(([num, arr]) => ({
			num,
			sourceIds: arr.map(segment => segment.sourceId),
			previews: arr.slice(0, 3).map(segment => segment.text.slice(0, 120).replace(/\s+/g, ' '))
		}));
	if (duplicates.length < 1)
		return;

	const preview = duplicates.slice(0, 25)
		.map(row => `${row.num}: source rows ${row.sourceIds.join(', ')} :: ${row.previews.join(' | ')}`)
		.join('\n');
	const remaining = duplicates.length > 25 ? `\n... ${duplicates.length - 25} more duplicate explicit number(s)` : '';
	throw new Error(`Duplicate explicit hadith numbers found; refusing to auto-version them.\n${preview}${remaining}`);
}

function applyUnnumberedVersions(segments) {
	const byNum = new Map();
	for (const segment of segments) {
		const arr = byNum.get(segment.baseNum) || [];
		arr.push(segment);
		byNum.set(segment.baseNum, arr);
	}
	for (const [baseNum, arr] of byNum.entries()) {
		if (!arr.some(segment => !segment.explicitlyNumbered))
			continue;
		arr.forEach((segment, index) => {
			segment.num = `${baseNum}${versionSuffix(index)}`;
			segment.numActual = String(baseNum);
			segment.num0 = Number((baseNum + ((index + 1) / 1000)).toFixed(3));
		});
	}
}

function findHadithMarkers(text) {
	const markers = [];
	const re = /(^|[\s،,])(\d{1,5})\s+-\s+/g;
	let match;
	while ((match = re.exec(text)) !== null) {
		const start = match.index + match[1].length;
		const num = Number(match[2]);
		if (!Number.isFinite(num))
			continue;
		markers.push({
			start,
			num,
			contentStart: re.lastIndex
		});
	}
	return markers;
}

function versionSuffix(index) {
	let n = index;
	let suffix = '';
	do {
		suffix = String.fromCharCode(97 + (n % 26)) + suffix;
		n = Math.floor(n / 26) - 1;
	} while (n >= 0);
	return suffix;
}

function isHeadingOnlyText(text) {
	return /^§?\s*(?:\d+\s*-\s*)?(?:كِتَاب|كتاب|بَاب|باب|فصل)\b/.test(text);
}

function headingForNum(headings, num) {
	let match = null;
	for (const heading of headings) {
		if (heading.sourceStart <= num)
			match = heading;
		else
			break;
	}
	return match;
}

function applyHeadingStats(headings, hadiths) {
	const counts = new Map();
	for (const hadith of hadiths) {
		const stats = counts.get(hadith.headingKey) || { start: hadith.baseNum, end: hadith.baseNum, count: 0 };
		stats.start = Math.min(stats.start, hadith.baseNum);
		stats.end = Math.max(stats.end, hadith.baseNum);
		stats.count += 1;
		counts.set(hadith.headingKey, stats);
	}
	headings.forEach(heading => {
		const stats = counts.get(heading.key);
		if (stats) {
			heading.start = stats.start;
			heading.end = stats.end;
			heading.count = stats.count;
		}
	});
}

async function resolveBookId(query, options) {
	const rows = await query('SELECT id, alias FROM books WHERE id=? OR alias=? ORDER BY id', [options.bookId || 0, options.alias]);
	const aliasRow = rows.find(row => row.alias === options.alias);
	const idRow = options.bookId ? rows.find(row => Number(row.id) === Number(options.bookId)) : null;
	if (idRow && idRow.alias !== options.alias)
		throw new Error(`books.id=${options.bookId} already belongs to alias '${idRow.alias}'`);
	if (aliasRow && options.bookId && Number(aliasRow.id) !== Number(options.bookId))
		throw new Error(`books.alias='${options.alias}' already uses id=${aliasRow.id}, not ${options.bookId}`);
	if (aliasRow)
		return aliasRow.id;
	if (options.bookId)
		return options.bookId;
	throw new Error('--book-id is required when importing a new book into this MySQL schema');
}

async function upsertBook(query, options, mainRow, bookId) {
	const metadata = bookMetadata(options, mainRow);
	await query(`
		INSERT INTO books
			(id, ordinal, alias, type, shortName_en, shortName, name_en, name, title_en, title, author, author_en, death, hidden, source, lang, format, description)
		VALUES
			(?, ?, ?, 'hadith', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'shamela', 'ar', 'sqlite', ?)
		ON DUPLICATE KEY UPDATE
			ordinal=VALUES(ordinal),
			type=VALUES(type),
			shortName_en=VALUES(shortName_en),
			shortName=VALUES(shortName),
			name_en=VALUES(name_en),
			name=VALUES(name),
			title_en=VALUES(title_en),
			title=VALUES(title),
			author=VALUES(author),
			author_en=VALUES(author_en),
			death=VALUES(death),
			hidden=VALUES(hidden),
			source=VALUES(source),
			lang=VALUES(lang),
			format=VALUES(format),
			description=VALUES(description),
			content_lastmod=CURRENT_TIMESTAMP()
	`, [
		bookId,
		metadata.ordinal,
		options.alias,
		metadata.shortNameEn,
		metadata.shortName,
		metadata.nameEn,
		metadata.name,
		metadata.titleEn,
		metadata.title,
		metadata.author,
		metadata.authorEn,
		metadata.death,
		metadata.hidden,
		metadata.description
	]);
	const rows = await query('SELECT id FROM books WHERE alias=?', [options.alias]);
	if (!rows.length)
		throw new Error(`Book '${options.alias}' was not found after upsert`);
	console.log(`Using books.id=${rows[0].id} for '${options.alias}'`);
	return rows[0].id;
}

function bookMetadata(options, mainRow) {
	const arabicTitle = options.title || mainRow.Bk || options.alias;
	return {
		ordinal: options.ordinal,
		shortNameEn: options.shortNameEn || options.nameEn || options.alias,
		shortName: options.shortName || arabicTitle,
		nameEn: options.nameEn || options.shortNameEn || options.alias,
		name: options.name || arabicTitle,
		titleEn: options.titleEn || options.nameEn || options.shortNameEn || options.alias,
		title: arabicTitle,
		author: options.author || mainRow.Auth || null,
		authorEn: options.authorEn || null,
		death: options.death !== null ? options.death : parseNullableInt(mainRow.AD),
		hidden: options.hidden ? 1 : 0,
		description: options.description || [mainRow.Betaka, mainRow.Inf].filter(Boolean).join('\n\n') || null
	};
}

async function clearExistingBook(query, alias, bookId) {
	const oldHadiths = await query('SELECT COUNT(*) AS count FROM hadiths WHERE bookId=?', [bookId]);
	const oldToc = await query('SELECT COUNT(*) AS count FROM toc WHERE bookId=?', [bookId]);
	console.log(`Clearing existing ${alias}: ${oldHadiths[0].count} hadiths, ${oldToc[0].count} toc rows`);
	await query('DELETE hg FROM hadiths_grades hg JOIN hadiths h ON h.id=hg.hadithId WHERE h.bookId=?', [bookId]);
	await query('DELETE FROM hadiths WHERE bookId=?', [bookId]);
	await query('DELETE FROM toc WHERE bookId=?', [bookId]);
}

async function insertHeadings(query, bookId, headings, startId) {
	for (const heading of headings) {
		heading.tocId = startId + heading.ordinal - 1;
		await query(`
			INSERT INTO toc
				(id, ordinal, bookId, level, h1, h2, h3, title, start, end, start0, end0, count)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`, [
			heading.tocId,
			heading.ordinal,
			bookId,
			heading.level,
			heading.h1,
			heading.h2,
			heading.h3,
			heading.title,
			heading.start ? String(heading.start) : null,
			heading.end ? String(heading.end) : null,
			heading.start || null,
			heading.end || null,
			heading.count || 0
		]);
	}
	console.log(`Inserted ${headings.length} toc rows`);
}

async function insertHadiths(query, bookId, headings, hadiths, startId, batchSize) {
	const headingByKey = new Map(headings.map(heading => [heading.key, heading]));
	for (let offset = 0; offset < hadiths.length; offset += batchSize) {
		const batch = hadiths.slice(offset, offset + batchSize);
		const values = batch.map((hadith, index) => [
			startId + offset + index,
			hadith.ordinal,
			bookId,
			headingByKey.get(hadith.headingKey).tocId,
			hadith.numInChapter,
			hadith.h1,
			hadith.h2,
			hadith.h3,
			0,
			String(hadith.num),
			hadith.numActual,
			hadith.num0,
			'No Grade',
			hadith.chain,
			hadith.body,
			hadith.text,
			hadith.part ? String(hadith.part) : null,
			hadith.page ? String(hadith.page) : null
		]);
		await query(`
			INSERT INTO hadiths
				(id, ordinal, bookId, tocId, numInChapter, h1, h2, h3, remark, num, numActual, num0, gradeText, chain, body, text, part, footnote)
			VALUES ?
		`, [values]);
		console.log(`Inserted ${Math.min(offset + batch.length, hadiths.length)}/${hadiths.length} hadith rows`);
	}
}

async function nextTableId(query, table) {
	const rows = await query(`SELECT COALESCE(MAX(id), 0) + 1 AS nextId FROM ${table}`);
	return Number(rows[0].nextId);
}

async function verifyImport(bookId) {
	const rows = await global.query(`
		SELECT
			b.id AS bookId,
			b.alias,
			COUNT(DISTINCT t.id) AS tocRows,
			COUNT(DISTINCT h.id) AS hadithRows,
			MIN(h.num0) AS firstNum,
			MAX(h.num0) AS lastNum
		FROM books b
		LEFT JOIN toc t ON t.bookId=b.id
		LEFT JOIN hadiths h ON h.bookId=b.id
		WHERE b.id=${Number(bookId)}
		GROUP BY b.id, b.alias
	`);
	console.log(JSON.stringify(rows[0], null, 2));
}

function cleanHeadingTitle(value) {
	return cleanText(value).replace(/^\d+\s*-\s*/, '').trim();
}

function cleanHadithText(value, num) {
	return cleanText(value)
		.replace(/^§\s*/, '')
		.replace(new RegExp(`^${num}\\s*-\\s*`), '')
		.trim();
}

function cleanHadithBody(value) {
	return cleanText(value)
		.replace(/^§\s*/, '')
		.replace(/\s*§\s*/g, ' ')
		.trim();
}

function cleanText(value) {
	return (value || '')
		.toString()
		.replace(/\\n/g, '\n')
		.replace(/-\[\d+\]-/g, '')
		.replace(/\u200f/g, '')
		.trim();
}

function quoteSqliteIdentifier(identifier) {
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier))
		throw new Error(`Unsafe SQLite identifier: ${identifier}`);
	return `"${identifier}"`;
}

function parseNullableInt(value) {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function printPreview(options, mainRow, headings, hadiths) {
	console.log(JSON.stringify({
		alias: options.alias,
		title: options.title || mainRow.Bk,
		author: options.author || mainRow.Auth,
		firstHeadings: headings.slice(0, 5),
		firstHadiths: hadiths.slice(0, 3).map(hadith => ({
			num: hadith.num,
			h1: hadith.h1,
			h2: hadith.h2,
			tocKey: hadith.headingKey,
			text: hadith.text.slice(0, 160)
		})),
		lastHadith: hadiths.length ? {
			num: hadiths[hadiths.length - 1].num,
			text: hadiths[hadiths.length - 1].text.slice(0, 160)
		} : null
	}, null, 2));
}

function getConnection() {
	return new Promise((resolve, reject) => {
		global.dbPool.getConnection((err, connection) => {
			if (err)
				reject(err);
			else
				resolve(connection);
		});
	});
}

function openSqlite(file) {
	return new Promise((resolve, reject) => {
		const db = new sqlite3.Database(file, sqlite3.OPEN_READONLY, err => {
			if (err)
				reject(err);
			else
				resolve(db);
		});
	});
}

function sqliteAll(db, sql, params = []) {
	return new Promise((resolve, reject) => {
		db.all(sql, params, (err, rows) => {
			if (err)
				reject(err);
			else
				resolve(rows);
		});
	});
}

function sqliteGet(db, sql, params = []) {
	return new Promise((resolve, reject) => {
		db.get(sql, params, (err, row) => {
			if (err)
				reject(err);
			else
				resolve(row);
		});
	});
}

function closeSqlite(db) {
	return new Promise((resolve, reject) => {
		db.close(err => {
			if (err)
				reject(err);
			else
				resolve();
		});
	});
}

function parseArgs(argv) {
	const options = {
		alias: '',
		source: '',
		bookId: null,
		bookNumber: '',
		textTable: '',
		tocTable: '',
		ordinal: 100,
		shortNameEn: '',
		shortName: '',
		nameEn: '',
		name: '',
		titleEn: '',
		title: '',
		author: '',
		authorEn: '',
		death: null,
		description: '',
		hidden: false,
		dryRun: false,
		batchSize: DEFAULT_BATCH_SIZE
	};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--dry-run') options.dryRun = true;
		else if (arg === '--hidden') options.hidden = true;
		else if (arg === '--alias') options.alias = requiredValue(argv, ++i, arg);
		else if (arg === '--source') options.source = requiredValue(argv, ++i, arg);
		else if (arg === '--book-id') options.bookId = parsePositiveInt(requiredValue(argv, ++i, arg), arg);
		else if (arg === '--book-number') options.bookNumber = requiredValue(argv, ++i, arg);
		else if (arg === '--text-table') options.textTable = requiredValue(argv, ++i, arg);
		else if (arg === '--toc-table') options.tocTable = requiredValue(argv, ++i, arg);
		else if (arg === '--ordinal') options.ordinal = parsePositiveInt(requiredValue(argv, ++i, arg), arg);
		else if (arg === '--short-name-en') options.shortNameEn = requiredValue(argv, ++i, arg);
		else if (arg === '--short-name') options.shortName = requiredValue(argv, ++i, arg);
		else if (arg === '--name-en') options.nameEn = requiredValue(argv, ++i, arg);
		else if (arg === '--name') options.name = requiredValue(argv, ++i, arg);
		else if (arg === '--title-en') options.titleEn = requiredValue(argv, ++i, arg);
		else if (arg === '--title') options.title = requiredValue(argv, ++i, arg);
		else if (arg === '--author') options.author = requiredValue(argv, ++i, arg);
		else if (arg === '--author-en') options.authorEn = requiredValue(argv, ++i, arg);
		else if (arg === '--death') options.death = parsePositiveInt(requiredValue(argv, ++i, arg), arg);
		else if (arg === '--description') options.description = requiredValue(argv, ++i, arg);
		else if (arg === '--batch-size') options.batchSize = parsePositiveInt(requiredValue(argv, ++i, arg), arg);
		else if (arg === '--help') usage(0);
		else throw new Error(`Unknown argument: ${arg}`);
	}
	if (!options.alias || !/^[a-z0-9][a-z0-9_-]*$/i.test(options.alias))
		throw new Error('--alias is required and must be a URL-safe book alias');
	if (!options.source)
		throw new Error('--source is required');
	options.source = path.resolve(options.source);
	return options;
}

function requiredValue(argv, index, arg) {
	const value = argv[index];
	if (!value)
		throw new Error(`${arg} requires a value`);
	return value;
}

function parsePositiveInt(value, label) {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1)
		throw new Error(`${label} must be a positive integer`);
	return parsed;
}

function usage(exitCode) {
	console.log(`Usage:
  node bin/utils/import-shamela-book.js --source <book.db> --alias <alias> [options]

Options:
  --book-id <n>           Required for new books because books.id is explicit.
  --book-number <n>       Use b<n> and t<n> source tables.
  --text-table <name>     Explicit text table. Usually b<n>.
  --toc-table <name>      Explicit toc table. Usually t<n>.
  --ordinal <n>           books.ordinal value. Default: 100.
  --short-name-en <text>  English short label.
  --short-name <text>     Arabic short label.
  --name-en <text>        English full name.
  --name <text>           Arabic full name.
  --title-en <text>       English title.
  --title <text>          Arabic title.
  --author <text>         Arabic author.
  --author-en <text>      English author.
  --death <year>          Author death year.
  --description <text>    Override description from Main metadata.
  --hidden                Import as hidden.
  --dry-run               Parse and print a preview without writing MySQL.

Example:
  node bin/utils/import-shamela-book.js --source temp/سنن\\ الدارقطني.db --alias daraqutni --book-id 23 --book-number 9771 --ordinal 54 --short-name-en Daraqutni --short-name الدارقطني --name-en "Sunan al-Daraqutni" --title "سنن الدارقطني" --author-en "Abu al-Hasan Ali ibn Umar al-Daraqutni"`);
	process.exit(exitCode);
}

main().catch(err => {
	console.error(err.stack || err);
	if (global.dbPool)
		global.dbPool.end();
	process.exit(1);
});
