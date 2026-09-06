#!/usr/bin/env node
/* jslint node:true, esversion:11 */
'use strict';

require('dotenv').config();
const childProcess = require('child_process');
const fs = require('fs');
const mysql = require('mysql');
const os = require('os');
const path = require('path');
const util = require('util');

const SOURCE_TITLE = 'الأدب المفرد: شرح';
const SOURCE_TITLE_EN = 'Al-Adab Al-Mufrad: A Commentary';
const SOURCE_AUTHOR = 'Adil Salahi';
const SOURCE_BOOK_ID = -4;
const ADAB_BOOK_ID = 15;
const EXPECTED_SOURCE_ENTRIES = 1329;
const DEFAULT_INPUT = path.resolve(__dirname, '../../temp/adab_salahi.txt');

const options = require.main === module ? readOptions(process.argv.slice(2)) : { apply: false, input: DEFAULT_INPUT, skipIndex: false };

async function main() {
	let connection;
	try {
		const sourceEntries = parseSource(fs.readFileSync(options.input, 'utf8'));
		connection = databaseConnection();
		const query = util.promisify(connection.query).bind(connection);
		const localEntries = await loadLocalEntries(query);
		const alignment = alignEntries(sourceEntries, localEntries);
		printSummary(sourceEntries, localEntries, alignment);
		if (!options.apply) {
			console.log('Dry run only. Re-run with --apply to import the commentary.');
			return;
		}
		await applyImport(query, alignment.matches);
		console.log(`Imported ${alignment.matches.length} English commentary record(s) by ${SOURCE_AUTHOR}.`);
		if (!options.skipIndex) indexHadiths(alignment.matches.map(match => match.local.id));
	} finally {
		if (connection) connection.end();
	}
}

function readOptions(args) {
	const parsed = { apply: false, input: DEFAULT_INPUT, skipIndex: false };
	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (arg === '--apply') parsed.apply = true;
		else if (arg === '--skip-index') parsed.skipIndex = true;
		else if (arg === '--input' && args[index + 1]) parsed.input = path.resolve(args[++index]);
		else if (arg === '--help') usage(0);
		else usage(1, `Unknown or incomplete option: ${arg}`);
	}
	if (parsed.skipIndex && !parsed.apply) usage(1, '--skip-index requires --apply.');
	return parsed;
}

function usage(code, message) {
	if (message) console.error(message);
	console.error('Usage: node bin/utils/import-adil-salahi-adab-sharh.js [--input FILE] [--apply] [--skip-index]');
	process.exit(code);
}

function repairOcrEntryLabels(value) {
	return String(value || '')
		.replace(/^449,\s+(\(Athar 106\))/m, '449. $1')
		.replace(/^499,\s+(\(Athar 118\))/m, '499. $1')
		.replace(/^769\.\s+(Ibn ‘Abbas said: ‘This is a Prophet’s word:)/m, '796. $1')
		.replace(/^876\.\s+(This is the same as Number 861)/m, '867. $1')
		.replace(/^1135\.\s+(Ibn ‘Abbas reported that the Prophet instructed)/m, '1235. $1')
		.replace(/^1136\.\s+(Jabir ibn ‘Abdullah reports that the Prophet said)/m, '1236. $1')
		.replace(/^(?=‘Abdullah ibn “Umar reports that the Prophet said: ‘Do not leave\s*\n)/m, '1232. ')
		.replace(/^(?=Abu Misa al-Ash‘ari reports that a house in Madinah was burnt\s*\n)/m, '1233. ');
}

function parseSource(value) {
	const text = repairOcrEntryLabels(value).replace(/\r/g, '');
	const candidates = entryCandidates(text);
	const selected = [];
	let minimumOffset = 0;
	for (let number = 1; number <= EXPECTED_SOURCE_ENTRIES; number++) {
		const candidate = candidates.find(item => item.first <= number && item.last >= number && item.offset >= minimumOffset);
		if (!candidate) throw new Error(`Could not locate source entry ${number}.`);
		selected.push({ sourceEntryId: number, candidate });
		minimumOffset = candidate.offset;
	}
	const distinct = [...new Set(selected.map(item => item.candidate))];
	const nextOffsets = new Map(distinct.map((candidate, index) => [candidate, distinct[index + 1]?.offset || text.length]));
	const entries = selected.map(item => {
		const fragment = text.slice(item.candidate.contentOffset, nextOffsets.get(item.candidate));
		return {
			sourceEntryId: item.sourceEntryId,
			printedNumber: item.sourceEntryId,
			coreText: normalizeText(fragment),
			leadText: normalizeText(fragment).split(/\n\n/).slice(0, 2).join(' ')
		};
	});
	attachIntroductions(entries, normalizeText(text.slice(0, distinct[0].offset)));
	if (entries.length !== EXPECTED_SOURCE_ENTRIES) throw new Error(`Expected ${EXPECTED_SOURCE_ENTRIES} source entries, found ${entries.length}.`);
	if (entries.some(entry => !entry.text)) throw new Error('One or more parsed source entries are empty.');
	return entries;
}

