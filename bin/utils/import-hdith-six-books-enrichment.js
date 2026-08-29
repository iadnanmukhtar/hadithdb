#!/usr/bin/env node
/* jslint node:true, esversion:11 */
'use strict';

require('dotenv').config();
const { spawn } = require('child_process');
const cheerio = require('cheerio');
const crypto = require('crypto');
const fs = require('fs');
const mysql = require('mysql');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright-core');
const util = require('util');
const zlib = require('zlib');

const BASE_URL = 'https://hdith.com';
const LIGHTPANDA = process.env.LIGHTPANDA_BIN || path.join(os.homedir(), '.local', 'bin', 'lightpanda');
const CACHE_DIR = process.env.HDITH_CACHE_DIR || path.join('/tmp', 'hadithdb-hdith-six-books-enrichment');
const SIX_BOOKS = Object.freeze([
	{ sourceSlug: 'b-1', bookId: 1, alias: 'bukhari' },
	{ sourceSlug: 'b-2', bookId: 2, alias: 'muslim' },
	{ sourceSlug: 'b-3', bookId: 4, alias: 'abudawud' },
	{ sourceSlug: 'b-4', bookId: 5, alias: 'tirmidhi' },
	{ sourceSlug: 'b-5', bookId: 3, alias: 'nasai' },
	{ sourceSlug: 'b-6', bookId: 6, alias: 'ibnmajah' }
]);
const SOURCE_BOOK_ALIASES = Object.freeze({ 1: 'bukhari', 2: 'muslim', 3: 'abudawud', 4: 'tirmidhi', 5: 'nasai', 6: 'ibnmajah' });

const options = require.main === module ? readOptions(process.argv.slice(2)) : {
	apply: false, books: SIX_BOOKS.map(book => book.sourceSlug), delay: 100, maxHadiths: null, refresh: false, resumeSourceId: null
};
let dbConnection;
const sourceBookAuthorCache = new Map();
const narratorIdCache = new Map();
const subjectIdCache = new Map();
const sharhSourceIdCache = new Map();

async function main() {
	let browser;
	try {
		fs.mkdirSync(CACHE_DIR, { recursive: true });
		browser = await startLightpanda();
		const page = await browser.context.newPage();
		if (options.apply) {
			await ensureSchema();
			await suspendSharhFulltextIndex();
		}
		for (const book of selectedBooks(options.books))
			await scrapeBook(page, book);
		if (options.apply) await ensureSharhFulltextIndex();
	} catch (err) {
		console.error(`ERROR: ${err.stack || err.message}`);
		process.exitCode = 1;
	} finally {
		if (browser) await browser.close();
		await closeDatabase();
	}
}

function readOptions(args) {
	const parsed = { apply: false, books: SIX_BOOKS.map(book => book.sourceSlug), delay: 100, maxHadiths: null, refresh: false, resumeSourceId: null };
	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--apply') parsed.apply = true;
		else if (args[i] === '--refresh') parsed.refresh = true;
		else if (args[i] === '--book') parsed.books = [args[++i]];
		else if (args[i] === '--books') parsed.books = args[++i].split(',').map(value => value.trim()).filter(Boolean);
		else if (args[i] === '--delay') parsed.delay = Number(args[++i]);
		else if (args[i] === '--max-hadiths') parsed.maxHadiths = Number(args[++i]);
		else if (args[i] === '--resume-source-id') parsed.resumeSourceId = Number(args[++i]);
		else if (args[i] === '--help') usage(0);
		else usage(1, `Unknown option: ${args[i]}`);
	}
	if (!Number.isInteger(parsed.delay) || parsed.delay < 100)
		usage(1, '--delay must be at least 100 milliseconds.');
	if (parsed.maxHadiths !== null && (!Number.isInteger(parsed.maxHadiths) || parsed.maxHadiths < 1))
		usage(1, '--max-hadiths must be a positive integer.');
	if (parsed.resumeSourceId !== null && (!Number.isInteger(parsed.resumeSourceId) || parsed.resumeSourceId < 1))
		usage(1, '--resume-source-id must be a positive integer.');
	for (const slug of parsed.books)
		if (!SIX_BOOKS.some(book => book.sourceSlug === slug)) usage(1, `Unknown six-book source '${slug}'.`);
	return parsed;
}

function usage(code, message) {
	if (message) console.error(message);
	console.error('Usage: node bin/utils/import-hdith-six-books-enrichment.js [--apply] [--book b-1 | --books b-1,b-2] [--delay 100] [--max-hadiths N] [--resume-source-id N] [--refresh]');
	process.exit(code);
}

function selectedBooks(slugs) {
	const wanted = new Set(slugs);
	return SIX_BOOKS.filter(book => wanted.has(book.sourceSlug));
}

async function startLightpanda() {
	if (!fs.existsSync(LIGHTPANDA)) throw new Error(`Lightpanda was not found at ${LIGHTPANDA}. Set LIGHTPANDA_BIN if installed elsewhere.`);
	const port = 19222 + Math.floor(Math.random() * 1000);
	const child = spawn(LIGHTPANDA, ['serve', '--host', '127.0.0.1', '--port', String(port), '--disable-metrics', '--block-private-networks'], {
		stdio: ['ignore', 'ignore', 'pipe']
	});
	let stderr = '';
	child.stderr.on('data', chunk => { stderr += chunk.toString(); });
	for (let attempt = 0; attempt < 50; attempt++) {
		if (child.exitCode !== null) throw new Error(`Lightpanda exited before CDP startup: ${stderr.trim()}`);
		try {
			const connection = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
			const context = connection.contexts()[0] || await connection.newContext();
			return {
				context,
				close: async () => {
					await connection.close().catch(() => {});
					if (child.exitCode === null) child.kill('SIGTERM');
				}
			};
		} catch (err) {
			await wait(100);
		}
	}
	child.kill('SIGTERM');
	throw new Error(`Timed out starting Lightpanda: ${stderr.trim()}`);
}

