#!/usr/bin/env node
/* jslint node:true, esversion:11 */
'use strict';

require('dotenv').config();
const axios = require('axios');
const cheerio = require('cheerio');
const childProcess = require('child_process');
const fs = require('fs');
const mysql = require('mysql');
const os = require('os');
const path = require('path');
const util = require('util');
const Utils = require('../../lib/Utils');

const INDEX_URL = 'http://inter-islam.org/hadeeth/hadeethdex.htm';
const MENU_URL = 'http://inter-islam.org/hadeeth/stmenu.htm';
const SOURCE_TITLE = 'خصائل نبوي';
const SOURCE_TITLE_EN = 'Khasail Nabawi';
const SOURCE_AUTHOR = 'Muhammad Zakariyya Kandhlawi';
const SOURCE_BOOK_ID = -3;
const SHAMAIL_BOOK_ID = 32;
const CACHE_DIR = process.env.INTER_ISLAM_SHAMAIL_CACHE_DIR || path.join('/tmp', 'hadithdb-inter-islam-shamail-sharh');
const REQUEST_HEADERS = Object.freeze({
	'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140.0 Safari/537.36',
	Accept: 'text/html,application/xhtml+xml',
	'Accept-Language': 'en-US,en;q=0.9',
	Referer: 'http://www.inter-islam.org/'
});

// The source's 55 chapters correspond to 57 local TOC entries. Two long source
// chapters are split locally, and "Standard of Living" is stored out of sequence.
const LOCAL_CHAPTER_TITLES = Object.freeze([
	['Noble Features'], ['Seal of Prophethood'], ['Hair'], ['Combing of Hair'], ['White Hair'], ['Hair Dye'],
	['Eyeliner'], ['Clothing'], ['Socks'], ['Shoes'], ['Ring'], ['Ring on His Right Hand'], ['Sword'], ['Armor'],
	['Helmet'], ['Turban'], ['Waistcloth'], ['Walking'], ['Headcovering'], ['Sitting'], ['Pillow'], ['Leaning'],
	['Meals'], ['Bread'], ['Eating with Bread'], ['Wudu at Time of Eating'], ['Supplications of Eating'],
	['Beverage Cup'], ['Eating of Fruits'], ['Beverages'], ['Manner of Drinking'], ['Perfume'], ['Speech'],
	['Laugh'], ['Joking'], ['About Poetry'], ['Telling of Stories', 'Hadith of Umm Zara'], ['Sleeping'],
	['Worship and Devotion'], ['Mid-morning Prayers'], ['Voluntary Prayers'], ['Fasting'], ['Recitation'], ['Weeping'],
	['Bedding'], ['Humility'], ['Noble Character'], ['Modesty'], ['Cupping'], ['Standard of Living', 'Lifestyle'],
	['Names'], ['Age'], ['Death'], ['Legacy'], ['Dreaming About Prophet ﷺ']
]);

const options = require.main === module ? readOptions(process.argv.slice(2)) : { apply: false, refresh: false, skipIndex: false };

async function main() {
	let connection;
	try {
		fs.mkdirSync(CACHE_DIR, { recursive: true });
		const source = await loadSource();
		connection = databaseConnection();
		const query = util.promisify(connection.query).bind(connection);
		const localChapters = await loadLocalChapters(query);
		const matches = matchSourceToLocal(source, localChapters);
		const imported = matches.filter(match => match.source.commentary);
		printSummary(source, localChapters, matches, imported);
		if (!options.apply) {
			console.log('Dry run only. Re-run with --apply to import the commentary.');
			return;
		}
		await applyImport(query, imported);
		console.log(`Imported ${imported.length} English commentary record(s) from ${SOURCE_TITLE}.`);
		if (!options.skipIndex) indexHadiths(imported.map(match => match.local.id));
	} finally {
		if (connection) connection.end();
	}
}

function readOptions(args) {
	const parsed = { apply: false, refresh: false, skipIndex: false };
	for (const arg of args) {
		if (arg === '--apply') parsed.apply = true;
		else if (arg === '--refresh') parsed.refresh = true;
		else if (arg === '--skip-index') parsed.skipIndex = true;
		else if (arg === '--help') usage(0);
		else usage(1, `Unknown option: ${arg}`);
	}
	if (parsed.skipIndex && !parsed.apply) usage(1, '--skip-index requires --apply.');
	return parsed;
}

function usage(code, message) {
	if (message) console.error(message);
	console.error('Usage: node bin/utils/import-inter-islam-shamail-sharh.js [--apply] [--refresh] [--skip-index]');
	process.exit(code);
}

