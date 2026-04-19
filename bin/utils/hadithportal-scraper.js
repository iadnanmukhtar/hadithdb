/* jslint node:true, esversion:11 */
'use strict';

const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');
const util = require('util');
const os = require('os');
const axios = require('axios');
const cheerio = require('cheerio');
const MySQL = require('mysql');

const Hadith = require('../../lib/Hadith');

const BASE_URL = 'https://hadithportal.com/';
const USER_AGENT = 'Mozilla/5.0 (compatible; hadithdb-hadithportal-scraper/3.0; +https://hadithunlocked.com/)';

const DEFAULTS = {
	delayMs: 250,
	timeoutMs: 45000,
	startChapter: 1,
	limitChapters: null,
	limitBabs: null,
	useCache: true,
	reset: false,
	cacheDir: path.resolve(__dirname, '../../data/cache/hadithportal-books'),
	stateFile: null
};

async function main() {
	const options = parseArgs(process.argv.slice(2));
	await fs.mkdir(path.dirname(options.stateFile), { recursive: true });
	if (options.useCache) {
		await fs.mkdir(options.cacheDir, { recursive: true });
	}

	const db = await openDatabase();
	try {
		const run = await initializeRun(db, options);
		const summary = await scrapeIntoDatabase(db, options, run);

		if (!summary.stoppedByLimit && !options.limitChapters && !options.limitBabs && options.startChapter === 1) {
			run.state.finished = true;
			run.state.finishedAt = new Date().toISOString();
			await saveState(options.stateFile, run.state);
		}

		console.error('');
		console.error(`Completed scrape for ${run.state.sourceBookName || `HadithPortal book ${options.sourceBookId}`}`);
		console.error(`Inserted chapters: ${summary.insertedChapters}`);
		console.error(`Inserted babs: ${summary.insertedBabs}`);
		console.error(`Inserted hadiths: ${summary.insertedHadiths}`);
		console.error(`Skipped existing babs: ${summary.skippedBabs}`);
		console.error(`Progress file: ${options.stateFile}`);
		if (summary.stoppedByLimit) {
			console.error('Run stopped because a limit option was reached. Resume by running the same script again without --reset.');
		}
	} finally {
		await db.end();
	}
}

function parseArgs(argv) {
	const options = { ...DEFAULTS };
	const positionals = [];
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (!arg.startsWith('-')) {
			positionals.push(arg);
		} else if (arg === '--start-chapter') {
			options.startChapter = parsePositiveInt(argv[++i], '--start-chapter');
		} else if (arg === '--limit-chapters') {
			options.limitChapters = parsePositiveInt(argv[++i], '--limit-chapters');
		} else if (arg === '--limit-babs') {
			options.limitBabs = parsePositiveInt(argv[++i], '--limit-babs');
		} else if (arg === '--delay-ms') {
			options.delayMs = parseNonNegativeInt(argv[++i], '--delay-ms');
		} else if (arg === '--timeout-ms') {
			options.timeoutMs = parsePositiveInt(argv[++i], '--timeout-ms');
		} else if (arg === '--cache-dir') {
			options.cacheDir = path.resolve(argv[++i]);
		} else if (arg === '--state-file') {
			options.stateFile = path.resolve(argv[++i]);
		} else if (arg === '--no-cache') {
			options.useCache = false;
		} else if (arg === '--reset') {
			options.reset = true;
		} else if (arg === '--help' || arg === '-h') {
			printHelp();
			process.exit(0);
		} else {
			throw new Error(`Unknown argument: ${arg}`);
		}
	}

	if (positionals.length !== 2) {
		throw new Error('Expected two required positional arguments: <hadithportal_book_id> <db_book_id>');
	}

	options.sourceBookId = parsePositiveInt(positionals[0], '<hadithportal_book_id>');
	options.targetBookId = parsePositiveInt(positionals[1], '<db_book_id>');

	if (!options.stateFile) {
		options.stateFile = path.join(
			options.cacheDir,
			`hadithportal-book-${options.sourceBookId}-to-db-book-${options.targetBookId}.progress.json`
		);
	}

	return options;
}

