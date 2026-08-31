#!/usr/bin/env node
/* jslint node:true, esversion:11 */
'use strict';

require('dotenv').config();
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const mysql = require('mysql');
const os = require('os');
const path = require('path');
const util = require('util');
const Hadith = require('../../lib/Hadith');

const BASE_URL = 'https://hdith.com';
const DEFAULT_CONCURRENCY = 12;
const DEFAULT_BOOKS = Object.freeze({
	'b-16': { id: 30, alias: 'abdalrazzaq', expectedHadiths: 21109 },
	'b-15': { id: 31, alias: 'ibnabishaybah', expectedHadiths: 39098 }
});
const GRADE_LABELS = Object.freeze({ 0: 'لم يُحكَمْ عليه', 1: 'صحيح', 2: 'صحيح الإسناد', 3: 'ضعيف', 4: 'ضعيف الإسناد' });
const CACHE_DIR = path.join(os.tmpdir(), 'hadithdb-hdith-import');
let dbConnection;

const options = readOptions(process.argv.slice(2));
const http = axios.create({
	baseURL: BASE_URL,
	timeout: 30000,
	headers: { 'User-Agent': 'HadithDB hdith.com importer/1.0' }
});

async function main() {
	try {
		if (options.normalizeExisting) {
			await normalizeExistingBooks();
			return;
		}
		for (const sourceId of options.books) {
			const config = Object.assign({ sourceId }, DEFAULT_BOOKS[sourceId]);
			const source = await loadOrScrapeBook(config);
			printSummary(source, options.dryRun);
			if (!options.dryRun)
				await replaceBook(source);
		}
	} catch (err) {
		console.error(`ERROR: ${err.stack || err.message}`);
		process.exitCode = 1;
	} finally {
		await closeDatabase();
	}
}

async function loadOrScrapeBook(config) {
	fs.mkdirSync(CACHE_DIR, { recursive: true });
	const cacheFile = path.join(CACHE_DIR, `${config.sourceId}.json`);
	if (fs.existsSync(cacheFile)) {
		const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
		if (cached.hadiths?.length === config.expectedHadiths) {
			console.log(`Using complete temporary scrape cache for ${config.alias}.`);
			return cached;
		}
	}
	const source = await scrapeBook(config);
	fs.writeFileSync(cacheFile, JSON.stringify(source));
	return source;
}

if (require.main === module)
	main();

function readOptions(args) {
	const parsed = { books: Object.keys(DEFAULT_BOOKS), concurrency: DEFAULT_CONCURRENCY, dryRun: false, normalizeExisting: false };
	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--dry-run') parsed.dryRun = true;
		else if (args[i] === '--normalize-existing') parsed.normalizeExisting = true;
		else if (args[i] === '--book') parsed.books = [args[++i]];
		else if (args[i] === '--books') parsed.books = args[++i].split(',').map(value => value.trim()).filter(Boolean);
		else if (args[i] === '--concurrency') parsed.concurrency = Number(args[++i]);
		else if (args[i] === '--help') usage(0);
		else usage(1, `Unknown option: ${args[i]}`);
	}
	if (!Number.isInteger(parsed.concurrency) || parsed.concurrency < 1 || parsed.concurrency > 40)
		usage(1, '--concurrency must be an integer from 1 to 40.');
	for (const sourceId of parsed.books) {
		if (!DEFAULT_BOOKS[sourceId])
			usage(1, `Unknown book '${sourceId}'. Add it to DEFAULT_BOOKS first.`);
	}
	return parsed;
}

function usage(exitCode, message) {
	if (message) console.error(message);
	console.error('Usage: node bin/utils/import-hdith-book.js [--book b-16 | --books b-16,b-15] [--concurrency 12] [--dry-run] [--normalize-existing]');
	process.exit(exitCode);
}