async function scrapeBook(page, config) {
	console.log(`\n${config.alias}: starting ${config.sourceSlug} (${options.apply ? 'apply' : 'dry run'})`);
	const bookPage = await fetchProps(page, `/encyclopedia/book/${config.sourceSlug}`);
	const chapters = bookPage.chapters || [];
	if (!chapters.length || bookPage.book?.slug !== config.sourceSlug)
		throw new Error(`${config.sourceSlug}: invalid book payload.`);
	if (options.apply) await ensureSchema();
	if (options.apply && ignoresExternalGrades(config)) {
		const connection = await getConnection();
		await query(connection, `DELETE hg FROM hdith_hadith_grades hg
			JOIN hadiths h ON h.id=hg.hadith_id WHERE h.bookId=?`, [config.bookId]);
	}
	const muslimMatcher = config.sourceSlug === 'b-2' ? await createMuslimMatcher() : null;
	let handled = 0;
	for (const chapter of chapters) {
		if (options.maxHadiths !== null && handled >= options.maxHadiths) break;
		const listing = await fetchProps(page, `/encyclopedia/book/${config.sourceSlug}?chapter=${chapter.id}`);
		const firstId = firstHadithId(listing, config.sourceSlug);
		if (!firstId) throw new Error(`${config.sourceSlug}: no first hadith for chapter ${chapter.id}.`);
		let sourceId = firstId;
		let chapterCount = 0;
		while (sourceId && chapterCount < Number(chapter.count || 0)) {
			if (options.maxHadiths !== null && handled >= options.maxHadiths) break;
			const record = await withTimeout(loadRecord(page, config, sourceId), 60000,
				`${config.sourceSlug}/h/${sourceId}: timed out loading the hadith payload`);
			if (!record || record.chapterId !== Number(chapter.id)) break;
			chapterCount++;
			if (options.resumeSourceId && config.sourceSlug === options.books[0] && record.sourceId < options.resumeSourceId) {
				compressCachedRecord(config, record.sourceId);
				sourceId = record.nextId;
				continue;
			}
			if (!record.isIntro) {
				const muslimMatch = muslimMatcher ? muslimMatcher.match(record) : null;
				if (muslimMatcher && !muslimMatch) {
					console.warn(`muslim: no ordered text-confirmed local match for hdith.com entry ${record.sourceId}; skipped.`);
					compressCachedRecord(config, record.sourceId);
					sourceId = record.nextId;
					continue;
				}
				if (muslimMatch && handled < 10)
					console.log(`muslim: hdith.com ${record.sourceId} -> ${muslimMatch.num} (${muslimMatch.score.toFixed(3)} normalized similarity)`);
				if (options.apply) await withTimeout(applyRecord(page, config, record, muslimMatch), 180000,
					`${config.sourceSlug}/h/${sourceId}: timed out applying enrichment`);
				else {
					if (record.sharhPreview.length) await fetchSharh(page, config, record.sourceId);
					if (record.verificationUrl && !ignoresExternalGrades(config))
						await fetchGraderOpinions(page, record.verificationUrl, config, record.num);
				}
				handled++;
				if (handled % 25 === 0) console.log(`${config.alias}: enriched ${handled} hadith(s)`);
			}
			compressCachedRecord(config, record.sourceId);
			sourceId = record.nextId;
		}
	}
	console.log(`${config.alias}: ${options.apply ? 'enriched' : 'validated'} ${handled} hadith(s); no index command was run.`);
}

function firstHadithId(props, sourceSlug) {
	const candidates = props.hadiths || props.entries || props.book?.hadiths || [];
	const first = candidates.find(row => row && (row.id || row.entry_id));
	if (first) return Number(first.id || first.entry_id);
	const html = JSON.stringify(props);
	const match = html.match(new RegExp(`/encyclopedia/book/${sourceSlug}/h/(\\d+)`));
	return match ? Number(match[1]) : null;
}

async function loadRecord(page, config, sourceId) {
	const cacheFile = path.join(CACHE_DIR, config.sourceSlug, `${sourceId}.json`);
	const compressedCacheFile = `${cacheFile}.gz`;
	let hadith;
	if (!options.refresh && fs.existsSync(cacheFile)) {
		hadith = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
		if (!Object.prototype.hasOwnProperty.call(hadith, '_verification_url')) hadith = null;
	} else if (!options.refresh && fs.existsSync(compressedCacheFile)) {
		hadith = JSON.parse(zlib.gunzipSync(fs.readFileSync(compressedCacheFile)).toString('utf8'));
		if (!Object.prototype.hasOwnProperty.call(hadith, '_verification_url')) hadith = null;
	} else {
		hadith = null;
	}
	if (!hadith) {
		const props = await fetchProps(page, `/encyclopedia/book/${config.sourceSlug}/h/${sourceId}`);
		hadith = props.hadith;
		if (!hadith || hadith.id !== sourceId || hadith.book?.slug !== config.sourceSlug)
			throw new Error(`${config.sourceSlug}/h/${sourceId}: mismatched hadith payload.`);
		hadith._verification_url = props.__verificationUrl || null;
		fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
		fs.writeFileSync(cacheFile, JSON.stringify(hadith));
	}
	return parseHadithPayload(hadith);
}