function printHelp() {
	console.log(`
Usage:
  node bin/utils/hadithportal-scraper.js <hadithportal_book_id> <db_book_id> [options]

Behavior:
  Scrapes a HadithPortal book, writes directly into the target MySQL bookId,
  and stores progress in a local JSON file so interrupted runs resume from the last
  completed bab.

Options:
  --start-chapter N    Start scraping from chapter sequence N (1-based)
  --limit-chapters N   Only visit N chapters from the start chapter
  --limit-babs N       Only process N babs total in this run
  --delay-ms N         Delay between uncached HTTP requests in milliseconds
  --timeout-ms N       HTTP timeout in milliseconds
  --cache-dir PATH     Cache directory for fetched HTML
  --state-file PATH    Resume/progress JSON file
  --no-cache           Disable HTML page caching
  --reset              Clear existing imported rows for the target db book id and restart from scratch
  --help               Show this help

Examples:
  node bin/utils/hadithportal-scraper.js 45 16 --reset
  node bin/utils/hadithportal-scraper.js 45 16
  node bin/utils/hadithportal-scraper.js 45 16 --limit-babs 10
`.trim());
}

function parsePositiveInt(value, flag) {
	const parsed = Number.parseInt(value, 10);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw new Error(`${flag} expects a positive integer`);
	}
	return parsed;
}

function parseNonNegativeInt(value, flag) {
	const parsed = Number.parseInt(value, 10);
	if (!Number.isInteger(parsed) || parsed < 0) {
		throw new Error(`${flag} expects a non-negative integer`);
	}
	return parsed;
}

async function openDatabase() {
	const settingsPath = path.join(os.homedir(), '.hadithdb/settings.json');
	const settings = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
	const connection = MySQL.createConnection(settings.mysql.connection);

	return {
		connection: connection,
		query: util.promisify(connection.query).bind(connection),
		beginTransaction: util.promisify(connection.beginTransaction).bind(connection),
		commit: util.promisify(connection.commit).bind(connection),
		rollback: util.promisify(connection.rollback).bind(connection),
		end: util.promisify(connection.end).bind(connection)
	};
}

async function initializeRun(db, options) {
	let state = options.reset ? null : await loadState(options.stateFile);

	if (options.reset) {
		console.error(`Resetting existing imported rows for bookId=${options.targetBookId}...`);
		await resetTargetBook(db, options.targetBookId);
		state = createEmptyState(options);
		await saveState(options.stateFile, state);
	} else if (!state) {
		if (options.startChapter > 1) {
			throw new Error(
				`Cannot start a brand-new import at chapter ${options.startChapter}. ` +
				`Use --start-chapter with an existing progress file, or restart from chapter 1 with --reset.`
			);
		}
		const existing = await getExistingTargetCounts(db, options.targetBookId);
		if (existing.tocCount > 0 || existing.hadithCount > 0) {
			throw new Error(
				`bookId ${options.targetBookId} already has ${existing.tocCount} toc rows and ${existing.hadithCount} hadith rows, but no progress file was found. ` +
				`Use --reset to start over, or restore the progress file at ${options.stateFile}.`
			);
		}
		state = createEmptyState(options);
		await saveState(options.stateFile, state);
	} else {
		validateState(state, options.stateFile, options);
	}

	return {
		state: state,
		nextTocOrdinal: await getNextOrdinal(db, 'toc', options.targetBookId),
		nextHadithOrdinal: await getNextOrdinal(db, 'hadiths', options.targetBookId)
	};
}

function createEmptyState(options) {
	const now = new Date().toISOString();
	return {
		version: 2,
		sourceBookId: options.sourceBookId,
		sourceBookName: null,
		targetBookId: options.targetBookId,
		createdAt: now,
		updatedAt: now,
		finished: false,
		options: {
			startChapter: options.startChapter
		},
		completedChapters: {},
		completedBabs: {},
		lastCompleted: null
	};
}