async function scrapeBook(config) {
	const first = await fetchHtml(`/encyclopedia/book/${config.sourceId}`);
	const page = inertiaProps(first);
	const chapters = page.chapters.map((chapter, index) => ({
		id: Number(chapter.id),
		h1: index + 1,
		title: compact(chapter.t),
		sourceCount: Number(chapter.count) || 0,
		hadiths: []
	}));
	if (!chapters.length) throw new Error(`${config.sourceId}: no chapters found in the book aside.`);

	await mapLimit(chapters, Math.min(options.concurrency, chapters.length), async chapter => {
		const html = await fetchHtml(`/encyclopedia/book/${config.sourceId}?chapter=${chapter.id}`);
		const visible = listingHadiths(html, config, chapter);
		if (!visible.length) throw new Error(`${config.sourceId}: chapter ${chapter.id} has no linked .h-card entries.`);
		const visibleGrades = new Map(visible.map(hadith => [hadith.sourceHadithId, hadith.gradeText]));
		chapter.hadiths = await scrapeChapter(config, chapter, visible[0].url, visibleGrades);
		buildSubsections(chapter);
		const h3Count = chapter.subsections.reduce((count, subsection) => count + subsection.sections.length, 0);
		console.log(`${config.alias}: ${chapter.title}: fetched ${chapter.hadiths.length}/${chapter.sourceCount} hadith(s), ${chapter.subsections.length} h2, and ${h3Count} h3 heading(s).`);
	});

	const hadiths = chapters.flatMap(chapter => chapter.hadiths);
	if (hadiths.length !== config.expectedHadiths)
		throw new Error(`${config.sourceId}: expected ${config.expectedHadiths} hadiths, found ${hadiths.length}.`);
	const duplicateIds = duplicates(hadiths.map(hadith => hadith.sourceHadithId));
	if (duplicateIds.length) throw new Error(`${config.sourceId}: duplicate source hadith IDs: ${duplicateIds.join(', ')}`);

	return {
		config,
		metadata: bookMetadata(page.book, config),
		chapters,
		hadiths
	};
}

async function scrapeChapter(config, chapter, firstUrl, visibleGrades) {
	const found = [];
	let url = firstUrl;
	while (found.length < chapter.sourceCount) {
		if (!url) throw new Error(`${config.sourceId}: chapter ${chapter.id} ended after ${found.length}/${chapter.sourceCount} hadiths.`);
		const match = url.match(new RegExp(`^/encyclopedia/book/${config.sourceId}/h/(\\d+)$`));
		if (!match) throw new Error(`${config.sourceId}: unexpected next-hadith URL '${url}'.`);
		const sourceHadithId = Number(match[1]);
		const html = await fetchHtml(url);
		const record = detailRecord(html, config, chapter, sourceHadithId, url, visibleGrades.get(sourceHadithId));
		if (!record) throw new Error(`${config.sourceId}: ${url} is outside chapter ${chapter.id}.`);
		found.push(record);
		url = record.nextUrl;
	}
	return found.map((hadith, index) => Object.assign(hadith, { numInChapter: index + 1 }));
}

function detailRecord(html, config, chapter, sourceHadithId, url, visibleGrade) {
	const props = inertiaProps(html);
	const source = props.hadith;
	const $ = cheerio.load(html);
	const breadcrumb = $('.enc-breadcrumb a').map((unused, link) => ({
		href: $(link).attr('href') || '',
		title: compact($(link).text())
	})).get().filter(item => item.href.startsWith(`/encyclopedia/book/${config.sourceId}?chapter=`));
	const h1 = breadcrumb[0] || null;
	const h2 = breadcrumb[1] || null;
	const h3 = breadcrumb[2] || null;
	const h1Match = h1?.href.match(/[?&]chapter=(\d+)/);
	const h2Match = h2?.href.match(/[?&]chapter=(\d+)/);
	const h3Match = h3?.href.match(/[?&]chapter=(\d+)/);
	if (!source || source.book?.slug !== config.sourceId || Number(h1Match?.[1]) !== chapter.id)
		return null;
	const num = compact(source.numbering_harf || source.numberings?.[0]?.value);
	if (!num) throw new Error(`${config.sourceId}: no hadith number on ${url}.`);
	const nextUrl = $('#app > div > main > div > div:nth-child(2) > div.h-utility-toolbar.h-utility-toolbar--desktop a[aria-label="التالي"]').attr('href') || null;
	return Object.assign({
		sourceHadithId,
		url,
		h1: chapter.h1,
		sourceSubsectionId: h2Match ? Number(h2Match[1]) : null,
		subsectionTitle: h2 ? h2.title : null,
		sourceSectionId: h3Match ? Number(h3Match[1]) : null,
		sectionTitle: h3 ? h3.title : null,
		nextUrl,
		num,
		num0: numericHadithNumber(num),
		ordinal: 0,
		gradeText: visibleGrade || GRADE_LABELS[Number(source.grading?.[0]?.degree) || 0]
	}, detailFields(html, { url }));
}