async function loadSource() {
	const menuHtml = await fetchCached(MENU_URL, path.join(CACHE_DIR, 'stmenu.htm'));
	const links = chapterLinks(menuHtml);
	if (links.length !== 55) throw new Error(`Expected 55 source chapters, found ${links.length}.`);
	const chapters = [];
	let sourceEntryId = 0;
	for (const link of links) {
		const url = new URL(link.href, MENU_URL).href;
		const html = await fetchCached(url, path.join(CACHE_DIR, link.href));
		const chapter = parseChapter(html, url, link.chapter);
		for (const hadith of chapter.hadiths) hadith.sourceEntryId = ++sourceEntryId;
		chapters.push(chapter);
	}
	if (sourceEntryId !== 397) throw new Error(`Expected 397 source hadith/athar entries, found ${sourceEntryId}.`);
	return chapters;
}

async function fetchCached(url, filename) {
	if (!options.refresh && fs.existsSync(filename)) return fs.readFileSync(filename, 'utf8');
	const response = await axios.get(url, { headers: REQUEST_HEADERS, responseType: 'arraybuffer', timeout: 30000 });
	const html = new TextDecoder('windows-1252').decode(response.data);
	if (!/<html\b/i.test(html)) throw new Error(`Source did not return HTML: ${url}`);
	fs.writeFileSync(filename, html);
	return html;
}

function chapterLinks(html) {
	const $ = cheerio.load(html);
	const links = [];
	$('a[href]').each((unused, element) => {
		const href = $(element).attr('href') || '';
		const match = /^st(\d+)\.(?:html?)$/i.exec(href);
		if (!match || links.some(link => link.chapter === Number(match[1]))) return;
		links.push({ chapter: Number(match[1]), href });
	});
	return links.sort((a, b) => a.chapter - b.chapter);
}