function validateState(state, stateFile, options) {
	if (state.version !== 2) {
		throw new Error(`Unsupported progress file version in ${stateFile}. Delete it or rerun with --reset.`);
	}
	if (state.sourceBookId !== options.sourceBookId || state.targetBookId !== options.targetBookId) {
		throw new Error(`Progress file ${stateFile} does not match source book ${options.sourceBookId} and target book ${options.targetBookId}.`);
	}
}

async function loadState(stateFile) {
	try {
		return JSON.parse(await fs.readFile(stateFile, 'utf8'));
	} catch (err) {
		if (err.code === 'ENOENT') {
			return null;
		}
		throw err;
	}
}

async function saveState(stateFile, state) {
	state.updatedAt = new Date().toISOString();
	const tempFile = `${stateFile}.tmp`;
	await fs.writeFile(tempFile, JSON.stringify(state, null, 2), 'utf8');
	await fs.rename(tempFile, stateFile);
}

async function getExistingTargetCounts(db, targetBookId) {
	const tocRows = await db.query('SELECT COUNT(*) AS cnt FROM `toc` WHERE `bookId` = ?', [targetBookId]);
	const hadithRows = await db.query('SELECT COUNT(*) AS cnt FROM `hadiths` WHERE `bookId` = ?', [targetBookId]);
	return {
		tocCount: tocRows[0].cnt,
		hadithCount: hadithRows[0].cnt
	};
}

async function getNextOrdinal(db, tableName, targetBookId) {
	const rows = await db.query(`SELECT COALESCE(MAX(\`ordinal\`), 0) + 1 AS nextOrdinal FROM \`${tableName}\` WHERE \`bookId\` = ?`, [targetBookId]);
	return rows[0].nextOrdinal;
}

async function resetTargetBook(db, targetBookId) {
	await db.beginTransaction();
	try {
		const existingRows = await db.query('SELECT `id` FROM `hadiths` WHERE `bookId` = ?', [targetBookId]);
		const existingIds = existingRows.map(row => row.id);

		if (existingIds.length > 0) {
			await deleteByIds(db, 'hadiths_sim_candidates', 'hadithId1', existingIds);
			await deleteByIds(db, 'hadiths_sim_candidates', 'hadithId2', existingIds);
			await deleteByIds(db, 'hadiths_sim', 'hadithId1', existingIds);
			await deleteByIds(db, 'hadiths_sim', 'hadithId2', existingIds);
		}

		await db.query('DELETE FROM `hadiths` WHERE `bookId` = ?', [targetBookId]);
		await db.query('DELETE FROM `toc` WHERE `bookId` = ?', [targetBookId]);
		await db.commit();
	} catch (err) {
		try {
			await db.rollback();
		} catch (_rollbackErr) {
			// Ignore rollback failure and rethrow original error.
		}
		throw err;
	}
}

async function deleteByIds(db, tableName, columnName, ids, batchSize = 500) {
	for (let i = 0; i < ids.length; i += batchSize) {
		const batch = ids.slice(i, i + batchSize);
		await db.query(`DELETE FROM \`${tableName}\` WHERE \`${columnName}\` IN (?)`, [batch]);
	}
}

