#!/usr/bin/env node
/* jslint node:true, esversion:11 */
'use strict';

require('dotenv').config();
const AdmZip = require('adm-zip');
const cheerio = require('cheerio');
const fs = require('fs');
const mysql = require('mysql');
const path = require('path');
const util = require('util');
const HadithHeadingSharh = require('../lib/HadithHeadingSharh');
const Utils = require('../lib/Utils');
const { connectionSettings } = require('./initializeHadithAttributions');

const EPUB = path.resolve(__dirname, '../temp/شرح رياض الصالحين للعثيمين.epub');
const SOURCE_BOOK_ID = -5;
const SOURCE_TITLE = 'شرح رياض الصالحين';
const SOURCE_TITLE_EN = 'Explanation of Riyad al-Salihin';
const SOURCE_AUTHOR = 'محمد بن صالح العثيمين';
const BOOK_ALIAS = 'riyad';
const MAX_RIYAD_NUMBER = 1896;
const APPLY = process.argv.includes('--apply');

function clean(value) {
	return String(value || '').replace(/\r/g, '').replace(/\[\[(?:PAGE|HEADING):[^\]]+\]\]/g, '')
		.replace(/^\s*[-ـ]?\s*/u, '').split('\n').map(line => line.replace(/\s+/g, ' ').trim())
		.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function normalizeArabic(value) {
	return String(value || '').normalize('NFKD').replace(/[\u064B-\u065F\u0670\u06D6-\u06EDـ]/gu, '')
		.replace(/[إأآٱ]/gu, 'ا').replace(/ى/gu, 'ي').replace(/ؤ/gu, 'و').replace(/ئ/gu, 'ي').replace(/ة/gu, 'ه')
		.replace(/صلي الله عليه وسلم|صلى الله عليه وسلم|رضي الله عنهما?|متفق عليه|رواه/gu, ' ')
		.replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

function words(value) {
	return new Set(normalizeArabic(value).split(' ').filter(word => word.length >= 4));
}

function headingWords(value) {
	return new Set(normalizeArabic(value).split(' ').filter(word =>
		(/\p{Script=Arabic}/u.test(word) ? word.length >= 3 : word.length >= 4)));
}

function overlap(left, right) {
	const a = words(left);
	const b = words(right);
	let common = 0;
	for (const word of a) if (b.has(word)) common++;
	return common / Math.max(1, Math.min(a.size, b.size));
}

function headingOverlap(left, right) {
	const normalizedLeft = normalizeArabic(left);
	const normalizedRight = normalizeArabic(right);
	if (normalizedLeft && normalizedRight && normalizedLeft.includes(normalizedRight))
		return 3 - (normalizedLeft.indexOf(normalizedRight) / Math.max(1, normalizedLeft.length));
	if (normalizedLeft && normalizedRight && normalizedRight.includes(normalizedLeft)) return 2;
	const headingStopwords = new Set(['باب', 'كتاب', 'قال', 'الله', 'تعالي', 'رحمه', 'المولف', 'النووي', 'رياض', 'الصالحين']);
	const a = new Set([...headingWords(left)].filter(word => !headingStopwords.has(word)));
	const b = new Set([...headingWords(right)].filter(word => !headingStopwords.has(word)));
	let common = 0;
	for (const word of a) if (b.has(word)) common++;
	return (2 * common) / Math.max(1, a.size + b.size);
}

function sourceNumberMatches(value) {
	const matches = [];
	for (const match of String(value || '').matchAll(/(?:^|\n)\s*(?:(\d+)\s*[\/\\]\s*)?(\d{1,4})\s*[-ـ]\s*/gu))
		matches.push({ number: Number(match[2]), slash: Boolean(match[1]), index: match.index + match[0].indexOf(match[2]) });
	return matches;
}

function sourceTail(fragment) {
	const separators = [...String(fragment || '').matchAll(/\*\s*\*\s*\*/g)];
	const star = separators.length ? separators[separators.length - 1].index : -1;
	const heading = fragment.lastIndexOf('[[HEADING:');
	const start = Math.max(star, heading);
	return { start: Math.max(0, start), text: fragment.slice(Math.max(0, start)) };
}

function likelyHadithSource(value) {
	const text = clean(value);
	return /(?:متفق\s*عليه|رواه\s|وعن\s.{0,650}(?:رسول|النبي)|عن\s.{0,350}(?:قال|أن).{0,180}(?:رسول|النبي))/u.test(text);
}

function extractSource(zip) {
	const entries = zip.getEntries().filter(entry => /OEBPS\/xhtml\/P\d+\.xhtml$/.test(entry.entryName))
		.sort((left, right) => Number(left.entryName.match(/P(\d+)/)[1]) - Number(right.entryName.match(/P(\d+)/)[1]));
	let stream = '';
	for (const entry of entries) {
		const $ = cheerio.load(entry.getData().toString('utf8'), { decodeEntities: false });
		const page = Number(($('.center').text().match(/الصفحة:\s*(\d+)/u) || [])[1]) || null;
		$('#book-container a[id^="C"]').each((index, anchor) => {
			const id = $(anchor).attr('id');
			$(anchor).replaceWith(`\n[[HEADING:${id}]]\n`);
		});
		$('#book-container br').replaceWith('\n');
		stream += `\n[[PAGE:${page || ''}]]\n${$('#book-container').text()}`;
	}
	const markers = [...stream.matchAll(/EX/g)];
	return markers.map((marker, index) => {
		const beforeStart = index ? markers[index - 1].index + 2 : 0;
		const before = stream.slice(beforeStart, marker.index);
		const afterEnd = markers[index + 1] ? markers[index + 1].index : stream.length;
		const after = stream.slice(marker.index + 2, afterEnd);
		const tail = sourceTail(before);
		const pageMarkers = [...before.matchAll(/\[\[PAGE:(\d*)\]\]/g)];
		const headingMarkers = [...before.matchAll(/\[\[HEADING:([^\]]+)\]\]/g)];
		return {
			entryId: index + 1,
			page: Number((pageMarkers[pageMarkers.length - 1] || [])[1]) || null,
			headingAnchor: (headingMarkers[headingMarkers.length - 1] || [])[1] || null,
			source: clean(tail.text),
			sourceOffset: tail.start,
			betweenAfter: after
		};
	});
}