function buildSubsections(chapter) {
	const byId = new Map();
	for (const hadith of chapter.hadiths) {
		if (!hadith.sourceSubsectionId) continue;
		if (!byId.has(hadith.sourceSubsectionId)) {
			byId.set(hadith.sourceSubsectionId, {
				id: hadith.sourceSubsectionId,
				h2: byId.size + 1,
				title: hadith.subsectionTitle,
				hadiths: [],
				sections: []
			});
		}
		const subsection = byId.get(hadith.sourceSubsectionId);
		subsection.hadiths.push(hadith);
		hadith.h2 = subsection.h2;
	}
	chapter.subsections = [...byId.values()];
	for (const subsection of chapter.subsections) {
		const sectionsById = new Map();
		for (const hadith of subsection.hadiths) {
			if (!hadith.sourceSectionId) continue;
			if (!sectionsById.has(hadith.sourceSectionId)) {
				sectionsById.set(hadith.sourceSectionId, {
					id: hadith.sourceSectionId,
					h3: sectionsById.size + 1,
					title: hadith.sectionTitle,
					hadiths: []
				});
			}
			const section = sectionsById.get(hadith.sourceSectionId);
			section.hadiths.push(hadith);
			hadith.h3 = section.h3;
		}
		subsection.sections = [...sectionsById.values()];
	}
}

function inertiaProps(html) {
	const $ = cheerio.load(html);
	const json = $('script[data-page="app"][type="application/json"]').html();
	if (!json) throw new Error('Page is missing hdith.com application data.');
	return JSON.parse(json).props;
}

function listingHadiths(html, config, chapter) {
	const $ = cheerio.load(html);
	const rows = [];
	$('.h-card.block').each((index, element) => {
		const card = $(element);
		const href = card.attr('href') || '';
		const match = href.match(new RegExp(`^/encyclopedia/book/${config.sourceId}/h/(\\d+)$`));
		if (!match) return;
		const header = card.children('div').filter((unused, child) => compact($(child).children('span').first().text()) === 'حديث').first();
		const headerSpans = header.children('span');
		const num = compact(headerSpans.eq(1).text());
		const gradeText = compact(headerSpans.last().text()) || null;
		if (!num) throw new Error(`${config.sourceId}: no hadith number on ${href}.`);
		rows.push({
			sourceHadithId: Number(match[1]),
			url: href,
			h1: chapter.h1,
			num,
			num0: numericHadithNumber(num),
			numInChapter: index + 1,
			ordinal: 0,
			gradeText
		});
	});
	return rows;
}

function detailFields(html, hadith) {
	const $ = cheerio.load(html);
	const isnad = $('.isnad-prose').first().clone();
	isnad.find('sup').remove();
	let chain = compact(isnad.text()) || null;
	let body = compact($('blockquote.h-display').first().text());
	if (!chain || !body) {
		const source = inertiaProps(html).hadith;
		if (!chain && source?.isnad_html) {
			const fallbackIsnad = cheerio.load(`<div>${source.isnad_html}</div>`);
			fallbackIsnad('sup').remove();
			chain = compact(fallbackIsnad('div').text()) || null;
		}
		if (!body) body = compact(source?.matn);
	}
	if (!body) throw new Error(`No hadith text found on ${hadith.url}.`);
	chain = normalizeHadithText(chain) || null;
	body = normalizeHadithText(body);
	return { chain, chain_en: Hadith.transliteratedNarratorChain(chain || '').chain_en || null,
		body, text: compact(`${chain || ''} ${body}`) };
}