async function scrapeIntoDatabase(db, options, run) {
	const bookUrl = makeUrl(`index.php?show=book&book_id=${options.sourceBookId}`);
	const bookHtml = await fetchHtml(bookUrl, options);
	const bookName = parseBookTitle(bookHtml) || run.state.sourceBookName || `HadithPortal book ${options.sourceBookId}`;
	if (run.state.sourceBookName !== bookName) {
		run.state.sourceBookName = bookName;
		await saveState(options.stateFile, run.state);
	}
	let chapters = parseBookPage(bookHtml, options.sourceBookId);
	chapters = chapters.filter(chapter => chapter.seq >= options.startChapter);
	if (options.limitChapters) {
		chapters = chapters.slice(0, options.limitChapters);
	}

	const summary = {
		insertedChapters: 0,
		insertedBabs: 0,
		insertedHadiths: 0,
		skippedBabs: 0,
		stoppedByLimit: false
	};

	let processedBabsThisRun = 0;

	for (const chapter of chapters) {
		if (options.limitBabs && processedBabsThisRun >= options.limitBabs) {
			summary.stoppedByLimit = true;
			break;
		}

		console.error(`\n[chapter ${chapter.seq}] ${chapter.title}`);
		const chapterRowResult = await ensureChapterRow(db, chapter, run);
		if (chapterRowResult.inserted) {
			summary.insertedChapters++;
		}

		const chapterHtml = await fetchHtml(chapter.url, options);
		let babs = parseChapterPage(chapterHtml);
		if (babs.length === 0) {
			babs = [{
				seq: 1,
				title: chapter.title,
				url: chapter.url,
				babId: null
			}];
		}

		for (const bab of babs) {
			if (options.limitBabs && processedBabsThisRun >= options.limitBabs) {
				summary.stoppedByLimit = true;
				break;
			}
			processedBabsThisRun++;

			const babKey = makeBabKey(chapter.seq, bab.seq);
			const existing = await getExistingBabStatus(db, options.targetBookId, chapter.seq, bab.babId === null ? null : bab.seq, bab.babId === null);
			if (existing.complete) {
				console.error(`  [bab ${chapter.seq}.${bab.seq}] already imported, skipping`);
				run.state.completedBabs[babKey] = {
					chapterSeq: chapter.seq,
					babSeq: bab.seq,
					title: existing.title || bab.title,
					hadithCount: existing.hadithCount,
					tocId: existing.tocId,
					completedAt: run.state.completedBabs[babKey] ? run.state.completedBabs[babKey].completedAt : new Date().toISOString()
				};
				run.state.lastCompleted = {
					chapterSeq: chapter.seq,
					babSeq: bab.seq,
					title: existing.title || bab.title,
					hadithCount: existing.hadithCount
				};
				await saveState(options.stateFile, run.state);
				summary.skippedBabs++;
				continue;
			}

			console.error(`  [bab ${chapter.seq}.${bab.seq}] ${bab.title}`);
			const babResult = await scrapeBab(chapter, bab, options);
			const insertResult = await insertBabIntoDatabase(db, options, chapter, bab, babResult, run, chapterRowResult.row);

			run.state.completedBabs[babKey] = {
				chapterSeq: chapter.seq,
				babSeq: bab.seq,
				title: babResult.title || bab.title,
				hadithCount: insertResult.hadithCount,
				tocId: insertResult.tocId,
				completedAt: new Date().toISOString()
			};
			run.state.lastCompleted = {
				chapterSeq: chapter.seq,
				babSeq: bab.seq,
				title: babResult.title || bab.title,
				hadithCount: insertResult.hadithCount
			};
			await saveState(options.stateFile, run.state);

			summary.insertedBabs++;
			summary.insertedHadiths += insertResult.hadithCount;
		}

		if (!summary.stoppedByLimit) {
			run.state.completedChapters[String(chapter.seq)] = {
				chapterSeq: chapter.seq,
				title: chapter.title,
				completedAt: new Date().toISOString()
			};
			await saveState(options.stateFile, run.state);
		}
	}

	return summary;
}

async function ensureChapterRow(db, chapter, run) {
	const existing = await findTocRow(db, run.state.targetBookId, 1, chapter.seq, null, null);
	if (existing) {
		return { row: existing, inserted: false };
	}

	const ordinal = run.nextTocOrdinal;
	const result = await db.query(
		'INSERT INTO `toc` (`ordinal`, `bookId`, `level`, `h1`, `h2`, `h3`, `title`, `intro`, `start`, `start0`, `count`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
		[ordinal, run.state.targetBookId, 1, chapter.seq, null, null, chapter.title, null, null, null, 0]
	);

	run.nextTocOrdinal += 1;
	return {
		row: {
			id: result.insertId,
			level: 1,
			h1: chapter.seq,
			h2: null,
			h3: null,
			title: chapter.title
		},
		inserted: true
	};
}