function alignBlocks(blocks, hadithTextByNumber) {
	let nextNumber = 1;
	let currentHeadingAnchor = null;
	let headingCommentaryAnchor = null;
	const review = [];
	for (const block of blocks) {
		if (block.headingAnchor) currentHeadingAnchor = block.headingAnchor;
		block.headingAnchor = currentHeadingAnchor;
		const sourceMatches = sourceNumberMatches(block.source);
		const startsWithHeading = /^\s*(?:\*\s*\*\s*\*\s*)?\d*\s*[-ـ]?\s*(?:باب|كتاب)/u.test(block.source);
		const printed = sourceMatches.filter(match => match.number >= 1 && match.number <= MAX_RIYAD_NUMBER)
			.filter(match => match.slash || overlap(block.source, hadithTextByNumber.get(match.number)) >= 0.28)
			.map(match => match.number);
		if (!printed.length && (startsWithHeading || (headingCommentaryAnchor && block.headingAnchor === headingCommentaryAnchor))) {
			block.hadithNumbers = [];
			headingCommentaryAnchor = block.headingAnchor;
			continue;
		}
		if (printed.length) {
			const distinctPrinted = [...new Set(printed)].sort((a, b) => a - b);
			block.hadithNumbers = distinctPrinted;
			nextNumber = Math.max(nextNumber, Math.max(...block.hadithNumbers) + 1);
			headingCommentaryAnchor = null;
			continue;
		}
		let best = null;
		for (let number = nextNumber; number <= Math.min(MAX_RIYAD_NUMBER, nextNumber + 25); number++) {
			const text = hadithTextByNumber.get(number);
			if (!text) continue;
			const score = overlap(block.source, text);
			if (!best || score > best.score) best = { number, score };
		}
		if (best && best.score >= 0.42) {
			block.hadithNumbers = [best.number];
			nextNumber = best.number + 1;
		} else if (likelyHadithSource(block.source) && hadithTextByNumber.has(nextNumber)) {
			block.hadithNumbers = [nextNumber++];
			review.push({ entryId: block.entryId, number: block.hadithNumbers[0], score: best ? best.score : 0, reason: 'sequential' });
		} else {
			block.hadithNumbers = [];
		}
	}
	return review;
}