const ARABIC_MARKS = '[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]*';
const markedWord = letters => [...letters].map(letter => `${letter}${ARABIC_MARKS}`).join('');
const PAGE_REFERENCE_RE = /ج[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]*[٠-٩0-9]+\s*\/\s*ص[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]*[٠-٩0-9]+/gu;
const SALAWAT_RE = new RegExp(`${markedWord('صلى')}\\s+${markedWord('الله')}\\s+${markedWord('عليه')}\\s+${markedWord('وسلم')}`, 'gu');
const RADI_RE = new RegExp(
	`${markedWord('رض')}[يى]${ARABIC_MARKS}\\s+${markedWord('الله')}` +
	`(?:\\s+${markedWord('تعالى')})?\\s+${markedWord('عن')}(?:${markedWord('هما')}|${markedWord('هم')}|${markedWord('هن')}|${markedWord('ها')}|${markedWord('ه')})`,
	'gu'
);

function normalizeHadithText(value, counts) {
	if (value === null || value === undefined) return value;
	let text = String(value);
	text = text.replace(PAGE_REFERENCE_RE, () => {
		if (counts) counts.pageReferences++;
		return '';
	});
	text = text.replace(SALAWAT_RE, () => {
		if (counts) counts.salawat++;
		return 'ﷺ';
	});
	text = text.replace(RADI_RE, () => {
		if (counts) counts.radi++;
		return 'ؓ';
	});
	return text.replace(/ {2,}/g, ' ').trim();
}

async function normalizeExistingBooks() {
	const connection = await getConnection();
	const bookIds = options.books.map(sourceId => DEFAULT_BOOKS[sourceId].id);
	const counts = { rows: 0, pageReferences: 0, salawat: 0, radi: 0 };
	let lastId = 0;
	try {
		await query(connection, 'START TRANSACTION');
		await query(connection, `CREATE TEMPORARY TABLE hdith_normalized_hadiths (
			id INT NOT NULL PRIMARY KEY, chain LONGTEXT NULL, chain_en LONGTEXT NULL, body LONGTEXT NULL, text LONGTEXT NULL
		)`);
		while (true) {
			const rows = await query(connection,
				'SELECT id, chain, chain_en, body, text FROM hadiths WHERE bookId IN (?) AND id>? ORDER BY id LIMIT 500',
				[bookIds, lastId]);
			if (!rows.length) break;
			const changed = [];
			for (const row of rows) {
				lastId = row.id;
				const chain = normalizeHadithText(row.chain, counts);
				const chainEn = Hadith.transliteratedNarratorChain(chain || '').chain_en || null;
				const body = normalizeHadithText(row.body, counts);
				const text = normalizeHadithText(row.text, counts);
				if (chain === row.chain && chainEn === row.chain_en && body === row.body && text === row.text) continue;
				changed.push([row.id, chain, chainEn, body, text]);
				counts.rows++;
			}
			if (changed.length) {
				await query(connection, 'INSERT INTO hdith_normalized_hadiths (id, chain, chain_en, body, text) VALUES ?', [changed]);
				await query(connection, `UPDATE hadiths h JOIN hdith_normalized_hadiths n ON n.id=h.id
					SET h.chain=n.chain, h.chain_en=n.chain_en, h.body=n.body, h.text=n.text`);
				await query(connection, 'DELETE FROM hdith_normalized_hadiths');
			}
		}
		await query(connection, 'COMMIT');
		console.log(`Normalized ${counts.rows} hadith row(s): removed ${counts.pageReferences} page reference(s), replaced ${counts.salawat} salawat phrase(s), and replaced ${counts.radi} companion blessing phrase(s).`);
	} catch (err) {
		await query(connection, 'ROLLBACK').catch(() => {});
		throw err;
	}
}

function bookMetadata(book, config) {
	if (!book || book.slug !== config.sourceId) throw new Error(`${config.sourceId}: unexpected book metadata.`);
	return {
		id: config.id,
		alias: config.alias,
		shortName: compact(book.short_name || book.title),
		name: compact(book.title),
		author: compact(book.author),
		death: Number(book.author_death) || null,
		publisher: compact(book.era) || null,
		description: compact(book.summary) || null,
		source: `${BASE_URL}/encyclopedia/book/${config.sourceId}`
	};
}