async function getExistingBabStatus(db, targetBookId, chapterSeq, babSeq, chapterOnly) {
	if (chapterOnly) {
		const rows = await db.query(
			`SELECT t.id AS tocId, t.title, t.count, COUNT(h.id) AS hadithCount
			 FROM toc t
			 LEFT JOIN hadiths h ON h.tocId = t.id
			 WHERE t.bookId = ? AND t.level = 1 AND t.h1 = ? AND t.h2 IS NULL AND t.h3 IS NULL
			 GROUP BY t.id, t.title, t.count`,
			[targetBookId, chapterSeq]
		);
		if (!rows.length) {
			return { complete: false };
		}
		const row = rows[0];
		return {
			complete: row.hadithCount > 0 && (row.count === null || row.count === row.hadithCount),
			tocId: row.tocId,
			title: row.title,
			hadithCount: row.hadithCount
		};
	}

	const rows = await db.query(
		`SELECT t.id AS tocId, t.title, t.count, COUNT(h.id) AS hadithCount
		 FROM toc t
		 LEFT JOIN hadiths h ON h.tocId = t.id
		 WHERE t.bookId = ? AND t.level = 2 AND t.h1 = ? AND t.h2 = ? AND t.h3 IS NULL
		 GROUP BY t.id, t.title, t.count`,
		[targetBookId, chapterSeq, babSeq]
	);
	if (!rows.length) {
		return { complete: false };
	}
	const row = rows[0];
	return {
		complete: row.hadithCount > 0 && (row.count === null || row.count === row.hadithCount),
		tocId: row.tocId,
		title: row.title,
		hadithCount: row.hadithCount
	};
}

async function insertBabIntoDatabase(db, options, chapter, bab, babResult, run, chapterRow) {
	const hadithCount = babResult.hadiths.length;
	const resolvedBabTitle = babResult.title || bab.title;
	const firstHadith = hadithCount > 0 ? babResult.hadiths[0] : null;
	const chapterOnly = bab.babId === null;

	await db.beginTransaction();
	try {
		let tocId = chapterRow.id;
		let babRowInserted = false;

		if (chapterOnly) {
			await db.query(
				`UPDATE toc
				 SET intro = CASE WHEN ? IS NOT NULL AND (intro IS NULL OR intro = '') THEN ? ELSE intro END,
				     start = CASE WHEN ? IS NOT NULL AND start IS NULL THEN ? ELSE start END,
				     start0 = CASE WHEN ? IS NOT NULL AND start0 IS NULL THEN ? ELSE start0 END,
				     count = COALESCE(count, 0) + ?
				 WHERE id = ?`,
				[
					babResult.intro, babResult.intro,
					firstHadith ? firstHadith.num : null, firstHadith ? firstHadith.num : null,
					firstHadith ? firstHadith.num0 : null, firstHadith ? firstHadith.num0 : null,
					hadithCount,
					chapterRow.id
				]
			);
		} else {
			const existingBabRow = await findTocRow(db, options.targetBookId, 2, chapter.seq, bab.seq, null);
			if (existingBabRow) {
				tocId = existingBabRow.id;
			} else {
				const babOrdinal = run.nextTocOrdinal;
				const insertBabResult = await db.query(
					'INSERT INTO `toc` (`ordinal`, `bookId`, `level`, `h1`, `h2`, `h3`, `title`, `intro`, `start`, `start0`, `count`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
					[
						babOrdinal,
						options.targetBookId,
						2,
						chapter.seq,
						bab.seq,
						null,
						resolvedBabTitle,
						babResult.intro,
						firstHadith ? firstHadith.num : null,
						firstHadith ? firstHadith.num0 : null,
						hadithCount
					]
				);
				tocId = insertBabResult.insertId;
				babRowInserted = true;
			}

			await db.query(
				`UPDATE toc
				 SET start = CASE WHEN ? IS NOT NULL AND start IS NULL THEN ? ELSE start END,
				     start0 = CASE WHEN ? IS NOT NULL AND start0 IS NULL THEN ? ELSE start0 END,
				     count = COALESCE(count, 0) + ?
				 WHERE id = ?`,
				[
					firstHadith ? firstHadith.num : null, firstHadith ? firstHadith.num : null,
					firstHadith ? firstHadith.num0 : null, firstHadith ? firstHadith.num0 : null,
					hadithCount,
					chapterRow.id
				]
			);
		}

		if (hadithCount > 0) {
			const startingOrdinal = run.nextHadithOrdinal;
			const hadithRows = babResult.hadiths.map((hadith, index) => [
				startingOrdinal + index,
				options.targetBookId,
				tocId,
				index + 1,
				0,
				hadith.num,
				hadith.numActual,
				hadith.num0,
				null,
				hadith.chain || null,
				hadith.body || hadith.text,
				null,
				hadith.text,
				null
			]);
			await bulkInsert(db,
				'`hadiths` (`ordinal`, `bookId`, `tocId`, `numInChapter`, `remark`, `num`, `numActual`, `num0`, `title`, `chain`, `body`, `footnote`, `text`, `gradeText`)',
				hadithRows
			);
		}

		await db.commit();

		if (babRowInserted) {
			run.nextTocOrdinal += 1;
		}
		run.nextHadithOrdinal += hadithCount;

		return {
			tocId: tocId,
			hadithCount: hadithCount
		};
	} catch (err) {
		try {
			await db.rollback();
		} catch (_rollbackErr) {
			// Ignore rollback failure and rethrow original error.
		}
		throw err;
	}
}