function compressCachedRecord(config, sourceId) {
	const cacheFile = path.join(CACHE_DIR, config.sourceSlug, `${sourceId}.json`);
	if (!fs.existsSync(cacheFile)) return;
	const compressedCacheFile = `${cacheFile}.gz`;
	const temporaryFile = `${compressedCacheFile}.tmp`;
	fs.writeFileSync(temporaryFile, zlib.gzipSync(fs.readFileSync(cacheFile)));
	fs.renameSync(temporaryFile, compressedCacheFile);
	fs.unlinkSync(cacheFile);
}

function parseHadithPayload(hadith) {
	const chapterPath = hadith.chapter_path || [];
	return {
		sourceId: Number(hadith.id),
		num: compact(hadith.numbering_harf || hadith.numberings?.[0]?.value),
		chapterId: Number(chapterPath[0]?.id),
		isIntro: !!hadith.is_intro || hadith.entry_kind === 'intro',
		nextId: Number(hadith.next_id) || null,
		attribution: compact(hadith.attribution || hadith.chain_type) || null,
		narrators: parseNarrators(hadith),
		subjects: (hadith.subjects || []).map(subject => ({ slug: compact(subject.slug), title: compact(subject.title) })).filter(subject => subject.slug && subject.title),
		links: parseLinks(hadith),
		sharhPreview: (hadith.services || []).find(service => Number(service.type_id) === 6)?.items || [],
		verificationUrl: compact(hadith._verification_url) || null,
		comparisonText: compact(hadith.matn),
		rawChecksum: checksum(hadith)
	};
}

function parseNarrators(hadith) {
	return (hadith.isnad || []).map((narrator, index) => ({
		ordinal: index + 1,
		sourceSlug: compact(narrator.slug),
		name: compact(narrator.name),
		fullname: compact(narrator.fullname) || null,
		reliability: compact(narrator.reliability) || null,
		generation: compact(narrator.generation) || null,
		death: compact(narrator.dates) || null,
		formula: compact(narrator.formula) || null,
		flags: narrator.flags || []
	})).filter(narrator => narrator.sourceSlug && narrator.name);
}

function parseLinks(hadith) {
	const links = [];
	for (const source of hadith.takhrij?.sources || [])
		for (const occurrence of source.occurrences || []) links.push(linkRecord('takhrij', source.book_id, occurrence.entry_id, occurrence.hadith_num, occurrence.similarity));
	for (const group of hadith.shawahid?.groups || [])
		for (const book of group.books || [])
			for (const entry of book.entries || []) links.push(linkRecord('shahid', entry.book_id, entry.entry_id, entry.number, group.narrator));
	return uniqueBy(links.filter(link => link.sourceEntryId), link => `${link.type}:${link.sourceEntryId}`);
}

function linkRecord(type, sourceBookId, sourceEntryId, num, label) {
	const alias = SOURCE_BOOK_ALIASES[Number(sourceBookId)] || null;
	return {
		type,
		sourceBookId: Number(sourceBookId),
		sourceEntryId: Number(sourceEntryId),
		num: compact(num),
		label: compact(label) || null,
		internalRef: alias && compact(num) ? `${alias}:${compact(num)}` : null
	};
}

async function applyRecord(page, config, record, orderedMatch) {
	if (!record.num) throw new Error(`${config.sourceSlug}/h/${record.sourceId}: missing hadith number.`);
	const connection = await getConnection();
	const localRows = orderedMatch ? [{ id: orderedMatch.id }] : await query(connection, 'SELECT id FROM hadiths WHERE bookId=? AND num=? ORDER BY id', [config.bookId, record.num]);
	if (!localRows.length) {
		console.warn(`${config.alias}:${record.num}: no exact local book/reference match for hdith.com entry ${record.sourceId}; skipped.`);
		return;
	}
	if (localRows.length !== 1) throw new Error(`${config.alias}:${record.num}: expected one local hadith, found ${localRows.length}.`);
	const hadithId = localRows[0].id;
	if (!options.refresh) {
		const existing = await query(connection, 'SELECT source_checksum, source_reference FROM hdith_hadith_metadata WHERE hadith_id=? LIMIT 1', [hadithId]);
		if (existing[0]?.source_checksum === record.rawChecksum) {
			if (existing[0]?.source_reference !== record.num)
				await query(connection, 'UPDATE hdith_hadith_metadata SET source_reference=? WHERE hadith_id=?', [record.num, hadithId]);
			return;
		}
	}
	const sharh = record.sharhPreview.length ? await fetchSharh(page, config, record.sourceId) : [];
	const graderOpinions = record.verificationUrl && !ignoresExternalGrades(config)
		? await fetchGraderOpinions(page, record.verificationUrl, config, record.num) : [];
	try {
		await query(connection, 'START TRANSACTION');
		await query(connection, `INSERT INTO hdith_hadith_metadata
			(hadith_id, source_book_slug, source_entry_id, source_reference, attribution, takhrij_json, shawahid_json, source_checksum)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			ON DUPLICATE KEY UPDATE source_entry_id=VALUES(source_entry_id), source_reference=VALUES(source_reference), attribution=VALUES(attribution),
				takhrij_json=VALUES(takhrij_json), shawahid_json=VALUES(shawahid_json), source_checksum=VALUES(source_checksum), lastmod=NOW()`,
			[hadithId, config.sourceSlug, record.sourceId, record.num, record.attribution,
			 JSON.stringify(record.links.filter(link => link.type === 'takhrij')),
			 JSON.stringify(record.links.filter(link => link.type === 'shahid')), record.rawChecksum]);
		await replaceNarrators(connection, hadithId, record.narrators);
		await replaceSubjects(connection, hadithId, record.subjects);
		await replaceLinks(connection, hadithId, record.links);
		await replaceSharh(connection, hadithId, sharh);
		await replaceGraderOpinions(connection, hadithId, graderOpinions);
		await query(connection, 'COMMIT');
	} catch (err) {
		await query(connection, 'ROLLBACK').catch(() => {});
		narratorIdCache.clear();
		subjectIdCache.clear();
		sharhSourceIdCache.clear();
		throw err;
	}
}