async function replaceBook(source) {
	const connection = await getConnection();
	try {
		await query(connection, 'START TRANSACTION');
		const conflicts = await query(connection, 'SELECT id, alias FROM books WHERE (id=? OR alias=?) AND NOT (id=? AND alias=?) FOR UPDATE',
			[source.config.id, source.config.alias, source.config.id, source.config.alias]);
		if (conflicts.length) throw new Error(`Book id/alias conflict: ${JSON.stringify(conflicts)}`);
		await query(connection, `
			INSERT INTO books (id, ordinal, alias, type, shortName_en, shortName, name_en, name, author_en, author, death, publisher, description, hidden, source, lang, content_lastmod)
			VALUES (?, ?, ?, 'hadith', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'ar', NOW())
			ON DUPLICATE KEY UPDATE ordinal=VALUES(ordinal), shortName_en=VALUES(shortName_en), shortName=VALUES(shortName),
				name_en=VALUES(name_en), name=VALUES(name), author_en=VALUES(author_en), author=VALUES(author), death=VALUES(death),
				publisher=VALUES(publisher), description=VALUES(description), hidden=0, source=VALUES(source), lang='ar', content_lastmod=NOW()`,
			[source.metadata.id, source.metadata.id, source.metadata.alias, source.metadata.name, source.metadata.shortName,
			 source.metadata.name, source.metadata.name, source.metadata.author, source.metadata.author, source.metadata.death,
			 source.metadata.publisher, source.metadata.description, source.metadata.source]);
		await query(connection, 'DELETE FROM hadiths WHERE bookId=?', [source.config.id]);
		await query(connection, 'DELETE FROM toc WHERE bookId=?', [source.config.id]);

		let ordinal = 0;
		const tocValues = [];
		for (const chapter of source.chapters) {
			const start = chapter.hadiths[0] || null;
			const end = chapter.hadiths[chapter.hadiths.length - 1] || null;
			tocValues.push([++ordinal, source.config.id, 1, chapter.h1, null, null, chapter.title,
				start && start.num, end && end.num, start && start.num0, end && end.num0, chapter.hadiths.length]);
			for (const subsection of chapter.subsections) {
				const subsectionStart = subsection.hadiths[0];
				const subsectionEnd = subsection.hadiths[subsection.hadiths.length - 1];
				tocValues.push([++ordinal, source.config.id, 2, chapter.h1, subsection.h2, null, subsection.title,
					subsectionStart.num, subsectionEnd.num, subsectionStart.num0, subsectionEnd.num0, subsection.hadiths.length]);
				for (const section of subsection.sections) {
					const sectionStart = section.hadiths[0];
					const sectionEnd = section.hadiths[section.hadiths.length - 1];
					tocValues.push([++ordinal, source.config.id, 3, chapter.h1, subsection.h2, section.h3, section.title,
						sectionStart.num, sectionEnd.num, sectionStart.num0, sectionEnd.num0, section.hadiths.length]);
				}
			}
		}
		for (let offset = 0; offset < tocValues.length; offset += 500) {
			await query(connection, `
				INSERT INTO toc (ordinal, bookId, level, h1, h2, h3, title, start, end, start0, end0, count)
				VALUES ?`, [tocValues.slice(offset, offset + 500)]);
		}
		const tocRows = await query(connection, 'SELECT id, level, h1, h2, h3 FROM toc WHERE bookId=?', [source.config.id]);
		const tocIds = new Map(tocRows.map(row => [`${row.level}:${row.h1}:${row.h2 || ''}:${row.h3 || ''}`, row.id]));
		for (const hadith of source.hadiths) {
			hadith.tocId = tocIds.get(`${hadith.h3 ? 3 : hadith.h2 ? 2 : 1}:${hadith.h1}:${hadith.h2 || ''}:${hadith.h3 || ''}`);
			if (!hadith.tocId) throw new Error(`No TOC row for ${source.config.alias} ${hadith.num}.`);
		}

		for (let offset = 0; offset < source.hadiths.length; offset += 250) {
			const batch = source.hadiths.slice(offset, offset + 250);
			const values = batch.map(hadith => [
					++ordinal, source.config.id, hadith.tocId, hadith.numInChapter, hadith.h1, hadith.h2 || null, hadith.h3 || null, hadith.num,
					hadith.num0, hadith.gradeText, hadith.chain, hadith.chain_en, hadith.body, hadith.text
				]);
				await query(connection, `
					INSERT INTO hadiths (ordinal, bookId, tocId, numInChapter, h1, h2, h3, num, num0, gradeText, chain, chain_en, body, text)
				VALUES ?`, [values]);
		}
		await query(connection, 'COMMIT');
		console.log(`Imported ${source.hadiths.length} hadith(s) and ${source.chapters.length} chapter(s) as '${source.config.alias}' (books.id=${source.config.id}).`);
	} catch (err) {
		await query(connection, 'ROLLBACK').catch(() => {});
		throw err;
	} finally {
	}
}