function commentaryEnd(fragment, followingBlock) {
	const tail = sourceTail(fragment);
	if (tail.start > 0) return tail.start;
	const numberMatches = sourceNumberMatches(fragment);
	if (numberMatches.length) return numberMatches[0].index;
	if (followingBlock && followingBlock.hadithNumbers.length) {
		const candidates = [...fragment.matchAll(/(?:^|\n\s*\n)\s*(?:وعن|عن)\s/gu)];
		if (candidates.length) return candidates[candidates.length - 1].index;
	}
	return fragment.length;
}

function extractCommentaries(blocks) {
	for (let index = 0; index < blocks.length; index++) {
		const next = blocks[index + 1];
		const end = commentaryEnd(blocks[index].betweenAfter, next);
		blocks[index].text = clean(blocks[index].betweenAfter.slice(0, end));
	}
	return blocks.filter(block => block.text);
}

function headingTitleFromBlock(block) {
	const beforeFollowingHeading = clean(block.source).split(/\n?\/0L\d+\s+/u)[0];
	const lines = beforeFollowingHeading.replace(/^\d+\s*[-ـ]\s*/u, '').split('\n')
		.map(line => line.replace(/^\/0L\d+\s*/u, '').replace(/\s+/g, ' ').trim()).filter(Boolean);
	const sourceTitle = lines.find(line => /(?:^|\s)(?:باب|كتاب)\s/u.test(line)) || lines[0];
	if (sourceTitle) return sourceTitle;
	// A few EPUB page breaks place EX immediately after a heading anchor, leaving
	// the pre-EX source empty. The opening explanation still names that heading.
	return clean(block.text).slice(0, 240);
}

function mapHeadingAnchors(blocks, tocRows) {
	const mapping = new Map();
	const currentTocByAnchor = new Map();
	for (const block of blocks) {
		if (!block.headingAnchor || block.hadithNumbers.length || /^C[123]$/u.test(block.headingAnchor)) continue;
		const title = headingTitleFromBlock(block);
		let best = null;
		for (let tocIndex = 0; tocIndex < tocRows.length; tocIndex++) {
			const toc = tocRows[tocIndex];
			const score = headingOverlap(title, toc.title);
			if (!best || score > best.score) best = { toc, score, tocIndex };
		}
		if (best && best.score >= 0.25) {
			mapping.set(block.entryId, best.toc);
			currentTocByAnchor.set(block.headingAnchor, best.toc);
		}
		else if (currentTocByAnchor.has(block.headingAnchor))
			mapping.set(block.entryId, currentTocByAnchor.get(block.headingAnchor));
	}
	return mapping;
}

function groupHeadingRows(rows) {
	const grouped = new Map();
	for (const row of rows) {
		const existing = grouped.get(row.tocId);
		if (!existing) {
			grouped.set(row.tocId, Object.assign({}, row, { sourceEntryIds: [row.sourceEntryId] }));
			continue;
		}
		existing.text = [existing.text, row.text].filter(Boolean).join('\n\n');
		existing.sourceEntryIds.push(row.sourceEntryId);
		if (!existing.page && row.page) existing.page = row.page;
	}
	return [...grouped.values()];
}