function entryCandidates(text) {
	const candidates = [];
	const pattern = /^(\d{1,4})(?:-(\d{1,4}))?\.\s+([^\n]*)/gm;
	let match;
	while ((match = pattern.exec(text))) {
		const first = Number(match[1]);
		let last = Number(match[2] || match[1]);
		if (match[2] && last < first) last = Math.floor(first / (10 ** match[2].length)) * (10 ** match[2].length) + last;
		const heading = match[3].trim();
		if (first < 1 || last > EXPECTED_SOURCE_ENTRIES || last < first || last - first > 5) continue;
		if (/^(?:Related\b|Ibid\b|See\b|[\d\s.,:%]+$)/i.test(heading)) continue;
		candidates.push({ first, last, offset: match.index, contentOffset: match.index + match[0].length - match[3].length });
	}
	return candidates;
}

function normalizeText(value) {
	const paragraphs = String(value || '')
		.replace(/^\s*(?=[A-Za-z0-9 .:%>;?/-]{1,10}\s*$)(?=[A-Za-z0-9 .:%>;?/-]*\d)[A-Za-z0-9 .:%>;?/-]+\s*$/gm, '')
		.replace(/([A-Za-z])-[ \t]*\n[ \t]*([A-Za-z])/g, '$1-$2')
		.split(/\n\s*\n+/)
		.map(paragraph => paragraph.replace(/\s*\n\s*/g, ' ').replace(/[ \t]+/g, ' ').trim())
		.filter(Boolean);
	const joined = [];
	for (const paragraph of paragraphs) {
		if (joined.length && !/[.!?’”)\]]$/.test(joined[joined.length - 1]) && /^[a-z]/.test(paragraph))
			joined[joined.length - 1] += ` ${paragraph}`;
		else joined.push(paragraph);
	}
	return joined.join('\n\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

function attachIntroductions(entries, openingIntroduction) {
	let pending = openingIntroduction;
	for (let index = 0; index < entries.length; index++) {
		const entry = entries[index];
		const split = index + 1 < entries.length ? splitTrailingIntroduction(entry.coreText) : { body: entry.coreText, introduction: '' };
		entry.text = [formatIntroduction(pending), split.body].filter(Boolean).join('\n\n');
		pending = split.introduction;
	}
}

function splitTrailingIntroduction(value) {
	const paragraphs = String(value || '').split(/\n\n/).filter(Boolean);
	for (let index = paragraphs.length - 1; index >= 1; index--) {
		if (!isIntroductionHeading(paragraphs[index])) continue;
		return { body: paragraphs.slice(0, index).join('\n\n'), introduction: paragraphs.slice(index).join('\n\n') };
	}
	return { body: value, introduction: '' };
}

function isIntroductionHeading(value) {
	const text = String(value || '').trim();
	if (text.length < 5 || text.length > 90 || text.split(/\s+/).length > 12) return false;
	if (/[.!?:;,'’”)]$/.test(text) || /^\(?Athar\b/i.test(text)) return false;
	if (!/[A-Za-z]/.test(text) || /\b(?:reports?|said|asked|related)\b/i.test(text)) return false;
	return /^[A-Z][A-Za-z‘’' -]+$/.test(text);
}

function formatIntroduction(value) {
	if (!value) return '';
	const paragraphs = value.split(/\n\n/);
	if (isIntroductionHeading(paragraphs[0])) paragraphs[0] = `## ${paragraphs[0]}`;
	return paragraphs.join('\n\n');
}

function databaseConnection() {
	const settings = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.hadithdb', 'settings.json'), 'utf8'));
	return mysql.createConnection(settings.mysql.connection);
}

async function loadLocalEntries(query) {
	return query(`SELECT h.id, h.num, h.ordinal, h.chain_en, h.body_en, t.title_en AS chapter
		FROM hadiths h LEFT JOIN toc t ON t.id=h.tocId
		WHERE h.bookId=? AND h.remark<>2 ORDER BY h.ordinal, h.id`, [ADAB_BOOK_ID]);
}

function alignEntries(source, local) {
	const rows = source.length + 1;
	const columns = local.length + 1;
	const gapPenalty = -0.08;
	const dp = Array.from({ length: rows }, () => new Float64Array(columns).fill(-Infinity));
	const action = Array.from({ length: rows }, () => new Uint8Array(columns));
	dp[0][0] = 0;
	for (let row = 1; row < rows; row++) { dp[row][0] = dp[row - 1][0] + gapPenalty; action[row][0] = 1; }
	for (let column = 1; column < columns; column++) { dp[0][column] = dp[0][column - 1] + gapPenalty; action[0][column] = 2; }
	for (let row = 1; row < rows; row++) {
		for (let column = 1; column < columns; column++) {
			const matchScore = dp[row - 1][column - 1] + similarity(source[row - 1].leadText, localText(local[column - 1]));
			const skipSource = dp[row - 1][column] + gapPenalty;
			const skipLocal = dp[row][column - 1] + gapPenalty;
			if (matchScore >= skipSource && matchScore >= skipLocal) { dp[row][column] = matchScore; action[row][column] = 3; }
			else if (skipSource >= skipLocal) { dp[row][column] = skipSource; action[row][column] = 1; }
			else { dp[row][column] = skipLocal; action[row][column] = 2; }
		}
	}
	const matches = [];
	const skippedSource = [];
	const skippedLocal = [];
	let row = source.length;
	let column = local.length;
	while (row || column) {
		if (action[row][column] === 3) {
			matches.unshift({ source: source[row - 1], local: local[column - 1], score: similarity(source[row - 1].leadText, localText(local[column - 1])) });
			row--; column--;
		} else if (action[row][column] === 1) skippedSource.unshift(source[--row]);
		else skippedLocal.unshift(local[--column]);
	}
	if (skippedLocal.length) throw new Error(`Could not map ${skippedLocal.length} local entries: ${skippedLocal.map(item => item.num).join(', ')}.`);
	const weak = matches.filter(match => match.score < 0.025);
	return { matches, skippedSource, skippedLocal, weak };
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
	const ignored = new Set(['the', 'and', 'that', 'his', 'was', 'had', 'said', 'from', 'with', 'for', 'this', 'allah', 'god', 'prophet', 'reports', 'reported', 'messenger']);
	const normalized = String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
	return new Set(normalized.split(/[^a-z0-9]+/).filter(word => word.length > 2 && !ignored.has(word)));
}

function printSummary(source, local, alignment) {
	const scores = alignment.matches.map(match => match.score).sort((a, b) => a - b);
	console.log(`Source: ${source.length} numbered entries. Local: ${local.length} hadith/athar records.`);
	console.log(`Mapped: ${alignment.matches.length}; skipped source entries: ${alignment.skippedSource.map(item => item.sourceEntryId).join(', ') || 'none'}.`);
	console.log(`Similarity: min=${scores[0].toFixed(3)}, median=${scores[Math.floor(scores.length / 2)].toFixed(3)}.`);
	if (alignment.weak.length) console.log(`Low-text-overlap mappings (${alignment.weak.length}): ${alignment.weak.map(match => `${match.source.sourceEntryId}->${match.local.num}`).join(', ')}.`);
}

async function applyImport(query, matches) {
	await query('START TRANSACTION');
	try {
		await query(`INSERT INTO hdith_sharh_sources (source_book_id, title, title_en, author, source_url)
			VALUES (?, ?, ?, ?, '') ON DUPLICATE KEY UPDATE title=VALUES(title), title_en=VALUES(title_en),
			author=VALUES(author), id=LAST_INSERT_ID(id)`, [SOURCE_BOOK_ID, SOURCE_TITLE, SOURCE_TITLE_EN, SOURCE_AUTHOR]);
		const sourceId = (await query('SELECT LAST_INSERT_ID() AS id'))[0].id;
		await query(`DELETE hs FROM hdith_hadith_sharh hs JOIN hadiths h ON h.id=hs.hadith_id
			WHERE hs.source_id=? AND h.bookId=?`, [sourceId, ADAB_BOOK_ID]);
		for (const match of matches) {
			await query(`INSERT INTO hdith_hadith_sharh
				(hadith_id, source_id, source_entry_id, chapter, page_num, title, title_en, text, text_en, format, source_url)
				VALUES (?, ?, ?, ?, NULL, ?, ?, '', ?, 'md', '')`,
			[match.local.id, sourceId, match.source.sourceEntryId, match.local.chapter || '', SOURCE_TITLE, SOURCE_TITLE_EN, match.source.text]);
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

module.exports = { alignEntries, isIntroductionHeading, normalizeText, parseSource, repairOcrEntryLabels, similarity, splitTrailingIntroduction };