async function findTocRow(db, targetBookId, level, h1, h2, h3) {
	const rows = await db.query(
		`SELECT id, ordinal, level, h1, h2, h3, title, intro, start, start0, count
		 FROM toc
		 WHERE bookId = ?
		   AND level = ?
		   AND h1 = ?
		   AND ((h2 IS NULL AND ? IS NULL) OR h2 = ?)
		   AND ((h3 IS NULL AND ? IS NULL) OR h3 = ?)
		 ORDER BY id
		 LIMIT 1`,
		[targetBookId, level, h1, h2, h2, h3, h3]
	);
	return rows[0] || null;
}

async function bulkInsert(db, tableClause, rows, batchSize = 100) {
	for (let i = 0; i < rows.length; i += batchSize) {
		const batch = rows.slice(i, i + batchSize);
		await db.query(`INSERT INTO ${tableClause} VALUES ?`, [batch]);
	}
}

function makeBabKey(chapterSeq, babSeq) {
	return `${chapterSeq}:${babSeq}`;
}

function parseBookTitle(html) {
	const $ = cheerio.load(html);
	return cleanInlineText(
		$('.heading h2 a[href*="show=book&book_id="]').first().text()
		|| $('.breadcrumb li.active').first().text()
	);
}

function parseBookPage(html, sourceBookId) {
	const $ = cheerio.load(html);
	const chapters = [];
	const seen = new Set();

	$(`table.table a[href*="show=chapter"][href*="book=${sourceBookId}"]`).each((i, el) => {
		const href = $(el).attr('href');
		const url = makeUrl(href);
		const chapterId = extractInt(url, 'chapter_id');
		if (!chapterId || seen.has(chapterId)) {
			return;
		}
		seen.add(chapterId);
		chapters.push({
			seq: chapters.length + 1,
			chapterId: chapterId,
			title: cleanInlineText($(el).text()),
			url: url
		});
	});

	if (chapters.length === 0) {
		throw new Error('No chapter links were found on the book page.');
	}

	return chapters;
}

function parseChapterPage(html) {
	const $ = cheerio.load(html);
	const babs = [];
	const seen = new Set();

	$('table.table a[href*="show=bab"]').each((i, el) => {
		const href = $(el).attr('href');
		const url = makeUrl(href);
		const babId = extractInt(url, 'bab_id');
		if (!babId || seen.has(babId)) {
			return;
		}
		seen.add(babId);
		babs.push({
			seq: babs.length + 1,
			babId: babId,
			title: cleanInlineText($(el).text()),
			url: url
		});
	});

	return babs;
}