async function applyImport(query, book, source, hadithRows, headingRows) {
	const sourceId = Number(source.id);
	await query('START TRANSACTION');
	try {
		await query(`DELETE hs FROM hdith_hadith_sharh hs
			JOIN hadiths_virtual hv ON hv.hadithId=hs.hadith_id AND hv.bookId=?
			WHERE hs.source_id=?`, [book.id, sourceId]);
		await query(`DELETE ts FROM hdith_toc_sharh ts JOIN toc t ON t.id=ts.toc_id
			WHERE t.bookId=? AND ts.source_id=?`, [book.id, sourceId]);
		for (const row of hadithRows) await query(`INSERT INTO hdith_hadith_sharh
			(hadith_id,ordinal,source_id,source_entry_id,chapter,page_num,title,title_en,text,text_en,format,source_url)
			VALUES (?,?,?,?,?,?,?,?,?,NULL,'md','')`, [row.hadithId, row.ordinal, sourceId, row.sourceEntryId,
			row.chapter, row.page, source.title, source.title_en, row.text]);
		for (const row of headingRows) await query(`INSERT INTO hdith_toc_sharh
			(toc_id,ordinal,source_id,source_entry_id,page_num,title,title_en,text,text_en,format,source_url)
			VALUES (?,?,?,?,?,?,?,?,NULL,'md','')`, [row.tocId, row.ordinal, sourceId, row.sourceEntryId,
			row.page, source.title, source.title_en, row.text]);
		await query('COMMIT');
	} catch (err) {
		await query('ROLLBACK');
		throw err;
	}
}