async function fetchHtml(url, attempt = 1) {
	try {
		const response = await http.get(url);
		return response.data;
	} catch (err) {
		if (attempt >= 4) throw new Error(`Failed to download ${url}: ${err.message}`);
		await new Promise(resolve => setTimeout(resolve, attempt * 750));
		return fetchHtml(url, attempt + 1);
	}
}

async function fetchHtmlOrNull(url, attempt = 1) {
	try {
		const response = await http.get(url);
		return response.data;
	} catch (err) {
		if (err.response?.status === 404) return null;
		if (attempt >= 4) throw new Error(`Failed to download ${url}: ${err.message}`);
		await new Promise(resolve => setTimeout(resolve, attempt * 750));
		return fetchHtmlOrNull(url, attempt + 1);
	}
}

async function mapLimit(items, concurrency, worker) {
	let next = 0;
	const results = new Array(items.length);
	async function run() {
		while (next < items.length) {
			const index = next++;
			results[index] = await worker(items[index], index);
		}
	}
	await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
	return results;
}

function numericHadithNumber(value) {
	const western = String(value).replace(/[٠-٩]/g, digit => '٠١٢٣٤٥٦٧٨٩'.indexOf(digit));
	const match = western.match(/\d+(?:\.\d+)?/);
	if (!match) throw new Error(`Unsupported hadith number '${value}'.`);
	return Number(match[0]);
}

function compact(value) {
	return String(value || '').replace(/[\u200e\u200f]/g, '').replace(/\s+/g, ' ').trim();
}

function duplicates(values) {
	const seen = new Set();
	return [...new Set(values.filter(value => seen.has(value) || !seen.add(value)))];
}

function printSummary(source, dryRun) {
	const footnoteMarks = source.hadiths.filter(hadith => /\[[٠-٩0-9]+\]/.test(hadith.chain)).length;
	console.log(`${dryRun ? 'Checked' : 'Scraped'} '${source.config.alias}': ${source.chapters.length} chapters, ${source.hadiths.length} hadiths, ${footnoteMarks} isnads still containing bracketed footnote marks.`);
}

function getConnection() {
	if (!dbConnection) dbConnection = mysql.createConnection(appMysqlConnection());
	if (dbConnection.state === 'authenticated') return Promise.resolve(dbConnection);
	return new Promise((resolve, reject) => dbConnection.connect(err => err ? reject(err) : resolve(dbConnection)));
}

function query(connection, sql, values) {
	return util.promisify(connection.query).call(connection, sql, values);
}

function appMysqlConnection() {
	const settingsFile = path.join(os.homedir(), '.hadithdb', 'settings.json');
	const configured = JSON.parse(fs.readFileSync(settingsFile, 'utf8')).mysql?.connection || {};
	return {
		host: process.env.MYSQL_HOST || configured.host || '127.0.0.1',
		port: Number(process.env.MYSQL_PORT || configured.port || 3306),
		user: process.env.MYSQL_USER || configured.user || process.env.USER,
		password: process.env.MYSQL_PASSWORD || configured.password || '',
		database: process.env.MYSQL_DATABASE || configured.database || 'hadithdb'
	};
}

async function closeDatabase() {
	if (dbConnection) await new Promise(resolve => dbConnection.end(resolve));
}

module.exports = { bookMetadata, compact, detailFields, inertiaProps, listingHadiths, normalizeHadithText, numericHadithNumber };