function parseChapter(html, url, chapterNumber) {
	const $ = cheerio.load(html, { sourceCodeLocationInfo: true });
	const textNodes = descendantTextNodes($('body').get(0));
	const headings = textNodes.map(node => {
		const text = compact(node.data);
		const match = /^\(?(\d+)(?:\s*(?:&|and|-)\s*(\d+))?\)?\s*(?:ha(?:dith|deeth|adith)|athar)\b/i.exec(text);
		if (!match || !node.sourceCodeLocation) return null;
		const explicitCount = match[2] ? Number(match[2]) - Number(match[1]) + 1 : 1;
		const describedPair = /(?:ha(?:dith|deeth|adith)|athar)\D+\d+\s*(?:&|and|-)\s*\d+/i.test(text);
		return { node, printedNumber: Number(match[1]), count: Math.max(explicitCount, describedPair ? 2 : 1), offset: node.sourceCodeLocation.startOffset };
	}).filter(Boolean);
	const commentaryMarkers = textNodes.filter(node => node.sourceCodeLocation && /^commentary\.?$/i.test(compact(node.data)))
		.map(node => ({ node, offset: node.sourceCodeLocation.startOffset, endOffset: node.sourceCodeLocation.endOffset }));
	const backLinks = $('a[href]').toArray().filter(element => /^#top$/i.test($(element).attr('href') || '') && element.sourceCodeLocation)
		.map(element => element.sourceCodeLocation.startOffset).sort((a, b) => a - b);
	const namedAnchors = $('a[name]').toArray().filter(element => element.sourceCodeLocation).map(element => ({
		name: $(element).attr('name'), offset: element.sourceCodeLocation.startOffset
	})).sort((a, b) => a.offset - b.offset);
	if (!headings.length) throw new Error(`No hadith headings found in source chapter ${chapterNumber}: ${url}`);
	const hadiths = headings.flatMap((heading, index) => {
		const nextHeadingOffset = headings[index + 1]?.offset || html.length;
		const markers = commentaryMarkers.filter(marker => marker.offset > heading.offset && marker.offset < nextHeadingOffset);
		const firstCommentaryOffset = markers[0]?.offset || nextHeadingOffset;
		const sourceText = markdownFragment(html.slice(heading.node.sourceCodeLocation.endOffset, firstCommentaryOffset));
		const blocks = markers.map((marker, markerIndex) => {
			const nextMarkerOffset = markers[markerIndex + 1]?.offset || nextHeadingOffset;
			const backOffset = backLinks.find(offset => offset > marker.endOffset && offset < nextMarkerOffset);
			return markdownFragment(html.slice(marker.endOffset, backOffset || nextMarkerOffset));
		}).filter(Boolean);
		const anchor = [...namedAnchors].reverse().find(item => item.offset <= heading.offset && heading.offset - item.offset < 500);
		const shared = { sourceText, commentary: normalizeCommentary(blocks.join('\n\n')), sourceUrl: anchor?.name ? `${url}#${anchor.name}` : url };
		return Array.from({ length: heading.count }, (unused, offset) => Object.assign({ printedNumber: heading.printedNumber + offset }, shared));
	});
	return { chapter: chapterNumber, url, hadiths };
}

function descendantTextNodes(root) {
	const output = [];
	(function visit(node) {
		if (!node) return;
		if (node.type === 'text') output.push(node);
		for (const child of node.children || []) visit(child);
	})(root);
	return output;
}

function markdownFragment(fragment) {
	const source = String(fragment || '').replace(/\r?\n/g, ' ');
	return Utils.htmlToMarkdown(`<p>${source}</p>`)
		.replace(/\[?back\]?\(#top\)/gi, '').replace(/^back$/gim, '').replace(/\n{3,}/g, '\n\n').trim();
}

function compact(value) {
	return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeCommentary(value) {
	return String(value || '')
		.replace(/Sallallahu 'Alayhi Wasallam/g, 'ﷺ')
		.replace(/\(Sallallahu alaihe wasallam\)/g, 'ﷺ')
		.replace(/\(\s*Rad[a-z]*?ll[a-z]*\s*'?\s*'?Anh(?:u|a|um)\.?\s*\)/gi, 'ᴿᴬ')
		.replace(/\bRad[a-z]*?ll[a-z]*\s*'?\s*'?Anh(?:u|a|um)\b/gi, 'ᴿᴬ')
		.replace(/\(\s*R\.?\s*A\.?\s*\)/gi, 'ᴿᴬ');
}

function databaseConnection() {
	const settings = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.hadithdb', 'settings.json'), 'utf8'));
	return mysql.createConnection(settings.mysql.connection);
}

async function loadLocalChapters(query) {
	const tocRows = await query(`SELECT id, title_en FROM toc WHERE bookId=${SHAMAIL_BOOK_ID} AND level=2`);
	const tocByTitle = new Map(tocRows.map(row => [row.title_en, row]));
	const chapters = [];
	for (let index = 0; index < LOCAL_CHAPTER_TITLES.length; index++) {
		const titles = LOCAL_CHAPTER_TITLES[index];
		const rows = [];
		for (const title of titles) {
			const toc = tocByTitle.get(title);
			if (!toc) throw new Error(`Missing local Shamail TOC section: ${title}`);
			const hadiths = await query(`SELECT id, num, ordinal, chain_en, body_en FROM hadiths
				WHERE bookId=${SHAMAIL_BOOK_ID} AND tocId=${Number(toc.id)} AND remark<>2 ORDER BY ordinal, id`);
			rows.push(...hadiths.map(row => Object.assign(row, { chapterTitle: title })));
		}
		chapters.push({ chapter: index + 1, titles, hadiths: rows });
	}
	return chapters;
}

function matchSourceToLocal(sourceChapters, localChapters) {
	if (sourceChapters.length !== localChapters.length) throw new Error('Source/local chapter count mismatch.');
	const matches = [];
	for (let index = 0; index < sourceChapters.length; index++) {
		const source = sourceChapters[index].hadiths;
		const local = localChapters[index].hadiths;
		if (local.length < source.length)
			throw new Error(`Source chapter ${index + 1} has ${source.length} entries but local sections ${localChapters[index].titles.join(' + ')} have ${local.length}.`);
		try { matches.push(...alignSequences(source, local)); }
		catch (err) { throw new Error(`Chapter ${index + 1} (${localChapters[index].titles.join(' + ')}): ${err.message}`); }
	}
	return matches;
}

function alignSequences(source, local) {
	if (source.length === local.length) return source.map((item, index) => ({ source: item, local: local[index], score: similarity(item.sourceText, localText(local[index])) }));
	const rows = source.length + 1;
	const columns = local.length + 1;
	const dp = Array.from({ length: rows }, () => Array(columns).fill(-Infinity));
	const action = Array.from({ length: rows }, () => Array(columns).fill(null));
	for (let j = 0; j < columns; j++) dp[0][j] = 0;
	for (let i = 1; i < rows; i++) {
		for (let j = 1; j < columns; j++) {
			if (dp[i][j - 1] > dp[i][j]) {
				dp[i][j] = dp[i][j - 1];
				action[i][j] = 'skip';
			}
			const score = dp[i - 1][j - 1] + similarity(source[i - 1].sourceText, localText(local[j - 1]));
			if (score > dp[i][j]) {
				dp[i][j] = score;
				action[i][j] = 'match';
			}
		}
	}
	const aligned = [];
	let i = source.length;
	let j = local.length;
	while (i > 0 && j > 0) {
		if (action[i][j] === 'match') {
			const score = similarity(source[i - 1].sourceText, localText(local[j - 1]));
			aligned.unshift({ source: source[i - 1], local: local[j - 1], score });
			i--;
			j--;
		} else j--;
	}
	if (aligned.length !== source.length) throw new Error('Could not align every source entry to a local hadith.');
	const weak = aligned.filter(match => match.score < 0.03);
	if (weak.length) throw new Error(`Ambiguous source alignment; ${weak.map(match => `source ${match.source.printedNumber} -> local ${match.local.num} (${match.score.toFixed(3)})`).join(', ')}.`);
	return aligned;
}

function localText(row) {
	return `${row.chain_en || ''} ${row.body_en || ''}`;
}

function similarity(left, right) {
	const a = wordSet(left);
	const b = wordSet(right);
	if (!a.size || !b.size) return 0;
	let overlap = 0;
	for (const word of a) if (b.has(word)) overlap++;
	return (2 * overlap) / (a.size + b.size);
}

function wordSet(value) {
	const normalized = String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
	const ignored = new Set(['the', 'and', 'that', 'his', 'was', 'had', 'said', 'from', 'with', 'for', 'this', 'allahu', 'alayhi', 'wasallam', 'radiyallahu', 'anhu', 'anha']);
	return new Set(normalized.split(/[^a-z0-9]+/).filter(word => word.length > 2 && !ignored.has(word)));
}

function printSummary(source, local, matches, imported) {
	const sourceCount = source.reduce((sum, chapter) => sum + chapter.hadiths.length, 0);
	const localCount = local.reduce((sum, chapter) => sum + chapter.hadiths.length, 0);
	const scores = matches.map(match => match.score).sort((a, b) => a - b);
	console.log(`Source: ${source.length} chapters, ${sourceCount} hadith/athar entries, ${imported.length} with commentary.`);
	console.log(`Local mapping: ${localCount} candidate records, ${matches.length} matched; similarity min=${scores[0].toFixed(3)}, median=${scores[Math.floor(scores.length / 2)].toFixed(3)}.`);
}

async function applyImport(query, imported) {
	await query('START TRANSACTION');
	try {
		await query(`INSERT INTO hdith_sharh_sources (source_book_id, title, title_en, author, source_url)
			VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE
			title=IF(title='' OR title='Khasail Nabawi', VALUES(title), title),
			title_en=COALESCE(NULLIF(title_en, ''), VALUES(title_en)), author=VALUES(author), source_url=VALUES(source_url), id=LAST_INSERT_ID(id)`,
			[SOURCE_BOOK_ID, SOURCE_TITLE, SOURCE_TITLE_EN, SOURCE_AUTHOR, INDEX_URL]);
		const sourceId = (await query('SELECT LAST_INSERT_ID() AS id'))[0].id;
		const sourceTitles = (await query('SELECT title, title_en FROM hdith_sharh_sources WHERE id=? LIMIT 1', [sourceId]))[0];
		await query(`DELETE hs FROM hdith_hadith_sharh hs JOIN hadiths h ON h.id=hs.hadith_id
			WHERE hs.source_id=? AND h.bookId=?`, [sourceId, SHAMAIL_BOOK_ID]);
		for (const match of imported) {
			await query(`INSERT INTO hdith_hadith_sharh
				(hadith_id, source_id, source_entry_id, chapter, page_num, title, title_en, text, text_en, format, source_url)
				VALUES (?, ?, ?, ?, NULL, ?, ?, '', ?, 'md', ?)`,
			[match.local.id, sourceId, match.source.sourceEntryId, match.local.chapterTitle,
				sourceTitles.title, sourceTitles.title_en, match.source.commentary, match.source.sourceUrl]);
		}
		await query('COMMIT');
	} catch (err) {
		await query('ROLLBACK');
		throw err;
	}
}

function indexHadiths(ids) {
	const script = path.resolve(__dirname, '../indexEnrichedHadithBatch.js');
	for (let index = 0; index < ids.length; index += 100)
		childProcess.execFileSync(process.execPath, [script, ...ids.slice(index, index + 100).map(String)], { stdio: 'inherit' });
}

if (require.main === module) main().catch(err => {
	console.error(err.stack || err.message);
	process.exitCode = 1;
});

module.exports = { alignSequences, chapterLinks, LOCAL_CHAPTER_TITLES, markdownFragment, normalizeCommentary, parseChapter, similarity };