async function main() {
	if (!fs.existsSync(EPUB)) throw new Error(`EPUB not found: ${EPUB}`);
	const blocks = extractSource(new AdmZip(EPUB));
	let connection;
	try {
		connection = mysql.createConnection(connectionSettings());
		const query = util.promisify(connection.query).bind(connection);
		await util.promisify(connection.connect).call(connection);
		const book = (await query('SELECT id FROM books WHERE alias=? AND `virtual`=1 LIMIT 1', [BOOK_ALIAS]))[0];
		if (!book) throw new Error(`Virtual book ${BOOK_ALIAS} not found`);
		const virtualRows = await query(`SELECT hv.id,FLOOR(hv.num0) AS number,hv.hadithId,
			COALESCE(NULLIF(hv.textActual, ''), CONCAT_WS(' ', h.chain, h.body)) AS matchText, t.title AS chapter
			FROM hadiths_virtual hv JOIN hadiths h ON h.id=hv.hadithId LEFT JOIN toc t ON t.id=hv.tocId
			WHERE hv.bookId=? AND hv.hadithId IS NOT NULL ORDER BY hv.num0,(hv.textActual IS NULL),hv.id`, [book.id]);
		const primaryByNumber = new Map();
		for (const row of virtualRows) if (!primaryByNumber.has(Number(row.number))) primaryByNumber.set(Number(row.number), row);
		const textByNumber = new Map([...primaryByNumber].filter(([, row]) => row.matchText).map(([number, row]) => [number, row.matchText]));
		const review = alignBlocks(blocks, textByNumber);
		extractCommentaries(blocks);
		const dumpEntry = Number((process.argv.find(argument => argument.startsWith('--dump=')) || '').split('=')[1]);
		if (dumpEntry) {
			console.log(JSON.stringify(blocks.slice(Math.max(0, dumpEntry - 2), dumpEntry + 1), null, 2));
			return;
		}
		const tocRows = await query(`SELECT id,ordinal,level,h1,h2,h3,title FROM toc WHERE bookId=?
			AND level IN (1,2) ORDER BY ordinal,id`, [book.id]);
		const headingMap = mapHeadingAnchors(blocks, tocRows);
		const hadithRows = [];
		const headingRows = [];
		const unmappedHeadingBlocks = [];
		for (const block of blocks) {
			if (block.hadithNumbers.length) {
				for (const number of block.hadithNumbers) {
					const local = primaryByNumber.get(number);
					if (!local) continue;
				hadithRows.push({ hadithId: local.hadithId, ordinal: block.entryId, sourceEntryId: block.entryId * 10000 + number,
						chapter: local.chapter, page: block.page, text: block.text, number });
				}
			} else {
				const toc = headingMap.get(block.entryId);
				if (toc) headingRows.push({ tocId: toc.id, ordinal: block.entryId, sourceEntryId: block.entryId,
					page: block.page, text: block.text, anchor: block.headingAnchor,
					sourceTitle: headingTitleFromBlock(block), tocTitle: toc.title,
					headingScore: headingOverlap(headingTitleFromBlock(block), toc.title) });
				else unmappedHeadingBlocks.push({ entryId: block.entryId, page: block.page, anchor: block.headingAnchor,
					source: block.source.slice(0, 180) });
			}
		}
		const duplicateHadithKeys = hadithRows.length - new Set(hadithRows.map(row => `${row.hadithId}:${row.sourceEntryId}`)).size;
		const groupedHeadingRows = groupHeadingRows(headingRows);
		if (process.argv.includes('--audit-headings'))
			console.log(JSON.stringify(headingRows.map(row => ({ entryId: row.sourceEntryId, tocId: row.tocId, page: row.page,
				anchor: row.anchor, sourceTitle: row.sourceTitle, tocTitle: row.tocTitle, headingScore: row.headingScore })), null, 2));
		const stats = {
			exBlocks: blocks.length,
			hadithCommentaryBlocks: blocks.filter(block => block.hadithNumbers.length).length,
			headingCommentaryBlocks: headingRows.length,
			headingRows: groupedHeadingRows.length,
			hadithRows: hadithRows.length,
			distinctRiyadNumbers: new Set(hadithRows.map(row => row.number)).size,
			distinctHadithIds: new Set(hadithRows.map(row => row.hadithId)).size,
			headingBlocksMapped: headingMap.size,
			sequentialReview: review.length,
			duplicateHadithKeys
		};
		console.log(JSON.stringify(stats, null, 2));
		console.log(`Sequential review sample: ${JSON.stringify(review.slice(0, 30), null, 2)}`);
		if (unmappedHeadingBlocks.length)
			console.log(`Unmapped heading sample: ${JSON.stringify(unmappedHeadingBlocks.slice(0, 20), null, 2)}`);
		if (!APPLY) {
			console.log('Dry run only; no database rows changed.');
			return;
		}
		if (duplicateHadithKeys) throw new Error('Refusing to import duplicate hadith/source-entry keys');
		await HadithHeadingSharh.ensureSchema(query);
		await query(`INSERT INTO hdith_sharh_sources (source_book_id,title,title_en,author,source_url)
			VALUES (?,?,?,?, '') ON DUPLICATE KEY UPDATE author=VALUES(author),id=LAST_INSERT_ID(id)`,
			[SOURCE_BOOK_ID, SOURCE_TITLE, SOURCE_TITLE_EN, SOURCE_AUTHOR]);
		const source = (await query('SELECT id,title,title_en FROM hdith_sharh_sources WHERE source_book_id=? LIMIT 1', [SOURCE_BOOK_ID]))[0];
		await applyImport(query, book, source, hadithRows, groupedHeadingRows);
		console.log(`Imported ${hadithRows.length} hadith and ${groupedHeadingRows.length} heading commentary rows.`);
		await Utils.flushCacheContaining(BOOK_ALIAS);
		await Utils.flushCacheContaining(`book:${BOOK_ALIAS}`);
	} finally {
		if (connection) connection.end();
	}
}

if (require.main === module) main().catch(err => {
	console.error(err.stack || err.message);
	process.exitCode = 1;
});

module.exports = { alignBlocks, clean, commentaryEnd, extractCommentaries, extractSource, groupHeadingRows, likelyHadithSource, mapHeadingAnchors, sourceNumberMatches, sourceTail };