async function scrapeBab(chapter, bab, options) {
	const pagesToVisit = [bab.url];
	const seenPages = new Set();
	const introParts = [];
	const hadithsByNum = new Map();
	let resolvedTitle = null;

	while (pagesToVisit.length > 0) {
		const pageUrl = pagesToVisit.shift();
		const pageKey = normalizeComparableUrl(pageUrl);
		if (seenPages.has(pageKey)) {
			continue;
		}
		seenPages.add(pageKey);

		const html = await fetchHtml(pageUrl, options);
		const parsed = parseBabPage(html, pageUrl);
		if (!resolvedTitle && parsed.title) {
			resolvedTitle = parsed.title;
		}

		for (const link of parsed.paginationLinks) {
			const linkKey = normalizeComparableUrl(link);
			if (!seenPages.has(linkKey)) {
				pagesToVisit.push(link);
			}
		}

		for (const panel of parsed.panels) {
			if (!panel.plainText) {
				continue;
			}
			const hadithText = stripLeadingNumber(panel.displayText);
			const plainText = stripLeadingNumber(panel.plainText);
			const numberMatch = panel.plainText.match(/^(\d+)\s+/);

			if (!numberMatch) {
				const introText = cleanHadithText(panel.displayText || panel.plainText);
				if (introText) {
					introParts.push(introText);
				}
				continue;
			}

			const num = numberMatch[1];
			if (hadithsByNum.has(num)) {
				continue;
			}

			const split = Hadith.splitHadithText({
				bookId: options.targetBookId,
				num: num,
				text: cleanHadithText(hadithText)
			}) || {};

			hadithsByNum.set(num, {
				num: num,
				numActual: num,
				num0: Number.parseInt(num, 10),
				text: cleanHadithText(hadithText),
				plainText: cleanHadithText(plainText),
				chain: cleanNullableText(split.chain),
				body: cleanNullableText(split.body || split.text),
				sourceHadithId: panel.hadithId,
				sourceSelId: panel.selId,
				sourceUrl: pageUrl,
				chapter: chapter.title,
				bab: bab.title
			});
		}
	}

	const hadiths = Array.from(hadithsByNum.values()).sort((a, b) => a.num0 - b.num0);
	for (const hadith of hadiths) {
		hadith.bab = resolvedTitle || bab.title;
	}
	return {
		title: resolvedTitle || bab.title,
		intro: dedupeParagraphs(introParts).join('\n\n') || null,
		hadiths: hadiths
	};
}

function parseBabPage(html, pageUrl) {
	const $ = cheerio.load(html);
	const panels = [];
	const title = cleanInlineText(
		$('.page-header .breadcrumb li.active').first().text()
		|| $('.heading .inverted').first().text()
	);

	$('div[id^="tab_hadith_"]').each((i, el) => {
		const panelId = $(el).attr('id') || '';
		const hadithId = panelId.replace(/^tab_hadith_/, '').trim();
		const takshilNode = $(el).find('.tashkeel .HadetheGeneral').first();
		const plainNode = $(el).find('.notashkeel .HadetheGeneral').first();
		const displayText = extractNodeText($, takshilNode);
		const plainText = extractNodeText($, plainNode) || displayText;
		const selId = extractSelId($(el).html() || '');

		panels.push({
			hadithId: hadithId,
			selId: selId,
			displayText: displayText,
			plainText: plainText,
			sourceUrl: pageUrl
		});
	});

	const paginationLinks = [];
	$('div.pagination2 a[href*="show=bab"]').each((i, el) => {
		const link = makeUrl($(el).attr('href'));
		if (link) {
			paginationLinks.push(link);
		}
	});

	return {
		title: title || null,
		panels: panels,
		paginationLinks: uniqueStrings(paginationLinks)
	};
}

