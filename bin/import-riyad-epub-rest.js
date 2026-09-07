#!/usr/bin/env node
/* jslint node:true, esversion:11 */
'use strict';

require('dotenv').config();
const AdmZip = require('adm-zip');
const cheerio = require('cheerio');
const fs = require('fs');
const mysql = require('mysql');
const path = require('path');
const stringSimilarity = require('string-similarity');
const util = require('util');
const { connectionSettings } = require('./initializeHadithAttributions');

const EPUB = path.resolve(__dirname, '../temp/ رياض الصالحين.epub');
const APPLY = process.argv.includes('--apply');
const MIN_RIYAD_NUMBER = 289;
const MAX_RIYAD_NUMBER = 1896;
const IMPORT_USER = 'epub:riyad-rest';
const MIN_SCORE = 0.28;
const REVIEW_SCORE = 0.38;
const OVERRIDES = new Map([
	// The local Bukhari corpus combines the edition's 1122 wording into 1121.
	['1162:bukhari', '1121']
]);

const SOURCES = [
	{ alias: 'nasai-kubra', patterns: [/النسائي\s+في\s+[«"“]?الكبرى/u, /النسائي\s+في\s+الكبرى/u] },
	{ alias: 'adab', patterns: [/الأدب\s+المفرد/u] },
	{ alias: 'abudawud', patterns: [/أبو\s+داود/u, /أبي\s+داود/u] },
	{ alias: 'ibnmajah', patterns: [/ابن\s+ماجه/u, /ابن\s+ماجة/u] },
	{ alias: 'ibnhibban', patterns: [/ابن\s+حبان/u] },
	{ alias: 'tirmidhi', patterns: [/الترمذي/u] },
	{ alias: 'bukhari', patterns: [/البخاري/u] },
	{ alias: 'muslim', patterns: [/(?<!صحيح\s)مسلم/u, /صحيح\s+مسلم/u] },
	{ alias: 'nasai', patterns: [/النسائي/u] },
	{ alias: 'malik', patterns: [/مالك/u] },
	{ alias: 'ahmad', patterns: [/أحمد/u] },
	{ alias: 'darimi', patterns: [/الدارمي/u] },
	{ alias: 'hakim', patterns: [/الحاكم/u] },
	{ alias: 'tabarani', patterns: [/الطبراني/u] },
	{ alias: 'bayhaqi', patterns: [/البيهقي/u] }
];

const STOP_WORDS = new Set('وعن رضي الله عنه عنها عنهما قال قالت يقول رسول النبي صلى عليه وسلم رواه حديث متفق تعالى كان تكون هذا هذه الذي التي إلى على من في عن أن إن ما لا لم له بها وهو هي ثم وقد أو كل حتى'.split(/\s+/));

function cleanText(value) {
	return String(value || '').replace(/\r/g, '').replace(/\[ص:\s*\d+\]/gu, '')
		.split('\n').map(line => line.replace(/\s+/g, ' ').replace(/\s+([،؛:.])/gu, '$1').trim())
		.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function normalizeBlessings(value) {
	return cleanText(value).replace(/\s*-\s*صلى الله عليه وسلم\s*-?/gu, ' ﷺ')
		.replace(/\s+-\s+رضي الله عنهما?\s+-?/gu, match => cleanText(match).replace(/^-\s*|\s*-$/g, ''));
}

function normalizeArabic(value) {
	return String(value || '').normalize('NFKD')
		.replace(/[\u064B-\u065F\u0670\u06D6-\u06EDـ]/gu, '')
		.replace(/[إأآٱ]/gu, 'ا').replace(/ى/gu, 'ي').replace(/ؤ/gu, 'و').replace(/ئ/gu, 'ي').replace(/ة/gu, 'ه')
		.replace(/صلى الله عليه وسلم|رضي الله عنهما?|رسول الله|النبي/gu, ' ')
		.replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

function stripArabicMarks(value) {
	return String(value || '').normalize('NFKD').replace(/[\u064B-\u065F\u0670\u06D6-\u06EDـ]/gu, '');
}

function contentWords(value) {
	return Array.from(new Set(normalizeArabic(value).split(' ').filter(word => word.length >= 4 && !STOP_WORDS.has(word))));
}

function matchingText(value) {
	const quotes = Array.from(String(value || '').matchAll(/«([^»]{5,})»/gu), match => match[1])
		.filter(quote => normalizeArabic(quote).length >= 18 && !/^حديث\s+(?:صحيح|حسن)/u.test(normalizeArabic(quote)));
	return quotes.length ? quotes.sort((a, b) => b.length - a.length)[0] : value;
}

function semanticScore(targetValue, candidateValue) {
	const target = normalizeArabic(targetValue);
	const candidate = normalizeArabic(candidateValue);
	if (!target || !candidate) return 0;
	if ((target.length >= 18 && candidate.includes(target)) || (candidate.length >= 18 && target.includes(candidate))) return 1;
	const targetWords = contentWords(target);
	const candidateWords = new Set(contentWords(candidate));
	const recall = targetWords.length ? targetWords.filter(word => candidateWords.has(word)).length / targetWords.length : 0;
	return Math.max(stringSimilarity.compareTwoStrings(target, candidate), recall * 0.9);
}

function titleScore(left, right) {
	return Math.max(semanticScore(left, right), semanticScore(right, left));
}

function sourceOccurrences(value) {
	const occurrences = [];
	for (const source of SOURCES) {
		for (const pattern of source.patterns) {
			const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
			for (const match of value.matchAll(new RegExp(pattern.source, flags)))
				occurrences.push({ alias: source.alias, index: match.index, end: match.index + match[0].length });
		}
	}
	// This edition sometimes gives the Sunan volume/page and then appends the
	// corresponding al-Kubra number: "والنسائي 8/271 وفي الكبرى له (7930)".
	// Treat those as two books, while excluding Nasai works not in our corpus.
	for (const match of value.matchAll(/النسائي(?<between>[^.\n]{0,100}?)الكبرى/gu)) {
		const kubraIndex = match.index + match[0].lastIndexOf('الكبرى');
		occurrences.push({ alias: 'nasai-kubra', index: kubraIndex, end: kubraIndex + 'الكبرى'.length });
	}
	return occurrences.sort((a, b) => a.index - b.index || b.end - a.end)
		.filter(item => {
			if (item.alias !== 'nasai') return true;
			const tail = value.slice(item.end, item.end + 45);
			if (/^\s+في\s+[«"“]?(?:عمل\s+اليوم\s+والليلة|الكبرى)/u.test(tail)) return false;
			return true;
		})
		.filter((item, index, all) => !all.some((other, otherIndex) => otherIndex < index && other.index <= item.index && other.end >= item.end));
}

function citedSources(footnote, mainText) {
	const refs = new Map();
	const lines = footnote.split(/\n+/).map(cleanText).filter(Boolean);
	for (const line of lines) {
		const citationStart = line.search(/أخرجه|أخرج|رواه/u);
		if (citationStart < 0) continue;
		const citationLine = line.slice(citationStart).split(/،?\s+(?:وذكره|وهو|وإسناده|وانظر|وشرح)/u)[0];
		const occurrences = sourceOccurrences(citationLine);
		for (let i = 0; i < occurrences.length; i++) {
			const item = occurrences[i];
			if (refs.has(item.alias)) continue;
			const end = i + 1 < occurrences.length ? occurrences[i + 1].index : citationLine.length;
			const tail = citationLine.slice(item.end, end);
			const numbers = Array.from(tail.matchAll(/\((\d{1,5})(?:\s*[م])?\)/gu), match => match[1]);
			if (numbers.length) refs.set(item.alias, numbers[0]);
			else refs.set(item.alias, null);
		}
	}
	if (!refs.size) {
		for (const occurrence of sourceOccurrences(stripArabicMarks(mainText.slice(Math.max(0, mainText.length - 500)))))
			if (!refs.has(occurrence.alias)) refs.set(occurrence.alias, null);
	}
	if (/مُتَّفَقٌ عَلَيهِ|متفقٌ عَلَيْهِ|متفق عليه/iu.test(mainText)) {
		if (!refs.has('bukhari')) refs.set('bukhari', null);
		if (!refs.has('muslim')) refs.set('muslim', null);
	}
	return refs;
}

function parseHadithGroups(zip) {
	const files = zip.getEntries().filter(entry => /^OEBPS\/xhtml\/P\d+\.xhtml$/.test(entry.entryName))
		.sort((a, b) => Number(a.entryName.match(/P(\d+)/)[1]) - Number(b.entryName.match(/P(\d+)/)[1]));
	const parsedFiles = [];
	const starts = new Map();
	for (let index = 0; index < files.length; index++) {
		const entry = files[index];
		const fileNumber = Number(entry.entryName.match(/P(\d+)/)[1]);
		if (fileNumber < 10) continue;
		const html = entry.getData().toString('utf8');
		const $ = cheerio.load(html, { xmlMode: true, decodeEntities: true });
		const footer = $('div.center').last().text();
		const match = footer.match(/الحديث:\s*(\d+)/u);
		const hasHeading = $('#book-container span.red').toArray().some(node => markerStartsHeading($, $(node)));
		parsedFiles.push({ fileNumber, html, hasHeading });
		if (match) starts.set(Number(match[1]), parsedFiles.length - 1);
	}
	const groups = new Map();
	for (let number = MIN_RIYAD_NUMBER; number <= MAX_RIYAD_NUMBER; number++) {
		const startIndex = starts.get(number);
		const nextIndex = starts.get(number + 1) ?? parsedFiles.length;
		if (startIndex === undefined) continue;
		const group = [];
		for (let index = startIndex; index < nextIndex; index++) {
			if (index > startIndex && parsedFiles[index].hasHeading) break;
			group.push(parsedFiles[index]);
		}
		groups.set(number, group);
	}
	return groups;
}

function parseHeadings(zip) {
	const files = zip.getEntries().filter(entry => /^OEBPS\/xhtml\/P\d+\.xhtml$/.test(entry.entryName))
		.map(entry => ({ entry, fileNumber: Number(entry.entryName.match(/P(\d+)/)[1]) }))
		.sort((a, b) => a.fileNumber - b.fileNumber);
	const hadithStarts = [];
	for (const file of files) {
		const $ = cheerio.load(file.entry.getData().toString('utf8'), { xmlMode: true, decodeEntities: true });
		const match = $('div.center').last().text().match(/الحديث:\s*(\d+)/u);
		if (match) hadithStarts.push({ fileNumber: file.fileNumber, number: Number(match[1]) });
	}
	const headings = [];
	for (const file of files) {
		const $ = cheerio.load(file.entry.getData().toString('utf8'), { xmlMode: true, decodeEntities: true });
		const container = $('#book-container');
		for (const markerNode of container.find('span.red').toArray()) {
			const marker = $(markerNode);
			if (!markerStartsHeading($, marker)) continue;
			let titleNode = markerNode.nextSibling;
			while (titleNode && titleNode.type === 'text' && !String(titleNode.data || '').trim()) titleNode = titleNode.nextSibling;
			const introParts = [];
			let current = titleNode.nextSibling;
			while (current) {
				if (current.type === 'tag' && $(current).hasClass('red')) break;
				if (current.type === 'tag' && ($(current).hasClass('footnote') || $(current).hasClass('footnote-hr'))) {
					current = current.nextSibling;
					continue;
				}
				if (current.type === 'tag' && current.name === 'br') introParts.push('\n\n');
				else introParts.push(current.type === 'text' ? current.data : $(current).text());
				current = current.nextSibling;
			}
			const nextHadith = hadithStarts.find(item => item.fileNumber > file.fileNumber);
			headings.push({ fileNumber: file.fileNumber, title: cleanText($(titleNode).text()),
				intro: normalizeBlessings(introParts.join('')), start: nextHadith ? nextHadith.number : null });
		}
	}
	return headings;
}

function markerStartsHeading($, marker) {
	let next = marker[0] && marker[0].nextSibling;
	while (next && next.type === 'text' && !String(next.data || '').trim()) next = next.nextSibling;
	return Boolean(next && next.type === 'tag' && $(next).hasClass('title'));
}

function extractHadith(group, number) {
	const textParts = [];
	const footnoteParts = [];
	for (let groupIndex = 0; groupIndex < group.length; groupIndex++) {
		const $ = cheerio.load(group[groupIndex].html, { xmlMode: true, decodeEntities: true });
		const container = $('#book-container').clone();
		if (groupIndex === 0) {
			const markers = container.find('span.red').filter((index, node) => {
				const markerNumber = Number(cleanText($(node).text()).replace(/\D/g, ''));
				return markerNumber === number && !markerStartsHeading($, $(node));
			});
			if (!markers.length) throw new Error(`Could not find Riyad ${number} marker in P${group[0].fileNumber}`);
			const marker = markers.first();
			const contents = container.contents();
			const markerIndex = contents.toArray().findIndex(node => node === marker[0]);
			if (markerIndex >= 0) contents.slice(0, markerIndex).remove();
			marker.remove();
		}
		container.find('.footnote').each((index, node) => {
			const clone = $(node).clone();
			clone.find('br').replaceWith('\n');
			footnoteParts.push(cleanText(clone.text()));
		});
		container.find('.footnote-hr, .footnote, hr').remove();
		container.find('span.title').filter((index, node) => /^\s*\[ص:/u.test($(node).text())).remove();
		container.find('br').replaceWith('\n\n');
		textParts.push(normalizeBlessings(container.text()));
	}
	const lines = cleanText(textParts.join('\n\n')).split(/\n{2,}/).filter(Boolean);
	const sourceLineIndex = lines.findIndex(line => /مُتَّفَقٌ عَلَيهِ|متفقٌ عَلَيْهِ|متفق عليه|رواه|حديث (?:حسن|صحيح)/iu.test(line));
	const textEnd = sourceLineIndex >= 0 ? sourceLineIndex + 1 : lines.length;
	return {
		number,
		textActual: lines.slice(0, textEnd).join('\n\n'),
		note: lines.length > textEnd ? lines.slice(textEnd).join('\n\n') : null,
		footnote: cleanText(footnoteParts.join('\n')),
		crossReferences: Array.from(cleanText(footnoteParts.join(' ')).matchAll(/انظر(?:\s+الحديث|\s+حديث|\s+الأحاديث)?\s*\((\d+)\)/gu), match => Number(match[1]))
	};
}

function buildCorpusIndex(rows) {
	const byAlias = new Map();
	for (const row of rows) {
		if (!byAlias.has(row.alias)) byAlias.set(row.alias, { rows: [], words: new Map(), byNum: new Map() });
		const corpus = byAlias.get(row.alias);
		row.normalized = normalizeArabic([row.chain, row.body].filter(Boolean).join(' '));
		row.words = contentWords([row.chain, row.body].filter(Boolean).join(' '));
		corpus.rows.push(row);
		if (!corpus.byNum.has(row.num.replace(/[a-z]+$/i, ''))) corpus.byNum.set(row.num.replace(/[a-z]+$/i, ''), []);
		corpus.byNum.get(row.num.replace(/[a-z]+$/i, '')).push(row);
		for (const word of row.words) {
			if (!corpus.words.has(word)) corpus.words.set(word, []);
			corpus.words.get(word).push(row);
		}
	}
	for (const corpus of byAlias.values()) {
		corpus.rows.sort((a, b) => Number(a.ordinal) - Number(b.ordinal));
		corpus.rows.forEach((row, index) => { row.corpusIndex = index; });
	}
	return byAlias;
}

function bestMatch(alias, corpus, hadith, printedNum, existingIds) {
	if (!corpus) return null;
	const candidateCounts = new Map();
	const targetText = matchingText(hadith.textActual);
	for (const word of contentWords(targetText)) {
		const matches = corpus.words.get(word) || [];
		if (matches.length > 80) continue;
		for (const row of matches) candidateCounts.set(row, (candidateCounts.get(row) || 0) + 1);
	}
	const candidates = new Set(Array.from(candidateCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 50).map(item => item[0]));
	if (printedNum && corpus.byNum.has(String(printedNum))) corpus.byNum.get(String(printedNum)).forEach(row => candidates.add(row));
	if (printedNum && corpus.byNum.has(String(printedNum))) {
		for (const exactRow of corpus.byNum.get(String(printedNum))) {
			for (let offset = -6; offset <= 6; offset++) {
				const neighbor = corpus.rows[exactRow.corpusIndex + offset];
				if (neighbor) candidates.add(neighbor);
			}
		}
	}
	corpus.rows.filter(row => existingIds.has(row.id)).forEach(row => candidates.add(row));
	const ranked = Array.from(candidates).map(row => ({
		row,
		score: Math.max(
			semanticScore(targetText, [row.chain, row.body].filter(Boolean).join(' ')),
			semanticScore(hadith.textActual, [row.chain, row.body].filter(Boolean).join(' '))
		),
		exact: Boolean(printedNum && row.num.replace(/[a-z]+$/i, '') === String(printedNum)),
		nearExact: Boolean(printedNum && corpus.byNum.has(String(printedNum)) && corpus.byNum.get(String(printedNum))
			.some(exactRow => Math.abs(exactRow.corpusIndex - row.corpusIndex) <= 6)),
		existing: existingIds.has(row.id)
	}))
		.sort((a, b) => b.score - a.score);
	if (!ranked.length) return null;
	const exact = ranked.filter(item => item.exact).sort((a, b) => b.score - a.score)[0];
	const existing = ranked.filter(item => item.existing).sort((a, b) => b.score - a.score)[0];
	let selected = ranked[0];
	if (alias !== 'nasai-kubra' && exact && exact.score >= MIN_SCORE) selected = exact;
	else if (exact && !['muslim', 'nasai', 'nasai-kubra'].includes(alias) && exact.score >= 0.05) selected = exact;
	else if (existing && existing.score >= MIN_SCORE && existing.score >= selected.score - 0.025) selected = existing;
	return { ...selected, runnerUp: ranked.find(item => item.row.id !== selected.row.id)?.score || 0 };
}

function choosePrimary(hadith, resolved) {
	const tailSources = sourceOccurrences(stripArabicMarks(hadith.textActual.slice(Math.max(0, hadith.textActual.length - 500)))).map(item => item.alias);
	for (let index = tailSources.length - 1; index >= 0; index--)
		if (resolved.some(item => item.alias === tailSources[index])) return tailSources[index];
	return resolved.length ? resolved[0].alias : null;
}

function mapHeadingsToToc(tocRows, headings) {
	const chapterTocs = tocRows.filter(toc => Number(toc.level) === 2 ||
		(Number(toc.level) === 1 && (Number(toc.h1) < 1 || /^باب/u.test(toc.title))));
	const candidates = [];
	for (const toc of chapterTocs)
		for (const heading of headings)
			candidates.push({ toc, heading, score: titleScore(toc.title, heading.title) });
	candidates.sort((a, b) => b.score - a.score || a.toc.ordinal - b.toc.ordinal || a.heading.fileNumber - b.heading.fileNumber);
	const assignedToc = new Set();
	const assignedHeading = new Set();
	const mappings = [];
	for (const candidate of candidates) {
		if (assignedToc.has(candidate.toc.id) || assignedHeading.has(candidate.heading)) continue;
		assignedToc.add(candidate.toc.id);
		assignedHeading.add(candidate.heading);
		mappings.push(candidate);
		if (mappings.length === chapterTocs.length) break;
	}
	return mappings.sort((a, b) => a.heading.start - b.heading.start || a.heading.fileNumber - b.heading.fileNumber || a.toc.ordinal - b.toc.ordinal);
}

function introForMapping(item) {
	const paragraphs = cleanText(item.heading.intro).split(/\n{2,}/).filter(Boolean);
	if (!paragraphs.length) return null;
	const firstWords = contentWords(paragraphs[0]);
	const titleWords = new Set(contentWords(item.toc.title));
	const titleContinuationRecall = firstWords.length ? firstWords.filter(word => titleWords.has(word)).length / firstWords.length : 0;
	if (firstWords.length >= 5 && titleContinuationRecall >= 0.72) paragraphs.shift();
	return paragraphs.length ? paragraphs.join('\n\n') : null;
}

function tocForNumber(number, chapterMappings) {
	const eligible = chapterMappings.filter(item => item.heading.start <= number);
	return eligible.length ? eligible[eligible.length - 1].toc : null;
}

async function main() {
	if (!fs.existsSync(EPUB)) throw new Error(`EPUB not found: ${EPUB}`);
	const zip = new AdmZip(EPUB);
	const groups = parseHadithGroups(zip);
	const headings = parseHeadings(zip);
	if (process.argv.includes('--dump-headings')) {
		console.log(JSON.stringify(headings, null, 2));
		return;
	}
	if (groups.size !== MAX_RIYAD_NUMBER - MIN_RIYAD_NUMBER + 1)
		throw new Error(`Expected ${MAX_RIYAD_NUMBER - MIN_RIYAD_NUMBER + 1} remaining hadiths, found ${groups.size}`);
	const hadiths = Array.from(groups, ([number, group]) => extractHadith(group, number)).sort((a, b) => a.number - b.number);
	const dumpNumber = Number((process.argv.find(argument => argument.startsWith('--dump=')) || '').split('=')[1]);
	if (dumpNumber) {
		console.log(JSON.stringify(hadiths.find(item => item.number === dumpNumber), null, 2));
		return;
	}
	const db = mysql.createConnection(connectionSettings());
	const query = util.promisify(db.query).bind(db);
	try {
		await util.promisify(db.connect).call(db);
		const book = (await query("SELECT id FROM books WHERE alias='riyad' AND `virtual`=1 LIMIT 1"))[0];
		if (!book) throw new Error('Virtual book riyad not found');
		const corpusRows = await query(`SELECT h.id,h.ordinal,h.num,h.chain,h.body,b.alias FROM hadiths h JOIN books b ON b.id=h.bookId
			WHERE b.alias IN (?) AND h.body IS NOT NULL`, [SOURCES.map(source => source.alias)]);
		const corpus = buildCorpusIndex(corpusRows);
		const existing = await query(`SELECT hv.id,hv.num AS virtualNum,hv.num0,hv.hadithId,b.alias,h.num AS localNum
			FROM hadiths_virtual hv LEFT JOIN hadiths h ON h.id=hv.hadithId LEFT JOIN books b ON b.id=h.bookId
			WHERE hv.bookId=?`, [book.id]);
		const tocRows = await query(`SELECT id,ordinal,level,h1,h2,h3,title,intro,intro_en,start,count
			FROM toc WHERE bookId=? AND start REGEXP '^[0-9]+$' ORDER BY ordinal,id`, [book.id]);
		const chapterMappings = mapHeadingsToToc(tocRows, headings);
		const lowChapterMatches = chapterMappings.filter(item => item.score < 0.2);
		const existingByNumber = new Map();
		for (const row of existing) {
			const number = Math.floor(Number(row.num0));
			if (!existingByNumber.has(number)) existingByNumber.set(number, []);
			existingByNumber.get(number).push(row);
		}

		const resolvedByNumber = new Map();
		for (const [number, rows] of existingByNumber) {
			if (number >= MIN_RIYAD_NUMBER) continue;
			const byAlias = new Map();
			for (const row of rows.filter(row => row.alias))
				if (!byAlias.has(row.alias)) byAlias.set(row.alias, { alias: row.alias, hadithId: row.hadithId, localNum: row.localNum, score: 1, inherited: true });
			resolvedByNumber.set(number, Array.from(byAlias.values()));
		}
		const review = [];
		const missing = [];
		for (const hadith of hadiths) {
			const hasDirectCitation = /أخرجه|أخرج|رواه/u.test(hadith.footnote);
			const cited = hadith.crossReferences.length && !hasDirectCitation ? new Map() : citedSources(hadith.footnote, hadith.textActual);
			const existingRows = existingByNumber.get(hadith.number) || [];
			const resolved = [];
			for (const [alias, printedNum] of cited) {
				const currentIds = new Set(existingRows.filter(row => row.alias === alias).map(row => row.hadithId));
				const overrideNum = OVERRIDES.get(`${hadith.number}:${alias}`);
				let match;
				if (overrideNum) {
					const overrideRows = (corpus.get(alias) && corpus.get(alias).byNum.get(overrideNum)) || [];
					if (overrideRows.length !== 1) throw new Error(`Override ${hadith.number}:${alias}:${overrideNum} found ${overrideRows.length} rows`);
					match = { row: overrideRows[0], score: 1, runnerUp: 0, exact: false, existing: false, override: true };
				} else match = bestMatch(alias, corpus.get(alias), hadith, printedNum, currentIds);
				if (!match || (match.score < MIN_SCORE && !match.exact)) {
					missing.push({ number: hadith.number, alias, printedNum, score: match ? match.score : 0 });
					continue;
				}
				resolved.push({ alias, printedNum, hadithId: match.row.id, localNum: match.row.num, score: match.score });
				if (match.score < REVIEW_SCORE && !match.exact && !match.override)
					review.push({ number: hadith.number, alias, printedNum, localNum: match.row.num, score: match.score,
						gap: match.score - match.runnerUp, exact: match.exact, existing: match.existing });
			}
			resolvedByNumber.set(hadith.number, resolved);
		}

		// Internal "see hadith N" footnotes inherit the already verified source set
		// when the edition supplies no direct source citation for the repeated report.
		for (const hadith of hadiths) {
			if ((resolvedByNumber.get(hadith.number) || []).length || !hadith.crossReferences.length) continue;
			const inherited = hadith.crossReferences.flatMap(number => resolvedByNumber.get(number) || []);
			const byAlias = new Map(inherited.map(item => [item.alias, item]));
			resolvedByNumber.set(hadith.number, Array.from(byAlias.values()));
		}

		const builtRows = [];
		const chapterSequence = new Map();
		for (const hadith of hadiths) {
			const resolved = resolvedByNumber.get(hadith.number) || [];
			const toc = tocForNumber(hadith.number, chapterMappings);
			if (!toc) throw new Error(`No TOC section for Riyad ${hadith.number}`);
			const primary = choosePrimary(hadith, resolved);
			for (let index = 0; index < resolved.length; index++) {
				const item = resolved[index];
				const nextInChapter = (chapterSequence.get(toc.id) || 0) + 1;
				chapterSequence.set(toc.id, nextInChapter);
				const multiple = resolved.length > 1;
				builtRows.push({
					tocId: toc.id, numInChapter: nextInChapter, h1: toc.h1, h2: toc.h2, h3: toc.h3,
					num: multiple ? `${hadith.number}${String.fromCharCode(97 + index)}` : String(hadith.number),
					num0: multiple ? hadith.number + ((index + 1) / 1000) : hadith.number,
					hadithId: item.hadithId, ref_num: `${item.alias}:${item.localNum}`,
					textActual: item.alias === primary ? hadith.textActual : null,
					bookActual: item.alias === primary ? primary : null,
					muttafaq: item.alias === primary && /مُتَّفَقٌ عَلَيهِ|متفقٌ عَلَيْهِ|متفق عليه/iu.test(hadith.textActual) ? 1 : null,
					note: item.alias === primary ? hadith.note : null
				});
			}
		}
		const tocIntroUpdates = chapterMappings.filter(item => item.heading.start >= MIN_RIYAD_NUMBER)
			.map(item => ({ ...item, intro: introForMapping(item) })).filter(item => item.intro);
		const lowIntroMatches = lowChapterMatches.filter(item => item.heading.start >= MIN_RIYAD_NUMBER);
		const stats = {
			hadiths: hadiths.length,
			resolvedRows: hadiths.reduce((sum, hadith) => sum + (resolvedByNumber.get(hadith.number) || []).length, 0),
			noResolvedSource: hadiths.filter(item => !(resolvedByNumber.get(item.number) || []).length).length,
			review: review.length,
			reviewExactCitation: review.filter(item => item.exact).length,
			reviewExistingMapping: review.filter(item => item.existing).length,
			reviewSemanticOnly: review.filter(item => !item.exact && !item.existing).length,
			missing: missing.length,
			outputRows: builtRows.length,
			tocSections: new Set(builtRows.map(row => row.tocId)).size,
			intros: tocIntroUpdates.length,
			epubHeadings: headings.length,
			tocRows: tocRows.length
		};
		console.log(JSON.stringify(stats, null, 2));
		console.log(`Review sample: ${JSON.stringify(review.slice().sort((a, b) => Number(a.exact || a.existing) - Number(b.exact || b.existing)), null, 2)}`);
		console.log(`Missing sample: ${JSON.stringify(missing.slice(0, 30), null, 2)}`);
		console.log(`No-source sample: ${JSON.stringify(hadiths.filter(item => !(resolvedByNumber.get(item.number) || []).length).slice(0, 40).map(item => ({ number: item.number, footnote: item.footnote.slice(0, 220), tail: item.textActual.slice(-220), crossReferences: item.crossReferences })), null, 2)}`);
		console.log(`Low intro-title matches: ${JSON.stringify(lowIntroMatches.map(item => ({ toc: item.toc.title, epub: item.heading.title, start: item.toc.start })), null, 2)}`);
		if (!APPLY) {
			console.log('Dry run only; no database rows changed.');
			return;
		}
		if (stats.noResolvedSource || stats.missing || stats.review || lowIntroMatches.length)
			throw new Error('Refusing to apply while unresolved or review-required matches remain');

		const stamp = new Date().toISOString().replace(/[:.]/g, '-');
		const backup = path.resolve(__dirname, `../temp/riyad-289-1896-before-${stamp}.json`);
		const backupRows = await query('SELECT * FROM hadiths_virtual WHERE bookId=? AND num0>=? ORDER BY ordinal,id', [book.id, MIN_RIYAD_NUMBER]);
		fs.writeFileSync(backup, `${JSON.stringify({ hadiths_virtual: backupRows, toc: tocRows }, null, 2)}\n`);
		await query('START TRANSACTION');
		try {
			await query('DELETE FROM hadiths_virtual WHERE bookId=? AND num0>=?', [book.id, MIN_RIYAD_NUMBER]);
			const firstOrdinalRow = (await query('SELECT COALESCE(MAX(ordinal),0)+1 nextOrdinal FROM hadiths_virtual WHERE bookId=?', [book.id]))[0];
			const now = new Date();
			const insertValues = builtRows.map((row, index) => [
				Number(firstOrdinalRow.nextOrdinal) + index, book.id, row.tocId, row.numInChapter, row.h1, row.h2, row.h3,
				row.num, row.num0, row.hadithId, row.ref_num, row.textActual, row.bookActual, row.muttafaq,
				null, row.note, now, now, IMPORT_USER
			]);
			await query(`INSERT INTO hadiths_virtual
				(ordinal,bookId,tocId,numInChapter,h1,h2,h3,num,num0,hadithId,ref_num,textActual,bookActual,muttafaq,
				 note_en,note,lastmod,lastfixed,lastmod_user) VALUES ?`, [insertValues]);
			for (const item of chapterMappings.filter(mapping => mapping.heading.start >= MIN_RIYAD_NUMBER)) {
				const directCount = builtRows.filter(row => row.tocId === item.toc.id).length;
				const intro = introForMapping(item);
				await query(`UPDATE toc SET start=?,start0=?,count=?,intro=?,lastmod=CURRENT_TIMESTAMP(),
					lastfixed=CURRENT_TIMESTAMP(),lastmod_user=? WHERE id=?`,
					[String(item.heading.start), item.heading.start, directCount, intro, IMPORT_USER, item.toc.id]);
			}
			for (const toc of tocRows.filter(row => Number(row.level) === 1 && Number(row.h1) >= 1 && !/^باب/u.test(row.title))) {
				const aggregateCount = builtRows.filter(row => Number(row.h1) === Number(toc.h1)).length;
				await query(`UPDATE toc SET count=?,lastmod=CURRENT_TIMESTAMP(),lastfixed=CURRENT_TIMESTAMP(),lastmod_user=? WHERE id=?`,
					[aggregateCount, IMPORT_USER, toc.id]);
			}
			const range = (await query('SELECT MIN(ordinal) firstOrdinal FROM hadiths_virtual WHERE bookId=?', [book.id]))[0];
			await query('SET @riyad_ordinal:=?', [Number(range.firstOrdinal) - 1]);
			await query(`UPDATE hadiths_virtual SET ordinal=(@riyad_ordinal:=@riyad_ordinal+1)
				WHERE bookId=? ORDER BY num0,ordinal,id`, [book.id]);
			await query('COMMIT');
		} catch (error) {
			await query('ROLLBACK');
			throw error;
		}
		await query('CALL refresh_v_hadiths_virtual_snapshot(?)', [book.id]);
		console.log(`Applied remaining Riyad import. Backup: ${backup}`);
	} finally {
		db.end();
	}
}

main().catch(error => {
	console.error(error.stack || error.message);
	process.exitCode = 1;
});