function ignoresExternalGrades(config) {
	return config.sourceSlug === 'b-1' || config.sourceSlug === 'b-2';
}

async function createMuslimMatcher() {
	const connection = await getConnection();
	const rows = await query(connection, `SELECT id, num, body
		FROM hadiths WHERE bookId=2 ORDER BY ordinal, id`);
	let cursor = 0;
	return {
		match(record) {
			const source = normalizeHadithForComparison(record.comparisonText);
			if (!source) return null;
			let best = null;
			const end = Math.min(rows.length, cursor + 120);
			for (let index = cursor; index < end; index++) {
				const local = normalizeHadithForComparison(rows[index].body);
				const score = hadithTextSimilarity(source, local);
				if (!best || score > best.score) best = { ...rows[index], index, score };
				if (score >= 0.96) break;
			}
			if (!best || best.score < 0.70) return null;
			cursor = best.index + 1;
			return best;
		}
	};
}

function normalizeHadithForComparison(value) {
	return htmlText(value)
		.replace(/[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06edـ]/g, '')
		.replace(/صلى\s+الله\s+عليه\s+وسلم|عليه\s+الصلاة\s+والسلام|ﷺ/gu, ' ')
		.replace(/رض[يى]\s+الله\s+(?:تعالى\s+)?عن(?:ه|ها|هما|هم|هن)|ؓ/gu, ' ')
		.replace(/رحمه\s+الله(?:\s+تعالى)?/gu, ' ')
		.replace(/[إأآٱ]/g, 'ا').replace(/[ئى]/g, 'ي').replace(/ؤ/g, 'و').replace(/ة/g, 'ه')
		.replace(/[^\u0621-\u063a\u0641-\u064a0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function hadithTextSimilarity(left, right) {
	if (!left || !right) return 0;
	if (left === right) return 1;
	if (left.length >= 20 && (left.includes(right) || right.includes(left)))
		return Math.min(left.length, right.length) / Math.max(left.length, right.length);
	const leftTokens = left.split(' ');
	const rightCounts = new Map();
	right.split(' ').forEach(token => rightCounts.set(token, (rightCounts.get(token) || 0) + 1));
	let intersection = 0;
	leftTokens.forEach(token => {
		const count = rightCounts.get(token) || 0;
		if (count > 0) {
			intersection++;
			rightCounts.set(token, count - 1);
		}
	});
	return (2 * intersection) / (leftTokens.length + right.split(' ').length);
}

function htmlText(value) {
	return cheerio.load(`<div>${String(value || '')}</div>`)('div').text();
}

async function fetchGraderOpinions(page, verificationUrl, config, hadithNum) {
	const url = new URL(verificationUrl, BASE_URL);
	if (!url.searchParams.get('q')) return [];
	let props = await fetchProps(page, `${url.pathname}${url.search}`);
	const results = [...(props.results || [])];
	const lastPage = Math.min(Number(props.meta?.last_page) || 1, 100);
	for (let pageNumber = 2; pageNumber <= lastPage; pageNumber++) {
		url.searchParams.set('page', String(pageNumber));
		props = await fetchProps(page, `${url.pathname}${url.search}`);
		results.push(...(props.results || []));
	}
	return parseGraderOpinions(results, config.sourceSlug, hadithNum);
}

function parseGraderOpinions(results, sourceBookSlug, hadithNum) {
	if (!sourceBookSlug || !normalizedReferenceNumber(hadithNum).base) return [];
	return uniqueBy((results || []).filter(result =>
		sourceSlugForVerificationResult(result.source) === sourceBookSlug
		&& referencesEquivalent(sourceBookSlug, hadithNum, result.book_page)
	).map(result => ({
		sourceSlug: compact(result.slug),
		grader: compact(result.muhaddith),
		graderSourceId: Number(result.muhaddith_id) || null,
		grade: compact(result.degree),
		gradeCategoryId: Number(result.degree_category_id),
		source: compact(result.source),
		sourceId: Number(result.source_id) || null,
		bookPage: compact(result.book_page) || null,
		driver: compact(result.driver) || null,
		sourceUrl: result.slug ? `${BASE_URL}/h/${result.slug}` : null
	})).filter(result => result.sourceSlug && result.grader && result.grade), result => result.sourceSlug);
}

function sourceSlugForVerificationResult(source) {
	const normalized = normalizeArabicForMatch(source);
	if (/البخاري/.test(normalized)) return 'b-1';
	if (/مسلم/.test(normalized)) return 'b-2';
	if (/ابي داود|ابو داود/.test(normalized)) return 'b-3';
	if (/الترمذي/.test(normalized)) return 'b-4';
	if (/النسايي/.test(normalized)) return 'b-5';
	if (/ابن ماجه/.test(normalized)) return 'b-6';
	return null;
}

function normalizedReferenceNumber(value) {
	const western = String(value || '').replace(/[٠-٩]/g, digit => '٠١٢٣٤٥٦٧٨٩'.indexOf(digit));
	const matches = [...western.matchAll(/(\d+(?:\.\d+)?)(?:\s*[-_.]?\s*([a-zA-Z]))?/g)];
	if (!matches.length) return { base: '', suffix: '' };
	const match = matches[matches.length - 1];
	return { base: String(Number(match[1])), suffix: (match[2] || '').toLowerCase() };
}

function referencesEquivalent(sourceBookSlug, localReference, sourceReference) {
	const local = normalizedReferenceNumber(localReference);
	const source = normalizedReferenceNumber(sourceReference);
	if (!local.base || local.base !== source.base) return false;
	if (sourceBookSlug === 'b-2') return true;
	return local.suffix === source.suffix;
}

function normalizeArabicForMatch(value) {
	return cheerio.load(`<div>${String(value || '')}</div>`)('div').text()
		.replace(/[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06edـ]/g, '')
		.replace(/[إأآٱ]/g, 'ا').replace(/[ئى]/g, 'ي').replace(/ؤ/g, 'و').replace(/ة/g, 'ه')
		.replace(/[^\u0621-\u063a\u0641-\u064a0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

async function replaceGraderOpinions(connection, hadithId, opinions) {
	await query(connection, 'DELETE FROM hdith_hadith_grades WHERE hadith_id=?', [hadithId]);
	for (let index = 0; index < opinions.length; index++) {
		const opinion = opinions[index];
		await query(connection, `INSERT INTO hdith_hadith_grades
			(hadith_id, ordinal, source_slug, grader, grader_source_id, grade, grade_category_id,
			 source_name, source_id, book_page, source_driver, source_url)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [hadithId, index + 1, opinion.sourceSlug, opinion.grader,
			 opinion.graderSourceId, opinion.grade, opinion.gradeCategoryId, opinion.source, opinion.sourceId,
			 opinion.bookPage, opinion.driver, opinion.sourceUrl]);
	}
}

async function replaceNarrators(connection, hadithId, narrators) {
	await query(connection, 'DELETE FROM hdith_hadith_narrators WHERE hadith_id=?', [hadithId]);
	for (const narrator of narrators) {
		let narratorId = narratorIdCache.get(narrator.sourceSlug);
		if (!narratorId) {
			await query(connection, `INSERT INTO hdith_narrators
				(source_slug, name, fullname, reliability, generation_name, death_text, source_url)
				VALUES (?, ?, ?, ?, ?, ?, ?)
				ON DUPLICATE KEY UPDATE name=VALUES(name), fullname=VALUES(fullname), reliability=VALUES(reliability),
					generation_name=VALUES(generation_name), death_text=VALUES(death_text), source_url=VALUES(source_url), id=LAST_INSERT_ID(id)`,
				[narrator.sourceSlug, narrator.name, narrator.fullname, narrator.reliability, narrator.generation, narrator.death,
					`${BASE_URL}/encyclopedia/rawi/${narrator.sourceSlug}`]);
			narratorId = (await query(connection, 'SELECT LAST_INSERT_ID() AS id'))[0].id;
			narratorIdCache.set(narrator.sourceSlug, narratorId);
		}
		await query(connection, `INSERT INTO hdith_hadith_narrators
			(hadith_id, narrator_id, ordinal, formula, flags_json) VALUES (?, ?, ?, ?, ?)`,
			[hadithId, narratorId, narrator.ordinal, narrator.formula, JSON.stringify(narrator.flags)]);
	}
}

async function replaceSubjects(connection, hadithId, subjects) {
	await query(connection, 'DELETE FROM hdith_hadith_subjects WHERE hadith_id=?', [hadithId]);
	for (const subject of subjects) {
		let ids = subjectIdCache.get(subject.slug);
		if (!ids) {
			await query(connection, `INSERT INTO hdith_subjects (source_slug, title, source_url) VALUES (?, ?, ?)
				ON DUPLICATE KEY UPDATE title=VALUES(title), source_url=VALUES(source_url), id=LAST_INSERT_ID(id)`,
				[subject.slug, subject.title, `${BASE_URL}/encyclopedia/topic/${subject.slug}`]);
			const subjectId = (await query(connection, 'SELECT LAST_INSERT_ID() AS id'))[0].id;
			await query(connection, `INSERT INTO tags (text_en, text) VALUES (?, ?)
				ON DUPLICATE KEY UPDATE text=VALUES(text), id=LAST_INSERT_ID(id)`, [`hdith:${subject.slug}`.slice(0, 45), subject.title.slice(0, 90)]);
			ids = { subjectId, tagId: (await query(connection, 'SELECT LAST_INSERT_ID() AS id'))[0].id };
			subjectIdCache.set(subject.slug, ids);
		}
		await query(connection, 'INSERT INTO hdith_hadith_subjects (hadith_id, subject_id) VALUES (?, ?)', [hadithId, ids.subjectId]);
		await query(connection, 'INSERT IGNORE INTO hadiths_tags (hadithId, tagId) VALUES (?, ?)', [hadithId, ids.tagId]);
	}
}

async function replaceLinks(connection, hadithId, links) {
	await query(connection, 'DELETE FROM hdith_hadith_links WHERE hadith_id=?', [hadithId]);
	if (!links.length) return;
	const referencesByBook = new Map();
	for (const link of links) {
		const target = SIX_BOOKS.find(book => book.sourceSlug === `b-${link.sourceBookId}`);
		if (!target || !link.num) continue;
		if (!referencesByBook.has(target.bookId)) referencesByBook.set(target.bookId, new Set());
		referencesByBook.get(target.bookId).add(link.num);
	}
	const localMatches = new Map();
	for (const [bookId, references] of referencesByBook) {
		const rows = await query(connection, 'SELECT id, num FROM hadiths WHERE bookId=? AND num IN (?) ORDER BY id', [bookId, [...references]]);
		for (const row of rows) {
			const key = `${bookId}:${row.num}`;
			if (!localMatches.has(key)) localMatches.set(key, []);
			localMatches.get(key).push(row.id);
		}
	}
	const values = links.map(link => {
		const target = SIX_BOOKS.find(book => book.sourceSlug === `b-${link.sourceBookId}`);
		const matches = target ? localMatches.get(`${target.bookId}:${link.num}`) || [] : [];
		return [hadithId, link.type, link.sourceBookId, link.sourceEntryId, link.num, link.label,
			matches.length === 1 ? matches[0] : null, link.internalRef,
			`${BASE_URL}/encyclopedia/book/b-${link.sourceBookId}/h/${link.sourceEntryId}`];
	});
	for (let index = 0; index < values.length; index += 500)
		await query(connection, `INSERT INTO hdith_hadith_links
			(hadith_id, link_type, source_book_id, source_entry_id, source_num, label, internal_hadith_id, internal_ref, source_url)
			VALUES ?`, [values.slice(index, index + 500)]);
}

async function fetchSharh(page, config, sourceId) {
	const props = await fetchProps(page, `/encyclopedia/book/${config.sourceSlug}/h/${sourceId}/service/6`);
	const items = props.items || [];
	const authors = new Map();
	for (const item of items) {
		if (!authors.has(item.book_id)) authors.set(item.book_id, await sourceBookAuthor(page, item.book_id));
	}
	return items.map(item => ({
		sourceEntryId: Number(item.entry_id), sourceBookId: Number(item.book_id), title: compact(item.book),
		author: authors.get(item.book_id), chapter: compact(item.chapter) || null, page: Number(item.page_num) || null,
		text: sharhToMarkdown(item.content), format: 'md',
		sourceUrl: `${BASE_URL}/encyclopedia/book/${config.sourceSlug}/h/${sourceId}/service/6`
	})).filter(item => item.sourceEntryId && item.text);
}

async function sourceBookAuthor(page, bookId) {
	if (sourceBookAuthorCache.has(Number(bookId)))
		return sourceBookAuthorCache.get(Number(bookId));
	const props = await fetchProps(page, `/encyclopedia/book/b-${bookId}`);
	const author = compact(props.book?.author) || null;
	sourceBookAuthorCache.set(Number(bookId), author);
	return author;
}

async function replaceSharh(connection, hadithId, items) {
	await query(connection, 'DELETE FROM hdith_hadith_sharh WHERE hadith_id=?', [hadithId]);
	for (const item of items) {
		let sourceId = sharhSourceIdCache.get(item.sourceBookId);
		if (!sourceId) {
			await query(connection, `INSERT INTO hdith_sharh_sources
				(source_book_id, title, author, source_url) VALUES (?, ?, ?, ?)
				ON DUPLICATE KEY UPDATE title=VALUES(title), author=VALUES(author), source_url=VALUES(source_url), id=LAST_INSERT_ID(id)`,
				[item.sourceBookId, item.title, item.author, `${BASE_URL}/encyclopedia/book/b-${item.sourceBookId}`]);
			sourceId = (await query(connection, 'SELECT LAST_INSERT_ID() AS id'))[0].id;
			sharhSourceIdCache.set(item.sourceBookId, sourceId);
		}
		await query(connection, `INSERT INTO hdith_hadith_sharh
			(hadith_id, source_id, source_entry_id, chapter, page_num, text, format, source_url)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [hadithId, sourceId, item.sourceEntryId, item.chapter, item.page, item.text, item.format, item.sourceUrl]);
	}
}

function sharhToMarkdown(value) {
	let source = String(value || '').replace(/\r\n?/g, '\n').trim();
	if (!source) return '';
	if (/<(?:p|div|br|h[1-6]|ul|ol|li|blockquote|strong|em|a)\b/i.test(source)) {
		const $ = cheerio.load(`<main>${source}</main>`);
		$('br').replaceWith('\n');
		$('strong, b').each((unused, element) => $(element).replaceWith(`**${$(element).text().trim()}**`));
		$('em, i').each((unused, element) => $(element).replaceWith(`*${$(element).text().trim()}*`));
		$('a[href]').each((unused, element) => $(element).replaceWith(`[${$(element).text().trim()}](${$(element).attr('href')})`));
		$('h1, h2, h3, h4, h5, h6').each((unused, element) => {
			const level = Number(element.tagName.substring(1));
			$(element).replaceWith(`${'#'.repeat(level)} ${$(element).text().trim()}\n\n`);
		});
		$('li').each((unused, element) => $(element).replaceWith(`- ${$(element).text().trim()}\n`));
		$('blockquote').each((unused, element) => $(element).replaceWith($(element).text().trim().split('\n').map(line => `> ${line}`).join('\n') + '\n\n'));
		$('p, div').each((unused, element) => $(element).append('\n\n'));
		source = $('main').text();
	}
	return source.split(/\n\s*\n/).map(paragraph => paragraph.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n\n');
}

async function fetchProps(page, pathname) {
	await wait(options.delay);
	const url = `${BASE_URL}${pathname}`;
	let html;
	if (page.url().startsWith(BASE_URL)) {
		let lastError;
		for (let attempt = 1; attempt <= 3; attempt++) {
			try {
				const response = await fetch(url, {
					headers: { accept: 'text/html,application/xhtml+xml' }, signal: AbortSignal.timeout(30000)
				});
				if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
				html = await response.text();
				break;
			} catch (err) {
				lastError = err;
				if (attempt < 3) await wait(Math.max(options.delay, attempt * 1000));
			}
		}
		if (html === undefined) throw new Error(`${url}: failed after 3 attempts: ${lastError?.message || lastError}`);
	} else {
		await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
		html = await page.content();
	}
	const $ = cheerio.load(html);
	const json = $('script[data-page="app"][type="application/json"]').html();
	if (!json) throw new Error(`${url}: missing Inertia payload.`);
	const props = JSON.parse(json).props;
	props.__verificationUrl = $('a[href^="/s?q="], a[href^="https://hdith.com/s?q="]').first().attr('href') || null;
	return props;
}

async function ensureSchema() {
	const connection = await getConnection();
	for (const statement of schemaStatements()) await query(connection, statement);
	const referenceColumn = await query(connection, `SELECT 1 FROM information_schema.columns
		WHERE table_schema=DATABASE() AND table_name='hdith_hadith_metadata' AND column_name='source_reference' LIMIT 1`);
	if (!referenceColumn.length)
		await query(connection, 'ALTER TABLE hdith_hadith_metadata ADD COLUMN source_reference VARCHAR(45) NULL AFTER source_entry_id');
}

async function suspendSharhFulltextIndex() {
	const connection = await getConnection();
	const rows = await query(connection, `SELECT 1 FROM information_schema.statistics
		WHERE table_schema=DATABASE() AND table_name='hdith_hadith_sharh' AND index_name='hdith_sharh_text' LIMIT 1`);
	if (rows.length) {
		console.log('sharh: suspending FULLTEXT index during bulk import');
		await query(connection, 'ALTER TABLE hdith_hadith_sharh DROP INDEX hdith_sharh_text');
	}
}

async function ensureSharhFulltextIndex() {
	const connection = await getConnection();
	const rows = await query(connection, `SELECT 1 FROM information_schema.statistics
		WHERE table_schema=DATABASE() AND table_name='hdith_hadith_sharh' AND index_name='hdith_sharh_text' LIMIT 1`);
	if (!rows.length) {
		console.log('sharh: rebuilding FULLTEXT search index');
		await query(connection, 'ALTER TABLE hdith_hadith_sharh ADD FULLTEXT KEY hdith_sharh_text (text)');
	}
}

function schemaStatements() {
	return [
		`CREATE TABLE IF NOT EXISTS hdith_hadith_metadata (
			hadith_id INT NOT NULL PRIMARY KEY, source_book_slug VARCHAR(16) NOT NULL, source_entry_id INT NOT NULL,
			source_reference VARCHAR(45) NULL, attribution VARCHAR(64) NULL, takhrij_json JSON NULL, shawahid_json JSON NULL, source_checksum CHAR(64) NOT NULL,
			lastmod DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			UNIQUE KEY hdith_metadata_source (source_book_slug, source_entry_id),
			CONSTRAINT hdith_metadata_hadith_fk FOREIGN KEY (hadith_id) REFERENCES hadiths(id) ON DELETE CASCADE ON UPDATE CASCADE
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
		`CREATE TABLE IF NOT EXISTS hdith_narrators (
			id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, source_slug VARCHAR(32) NOT NULL, name VARCHAR(255) NOT NULL,
			fullname TEXT NULL, reliability VARCHAR(255) NULL, generation_name VARCHAR(255) NULL, death_text VARCHAR(255) NULL,
			source_url VARCHAR(512) NOT NULL, UNIQUE KEY hdith_narrator_source (source_slug)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
		`CREATE TABLE IF NOT EXISTS hdith_hadith_narrators (
			hadith_id INT NOT NULL, narrator_id INT NOT NULL, ordinal SMALLINT UNSIGNED NOT NULL, formula VARCHAR(255) NULL, flags_json JSON NULL,
			PRIMARY KEY (hadith_id, ordinal), KEY hdith_hn_narrator (narrator_id),
			CONSTRAINT hdith_hn_hadith_fk FOREIGN KEY (hadith_id) REFERENCES hadiths(id) ON DELETE CASCADE ON UPDATE CASCADE,
			CONSTRAINT hdith_hn_narrator_fk FOREIGN KEY (narrator_id) REFERENCES hdith_narrators(id) ON DELETE CASCADE ON UPDATE CASCADE
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
		`CREATE TABLE IF NOT EXISTS hdith_subjects (
			id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, source_slug VARCHAR(32) NOT NULL, title VARCHAR(255) NOT NULL,
			source_url VARCHAR(512) NOT NULL, UNIQUE KEY hdith_subject_source (source_slug)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
		`CREATE TABLE IF NOT EXISTS hdith_hadith_subjects (
			hadith_id INT NOT NULL, subject_id INT NOT NULL, PRIMARY KEY (hadith_id, subject_id), KEY hdith_hs_subject (subject_id),
			CONSTRAINT hdith_hs_hadith_fk FOREIGN KEY (hadith_id) REFERENCES hadiths(id) ON DELETE CASCADE ON UPDATE CASCADE,
			CONSTRAINT hdith_hs_subject_fk FOREIGN KEY (subject_id) REFERENCES hdith_subjects(id) ON DELETE CASCADE ON UPDATE CASCADE
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
		`CREATE TABLE IF NOT EXISTS hdith_hadith_links (
			id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY, hadith_id INT NOT NULL, link_type ENUM('takhrij','shahid') NOT NULL,
			source_book_id INT NOT NULL, source_entry_id INT NOT NULL, source_num VARCHAR(45) NULL, label VARCHAR(255) NULL,
			internal_hadith_id INT NULL, internal_ref VARCHAR(96) NULL, source_url VARCHAR(512) NOT NULL,
			UNIQUE KEY hdith_link_source (hadith_id, link_type, source_entry_id), KEY hdith_link_internal (internal_hadith_id),
			CONSTRAINT hdith_link_hadith_fk FOREIGN KEY (hadith_id) REFERENCES hadiths(id) ON DELETE CASCADE ON UPDATE CASCADE,
			CONSTRAINT hdith_link_internal_fk FOREIGN KEY (internal_hadith_id) REFERENCES hadiths(id) ON DELETE SET NULL ON UPDATE CASCADE
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
		`CREATE TABLE IF NOT EXISTS hdith_sharh_sources (
			id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, source_book_id INT NOT NULL, title VARCHAR(255) NOT NULL, author VARCHAR(255) NULL,
			source_url VARCHAR(512) NOT NULL, UNIQUE KEY hdith_sharh_book (source_book_id)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
		`CREATE TABLE IF NOT EXISTS hdith_hadith_sharh (
			id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY, hadith_id INT NOT NULL, source_id INT NOT NULL, source_entry_id INT NOT NULL,
			chapter VARCHAR(512) NULL, page_num INT NULL, text LONGTEXT NOT NULL, format VARCHAR(8) NOT NULL DEFAULT 'md', source_url VARCHAR(512) NOT NULL,
			UNIQUE KEY hdith_sharh_entry (hadith_id, source_entry_id), KEY hdith_sharh_source (source_id), FULLTEXT KEY hdith_sharh_text (text),
			CONSTRAINT hdith_sharh_hadith_fk FOREIGN KEY (hadith_id) REFERENCES hadiths(id) ON DELETE CASCADE ON UPDATE CASCADE,
			CONSTRAINT hdith_sharh_source_fk FOREIGN KEY (source_id) REFERENCES hdith_sharh_sources(id) ON DELETE CASCADE ON UPDATE CASCADE
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
		`CREATE TABLE IF NOT EXISTS hdith_hadith_grades (
			id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY, hadith_id INT NOT NULL, ordinal SMALLINT UNSIGNED NOT NULL,
			source_slug VARCHAR(32) NOT NULL, grader VARCHAR(255) NOT NULL, grader_source_id INT NULL,
			grade TEXT NOT NULL, grade_category_id INT NULL, source_name VARCHAR(255) NULL, source_id INT NULL,
			book_page VARCHAR(64) NULL, source_driver VARCHAR(32) NULL, source_url VARCHAR(512) NOT NULL,
			UNIQUE KEY hdith_grade_source (hadith_id, source_slug), KEY hdith_grade_hadith (hadith_id, ordinal),
			CONSTRAINT hdith_grade_hadith_fk FOREIGN KEY (hadith_id) REFERENCES hadiths(id) ON DELETE CASCADE ON UPDATE CASCADE
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
	];
}

function checksum(value) {
	return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function uniqueBy(values, key) {
	const seen = new Set();
	return values.filter(value => !seen.has(key(value)) && seen.add(key(value)));
}

function compact(value) {
	return String(value || '').replace(/[\u200e\u200f]/g, '').replace(/\s+/g, ' ').trim();
}

function wait(milliseconds) {
	return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function withTimeout(promise, milliseconds, message) {
	let timer;
	return Promise.race([
		promise,
		new Promise((unused, reject) => {
			timer = setTimeout(() => reject(new Error(message)), milliseconds);
		})
	]).finally(() => clearTimeout(timer));
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
		host: process.env.MYSQL_HOST || configured.host || '127.0.0.1', port: Number(process.env.MYSQL_PORT || configured.port || 3306),
		user: process.env.MYSQL_USER || configured.user || process.env.USER, password: process.env.MYSQL_PASSWORD || configured.password || '',
		database: process.env.MYSQL_DATABASE || configured.database || 'hadithdb'
	};
}

async function closeDatabase() {
	if (dbConnection) await new Promise(resolve => dbConnection.end(resolve));
}

if (require.main === module) main();

module.exports = {
	CACHE_DIR, SIX_BOOKS, compressCachedRecord, firstHadithId, loadRecord, normalizeArabicForMatch, parseGraderOpinions, parseHadithPayload, parseLinks,
	hadithTextSimilarity, ignoresExternalGrades, normalizeHadithForComparison, parseNarrators, readOptions, referencesEquivalent,
	schemaStatements, sharhToMarkdown, sourceSlugForVerificationResult
};