function extractSelId(html) {
	const match = html.match(/selid=(\d+)/);
	return match ? Number.parseInt(match[1], 10) : null;
}

function extractNodeText($, node) {
	if (!node || node.length === 0) {
		return '';
	}
	const clone = node.clone();
	clone.find('br').replaceWith('\n');
	clone.find('span[style*="display: none"]').remove();
	return cleanHadithText(clone.text());
}

function cleanHadithText(text) {
	if (!text) {
		return '';
	}
	let cleaned = String(text);
	cleaned = cleaned.replace(/\u00a0/g, ' ');
	cleaned = cleaned.replace(/\u200f/g, '');
	cleaned = cleaned.replace(/هذه القراءةُ حاسوبية، وما زالت قيدُ الضبطِ والتطوير،?/g, '');
	cleaned = cleaned.replace(/\[\s*ص\s*:\s*\d+\s*\]/g, '');
	cleaned = cleaned.replace(/\r/g, '\n');
	cleaned = cleaned.replace(/[ \t]+\n/g, '\n');
	cleaned = cleaned.replace(/\n{2,}/g, '\n');
	cleaned = cleaned.replace(/[ \t]{2,}/g, ' ');
	return cleaned.trim();
}

function cleanNullableText(text) {
	const cleaned = cleanHadithText(text);
	return cleaned || null;
}

function stripLeadingNumber(text) {
	if (!text) {
		return '';
	}
	return cleanHadithText(text.replace(/^\d+\s+/, ''));
}

function cleanInlineText(text) {
	return String(text || '').replace(/\s+/g, ' ').trim();
}

function dedupeParagraphs(parts) {
	const seen = new Set();
	const deduped = [];
	for (const part of parts) {
		const cleaned = cleanHadithText(part);
		if (!cleaned || seen.has(cleaned)) {
			continue;
		}
		seen.add(cleaned);
		deduped.push(cleaned);
	}
	return deduped;
}

function uniqueStrings(arr) {
	const seen = new Set();
	const out = [];
	for (const value of arr) {
		if (!value || seen.has(value)) {
			continue;
		}
		seen.add(value);
		out.push(value);
	}
	return out;
}

function makeUrl(urlish) {
	if (!urlish) {
		return null;
	}
	return new URL(urlish, BASE_URL).toString();
}

function extractInt(urlish, name) {
	const url = new URL(urlish, BASE_URL);
	const value = url.searchParams.get(name);
	if (!value) {
		return null;
	}
	const parsed = Number.parseInt(value, 10);
	return Number.isInteger(parsed) ? parsed : null;
}

function normalizeComparableUrl(urlish) {
	const url = new URL(urlish, BASE_URL);
	url.hash = '';
	return url.toString();
}

async function fetchHtml(url, options) {
	const cachePath = path.join(
		options.cacheDir,
		`${crypto.createHash('sha1').update(normalizeComparableUrl(url)).digest('hex')}.html`
	);

	if (options.useCache) {
		try {
			return await fs.readFile(cachePath, 'utf8');
		} catch (err) {
			if (err.code !== 'ENOENT') {
				throw err;
			}
		}
	}

	console.error(`GET ${url}`);
	const response = await axios.get(url, {
		timeout: options.timeoutMs,
		responseType: 'text',
		headers: {
			'User-Agent': USER_AGENT,
			'Accept': 'text/html,application/xhtml+xml'
		}
	});

	if (options.useCache) {
		await fs.mkdir(options.cacheDir, { recursive: true });
		await fs.writeFile(cachePath, response.data, 'utf8');
	}

	if (options.delayMs > 0) {
		await sleep(options.delayMs);
	}

	return response.data;
}

function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
	parseArgs,
	parseBookPage,
	parseChapterPage,
	parseBabPage,
	scrapeBab,
	initializeRun,
	makeBabKey
};

if (require.main === module) {
	main().catch(err => {
		console.error(err.stack || err.message || err);
		process.exit(1);
	});
}
