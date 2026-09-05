#!/usr/bin/env node
/* jslint node:true, esversion:11 */
'use strict';

require('dotenv').config();
const { spawn } = require('child_process');
const cheerio = require('cheerio');
const crypto = require('crypto');
const childProcess = require('child_process');
const fs = require('fs');
const mysql = require('mysql');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright-core');
const util = require('util');
const zlib = require('zlib');
const Arabic = require('../../lib/Arabic');
const HadithAttributions = require('../../lib/HadithAttributions');
const Hadith = require('../../lib/Hadith');
const Utils = require('../../lib/Utils');

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
const FOLLOWUP_BOOKS = Object.freeze([
	{ sourceSlug: 'b-7', bookId: 7, alias: 'malik' },
	{ sourceSlug: 'b-9', bookId: 9, alias: 'darimi' },
	{ sourceSlug: 'b-18', bookId: 18, alias: 'daraqutni' },
	{ sourceSlug: 'b-10', bookId: 11, alias: 'ibnhibban' },
	{ sourceSlug: 'b-11', bookId: 17, alias: 'ibnkhuzaymah' },
	{ sourceSlug: 'b-13', bookId: 34, alias: 'tabarani-awsat' },
	{ sourceSlug: 'b-14', bookId: 33, alias: 'tabarani-saghir' },
	{ sourceSlug: 'b-17', bookId: 14, alias: 'bayhaqi' },
	{ sourceSlug: 'b-19', bookId: 16, alias: 'bazzar' },
	{ sourceSlug: 'b-33', bookId: 32, alias: 'shamail' },
	{ sourceSlug: 'b-24', bookId: 10, alias: 'hakim' },
	{ sourceSlug: 'b-8', bookId: 8, alias: 'ahmad' }
]);
const SUPPORTED_BOOKS = Object.freeze([...SIX_BOOKS, ...FOLLOWUP_BOOKS]);
const HDITH_LOCAL_BOOKS = Object.freeze({
	1: { bookId: 1, alias: 'bukhari', title: 'صحيح البخاري', referenceMode: 'exact' },
	2: { bookId: 2, alias: 'muslim', title: 'صحيح مسلم', referenceMode: 'source-entry' },
	3: { bookId: 4, alias: 'abudawud', title: 'سنن أبي داود', referenceMode: 'exact' },
	4: { bookId: 5, alias: 'tirmidhi', title: 'جامع الترمذي', referenceMode: 'exact' },
	5: { bookId: 3, alias: 'nasai', title: 'سنن النسائي', referenceMode: 'exact' },
	6: { bookId: 6, alias: 'ibnmajah', title: 'سنن ابن ماجه', referenceMode: 'exact' },
	7: { bookId: 7, alias: 'malik', title: 'موطأ مالك', referenceMode: 'crosswalk' },
	8: { bookId: 8, alias: 'ahmad', title: 'مسند أحمد', referenceMode: 'exact' },
	9: { bookId: 9, alias: 'darimi', title: 'مسند الدارمي', referenceMode: 'exact' },
	10: { bookId: 11, alias: 'ibnhibban', title: 'صحيح ابن حبان', referenceMode: 'exact' },
	11: { bookId: 17, alias: 'ibnkhuzaymah', title: 'صحيح ابن خزيمة', referenceMode: 'exact' },
	12: { bookId: 12, alias: 'tabarani', title: 'المعجم الكبير', referenceMode: 'exact' },
	13: { bookId: 34, alias: 'tabarani-awsat', title: 'المعجم الأوسط', referenceMode: 'exact' },
	14: { bookId: 33, alias: 'tabarani-saghir', title: 'المعجم الصغير', referenceMode: 'exact' },
	15: { bookId: 31, alias: 'ibnabishaybah', title: 'مصنف ابن أبي شيبة', referenceMode: 'exact' },
	16: { bookId: 30, alias: 'abdalrazzaq', title: 'مصنف عبد الرزاق', referenceMode: 'exact' },
	17: { bookId: 14, alias: 'bayhaqi', title: 'سنن البيهقي الكبرى', referenceMode: 'exact' },
	18: { bookId: 18, alias: 'daraqutni', title: 'سنن الدارقطني', referenceMode: 'exact' },
	19: { bookId: 16, alias: 'bazzar', title: 'مسند البزار', referenceMode: 'exact' },
	22: { bookId: 13, alias: 'nasai-kubra', title: 'السنن الكبرى للنسائي', referenceMode: 'exact' },
	24: { bookId: 10, alias: 'hakim', title: 'المستدرك على الصحيحين', referenceMode: 'exact' },
	33: { bookId: 32, alias: 'shamail', title: 'الشمائل المحمدية', referenceMode: 'exact' }
});
const SOURCE_BOOK_ALIASES = Object.freeze(Object.fromEntries(Object.entries(HDITH_LOCAL_BOOKS).map(([id, book]) => [id, book.alias])));
const MIN_REQUEST_DELAY_MS = 100;
const INDEX_BATCH_SIZE = Math.max(1, Number(process.env.HDITH_INDEX_BATCH_SIZE) || 100);
const PENDING_INDEX_FILE = path.join(CACHE_DIR, '_pending-index-batches.log');
const HDITH_GRADE_COLORS = Object.freeze({
	0: 'oklch(58% .02 250)',
	1: 'oklch(58% .135 155)',
	2: 'oklch(68% .105 155)',
	3: 'oklch(57% .165 22)',
	4: 'oklch(68% .115 22)'
});

const options = require.main === module ? readOptions(process.argv.slice(2)) : {
	apply: false, books: SIX_BOOKS.map(book => book.sourceSlug), delay: MIN_REQUEST_DELAY_MS, maxHadiths: null, refresh: false, resumeSourceId: null, skipSchema: false
};
let dbConnection;
let dbSessionConfigured = false;
const sourceBookAuthorCache = new Map();
const narratorIdCache = new Map();
let narratorCorrectionCache = null;
const subjectIdCache = new Map();
const sharhSourceIdCache = new Map();
let legacyGradesCache;
let legacyGradersCache;
const pendingIndexHadithIds = new Set();

async function main() {
	let browser;
	try {
		fs.mkdirSync(CACHE_DIR, { recursive: true });
		browser = await startLightpanda();
		const page = await browser.context.newPage();
		if (options.apply) {
			if (!options.skipSchema) {
				await ensureSchema();
				await suspendSharhFulltextIndex();
			}
			await deferInternalLinkResolution();
		}
		for (const book of selectedBooks(options.books))
			await scrapeBook(page, book);
		if (options.apply) await flushEnrichedHadithIndex();
		if (options.apply && !options.skipSchema) await ensureSharhFulltextIndex();
	} catch (err) {
		console.error(`ERROR: ${err.stack || err.message}`);
		process.exitCode = 1;
	} finally {
		if (browser) await browser.close();
		await closeDatabase();
	}
}

function readOptions(args) {
	const parsed = { apply: false, books: SIX_BOOKS.map(book => book.sourceSlug), cacheOnly: false, delay: MIN_REQUEST_DELAY_MS, maxHadiths: null, refresh: false, resumeSourceId: null, skipSchema: false };
	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--apply') parsed.apply = true;
		else if (args[i] === '--cache-only') parsed.cacheOnly = true;
		else if (args[i] === '--refresh') parsed.refresh = true;
		else if (args[i] === '--skip-schema') parsed.skipSchema = true;
		else if (args[i] === '--book') parsed.books = [args[++i]];
		else if (args[i] === '--books') parsed.books = args[++i].split(',').map(value => value.trim()).filter(Boolean);
		else if (args[i] === '--delay') parsed.delay = Number(args[++i]);
		else if (args[i] === '--max-hadiths') parsed.maxHadiths = Number(args[++i]);
		else if (args[i] === '--resume-source-id') parsed.resumeSourceId = Number(args[++i]);
		else if (args[i] === '--help') usage(0);
		else usage(1, `Unknown option: ${args[i]}`);
	}
	if (!Number.isInteger(parsed.delay) || parsed.delay < MIN_REQUEST_DELAY_MS)
		usage(1, `--delay must be at least ${MIN_REQUEST_DELAY_MS} milliseconds.`);
	if (parsed.maxHadiths !== null && (!Number.isInteger(parsed.maxHadiths) || parsed.maxHadiths < 1))
		usage(1, '--max-hadiths must be a positive integer.');
	if (parsed.resumeSourceId !== null && (!Number.isInteger(parsed.resumeSourceId) || parsed.resumeSourceId < 1))
		usage(1, '--resume-source-id must be a positive integer.');
	for (const slug of parsed.books)
		if (!SUPPORTED_BOOKS.some(book => book.sourceSlug === slug)) usage(1, `Unknown hdith.com book source '${slug}'.`);
	if (parsed.skipSchema && !parsed.apply) usage(1, '--skip-schema requires --apply.');
	if (parsed.cacheOnly && parsed.apply) usage(1, '--cache-only cannot be combined with --apply.');
	return parsed;
}

function usage(code, message) {
	if (message) console.error(message);
	console.error(`Usage: node bin/utils/import-hdith-six-books-enrichment.js [--apply | --cache-only] [--skip-schema] [--book b-1 | --books b-1,b-2] [--delay ${MIN_REQUEST_DELAY_MS}] [--max-hadiths N] [--resume-source-id N] [--refresh]`);
	process.exit(code);
}

function selectedBooks(slugs) {
	const bySlug = new Map(SUPPORTED_BOOKS.map(book => [book.sourceSlug, book]));
	return slugs.map(slug => bySlug.get(slug));
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
	const bookPage = await fetchProps(page, `/encyclopedia/book/${config.sourceSlug}`,
		path.join(CACHE_DIR, config.sourceSlug, '_book.json.gz'));
	const chapters = bookPage.chapters || [];
	if (!chapters.length || bookPage.book?.slug !== config.sourceSlug)
		throw new Error(`${config.sourceSlug}: invalid book payload.`);
	if (options.apply && !options.skipSchema) await ensureSchema();
	if (options.apply && ignoresExternalGrades(config)) {
		const connection = await getConnection();
		await query(connection, `DELETE hg FROM hdith_hadith_grades hg
			JOIN hadiths h ON h.id=hg.hadith_id WHERE h.bookId=? AND COALESCE(hg.source_driver, '')<>'admin'`, [config.bookId]);
	}
	const bookMatcher = options.cacheOnly ? null : await createBookMatcher(config);
	let resumeRecord = options.resumeSourceId && config.sourceSlug === options.books[0]
		? await loadResumeRecord(page, config, options.resumeSourceId)
		: null;
	let handled = 0;
	for (const chapter of chapters) {
		if (options.maxHadiths !== null && handled >= options.maxHadiths) break;
		if (resumeRecord && resumeRecord.chapterId && resumeRecord.chapterId !== Number(chapter.id)) continue;
		let firstId;
		if (resumeRecord) {
			firstId = resumeRecord.sourceId;
			resumeRecord = null;
		} else {
			const listing = await fetchProps(page, `/encyclopedia/book/${config.sourceSlug}?chapter=${chapter.id}`,
				path.join(CACHE_DIR, config.sourceSlug, '_chapters', `${chapter.id}.json.gz`));
			firstId = firstHadithId(listing, config.sourceSlug);
		}
		if (!firstId) throw new Error(`${config.sourceSlug}: no first hadith for chapter ${chapter.id}.`);
		let sourceId = firstId;
		let chapterCount = 0;
		while (sourceId && chapterCount < Number(chapter.count || 0)) {
			if (options.maxHadiths !== null && handled >= options.maxHadiths) break;
			let record;
			try {
				record = await withTimeout(loadRecord(page, config, sourceId), 60000,
					`${config.sourceSlug}/h/${sourceId}: timed out loading the hadith payload`);
			} catch (err) {
				if (!isSourceNotFoundError(err)) throw err;
				console.warn(`${config.alias}: source entry ${sourceId} returned HTTP 404; ending the current chapter and continuing from the next chapter listing.`);
				break;
			}
			if (!record || (record.chapterId && record.chapterId !== Number(chapter.id))) break;
			chapterCount++;
			if (options.resumeSourceId && config.sourceSlug === options.books[0] && record.sourceId < options.resumeSourceId) {
				compressCachedRecord(config, record.sourceId);
				sourceId = record.nextId;
				continue;
			}
			if (options.cacheOnly) {
				handled++;
				if (handled % 250 === 0) console.log(`${config.alias}: cached ${handled} source entries`);
				compressCachedRecord(config, record.sourceId);
				sourceId = record.nextId;
				continue;
			}
			if (!record.isIntro) {
				const orderedMatch = bookMatcher.match(record);
				if (!orderedMatch) {
					const supplementary = options.apply && record.editionReferenceRepeated
						? await markSupplementaryTransmission(config, record, bookMatcher.lastMatch()) : false;
					if (supplementary)
						console.log(`${config.alias}: linked repeated hdith.com entry ${record.sourceId} to local ${supplementary.num}.`);
					else
						console.warn(`${config.alias}: no ordered text-confirmed local match for hdith.com entry ${record.sourceId}; skipped.`);
					compressCachedRecord(config, record.sourceId);
					sourceId = record.nextId;
					continue;
				}
				if (handled < 10)
					console.log(`${config.alias}: hdith.com ${record.sourceId} (${record.editionReference || record.num}) -> ${orderedMatch.num} (${orderedMatch.score.toFixed(3)} normalized similarity)`);
				if (options.apply) {
					const indexedHadithId = await withTimeout(applyRecordWithRetry(page, config, record, orderedMatch), 360000,
						`${config.sourceSlug}/h/${sourceId}: timed out applying enrichment`);
					if (indexedHadithId) await queueEnrichedHadithIndex(indexedHadithId);
				}
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

async function loadResumeRecord(page, config, sourceId) {
	for (let candidate = sourceId; candidate < sourceId + 250; candidate++) {
		try {
			return await withTimeout(loadRecord(page, config, candidate), 60000,
				`${config.sourceSlug}/h/${candidate}: timed out loading the resume payload`);
		} catch (err) {
			if (!isSourceNotFoundError(err)) throw err;
			console.warn(`${config.alias}: resume source entry ${candidate} returned HTTP 404; trying the next source ID.`);
		}
	}
	throw new Error(`${config.alias}: could not find a valid resume payload within 250 source IDs after ${sourceId}.`);
}

function isSourceNotFoundError(err) {
	return /(?:^|\s)HTTP 404(?:\s|$)/.test(String(err?.message || err));
}

function firstHadithId(props, sourceSlug) {
	const candidates = props.hadiths || props.entries || props.book?.hadiths || [];
	const first = candidates.find(row => row && (row.id || row.entry_id));
	if (first) return Number(first.id || first.entry_id);
	const html = JSON.stringify(props);
	const match = html.match(new RegExp(`/encyclopedia/book/${sourceSlug}/h/(\\d+)`));
	return match ? Number(match[1]) : null;
}

async function loadRecord(page, config, sourceId, runtimeOptions = {}) {
	const refresh = runtimeOptions.refresh === undefined ? options.refresh : runtimeOptions.refresh;
	const cacheFile = path.join(CACHE_DIR, config.sourceSlug, `${sourceId}.json`);
	const compressedCacheFile = `${cacheFile}.gz`;
	let hadith;
	if (!refresh && fs.existsSync(cacheFile)) {
		hadith = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
		if (!Object.prototype.hasOwnProperty.call(hadith, '_verification_url')) hadith = null;
	} else if (!refresh && fs.existsSync(compressedCacheFile)) {
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
	return parseHadithPayload(hadith, config);
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

function parseHadithPayload(hadith, config = {}) {
	const chapterPath = hadith.chapter_path || [];
	const editionReference = parseEditionReference(hadith.numberings, config.sourceSlug);
	const narrator = parsePrimaryNarrator(hadith);
	return {
		sourceId: Number(hadith.id),
		num: compact(hadith.numbering_harf || hadith.numberings?.[0]?.value),
		editionReference: editionReference.value,
		editionReferenceRepeated: editionReference.repeated,
		chapterId: Number(chapterPath[0]?.id),
		isIntro: !!hadith.is_intro || hadith.entry_kind === 'intro',
		nextId: Number(hadith.next_id) || null,
		attribution: compact(hadith.attribution) || null,
		chainType: compact(hadith.chain_type) || null,
		narrator,
		narratorEn: narrator ? Arabic.toALALCName(narrator) : null,
		sourceIsnadHtml: parseSourceIsnadHtml(hadith.isnad_html, hadith.isnad_prefix),
		gharib: parseGharib(hadith.gharib),
		collectionGrades: parseCollectionGrades(hadith),
		narrators: parseNarrators(hadith),
		subjects: (hadith.subjects || []).map(subject => ({ slug: compact(subject.slug), title: compact(subject.title) })).filter(subject => subject.slug && subject.title),
		links: parseLinks(hadith),
		sharhPreview: (hadith.services || []).find(service => Number(service.type_id) === 6)?.items || [],
		verificationUrl: compact(hadith._verification_url) || null,
		bodyStart: compact(hadith.matn) || null,
		comparisonText: compact([hadith.isnad_prefix, hadith.matn].filter(Boolean).join(' ')),
		rawChecksum: checksum(hadith)
	};
}

function parsePrimaryNarrator(hadith) {
	const explicitName = compact(hadith?.narrator).replace(/^رواه\s+/u, '').trim();
	const primary = Array.isArray(hadith?.isnad) ? hadith.isnad[0] : null;
	const name = explicitName || compact(primary?.name).replace(/^رواه\s+/u, '').trim();
	if (!name) return null;
	const sourceSlug = compact(primary?.slug);
	if (!sourceSlug || !hadith.isnad_html) return name;
	const $ = cheerio.load(`<div id="hdith-primary-narrator">${hadith.isnad_html}</div>`, null, false);
	let vocalized = null;
	$('#hdith-primary-narrator .hp-rawi').each(function () {
		if (vocalized || compact($(this).attr('data-rawi-slug')) !== sourceSlug) return;
		const candidate = compact($(this).text()).replace(/\s*[،:]\s*$/u, '').trim();
		if (normalizeArabicForMatch(candidate) === normalizeArabicForMatch(name)) vocalized = candidate;
	});
	return vocalized || name;
}

function parseEditionReference(numberings, sourceSlug = null) {
	const available = (Array.isArray(numberings) ? numberings : []).filter(numbering => compact(numbering?.value));
	// The local Musnad Ahmad text is numbered according to the Muassasat al-Risalah
	// edition. hdith.com lists the al-Maknaz numbering first, so using the generic first
	// value points at a different local hadith even when the texts otherwise agree.
	const preferred = sourceSlug === 'b-8'
		? available.find(numbering => /(?:مؤسسة\s+)?الرسالة/u.test(compact(`${numbering?.key || ''} ${numbering?.short || ''}`)))
		: null;
	const value = compact((preferred || available[0])?.value);
	return {
		value: value || null,
		repeated: /[\[(]\s*م\s*[\])]/u.test(value)
	};
}

function parseGharib(value) {
	return (Array.isArray(value) ? value : []).map(entry => ({
		sourceId: Number(entry.id) || null,
		term: compact(entry.term) || null,
		matchedText: compact(entry.matched_text) || null,
		lexicon: compact(entry.lexicon) || null,
		definitions: (Array.isArray(entry.definitions) ? entry.definitions : []).map(definition => ({
			book: compact(definition.book) || null,
			content: compact(definition.content) || null
		})).filter(definition => definition.content)
	})).filter(entry => entry.term || entry.matchedText || entry.definitions.length);
}

function parseCollectionGrades(hadith) {
	const sourceBookSlug = compact(hadith.book?.slug);
	const sourceName = compact(hadith.book?.title) || null;
	const bookPage = compact(hadith.numbering_harf || hadith.numberings?.[0]?.value) || null;
	return (hadith.grading || []).map((grading, index) => ({
		sourceSlug: `collection-${sourceBookSlug}-${index + 1}`.slice(0, 32),
		grader: compact(grading.scholar),
		graderSourceId: null,
		grade: compact(grading.opinion),
		gradeCategoryId: Number.isFinite(Number(grading.degree)) ? Number(grading.degree) : null,
		gradeColor: HDITH_GRADE_COLORS[Number(grading.degree)] || HDITH_GRADE_COLORS[0],
		source: sourceName,
		sourceId: null,
		bookPage,
		driver: compact(grading.branch) || null,
		sourceUrl: sourceBookSlug && hadith.id ? `${BASE_URL}/encyclopedia/book/${sourceBookSlug}/h/${Number(hadith.id)}` : null
	})).filter(result => result.sourceSlug && result.grader && result.grade && result.sourceUrl);
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

function parseSourceIsnadHtml(value, fallback) {
	const source = String(value || '').trim();
	if (!source) return fallback ? escapeHtml(String(fallback)) : null;
	const $ = cheerio.load(`<div id="hdith-source-isnad">${source}</div>`, null, false);
	function render(node) {
		if (node.type === 'text') return escapeHtml(node.data || '');
		if (node.type !== 'tag') return '';
		const element = $(node);
		const tag = String(node.name || '').toLowerCase();
		if (tag === 'script' || tag === 'style' || element.attr('hidden') !== undefined) return '';
		const children = (node.children || []).map(render).join('');
		const classes = String(element.attr('class') || '').split(/\s+/);
		if (!classes.includes('hp-rawi')) return children;
		const sourceSlug = compact(element.attr('data-rawi-slug'));
		if (!/^p-[0-9]+$/u.test(sourceSlug)) return children;
		const sourceUrl = `${BASE_URL}/encyclopedia/rawi/${sourceSlug}`;
		const title = compact(element.attr('data-name'));
		return `<a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer"${title ? ` title="${escapeHtml(title)}"` : ''}>${children}</a>`;
	}
	return $('#hdith-source-isnad').contents().toArray().map(render).join('').trim() || null;
}

function parseLinks(hadith) {
	const links = [];
	const bookTitles = new Map();
	for (const group of hadith.shawahid?.groups || [])
		for (const book of group.books || [])
			if (Number(book.entries?.[0]?.book_id) && compact(book.title)) bookTitles.set(Number(book.entries[0].book_id), compact(book.title));
	for (const source of hadith.takhrij?.sources || [])
		for (const occurrence of source.occurrences || []) links.push(linkRecord('takhrij', source.book_id,
			bookTitles.get(Number(source.book_id)) || compact(source.title || source.book || source.book_name)
				|| compact([source.author, source.book_quoted].filter(Boolean).join('، ')),
			occurrence.entry_id, occurrence.hadith_num, occurrence.similarity));
	for (const group of hadith.shawahid?.groups || [])
		for (const book of group.books || [])
			for (const entry of book.entries || []) links.push(linkRecord('shahid', entry.book_id, book.title, entry.entry_id, entry.number, group.narrator));
	for (const similar of hadith.similars || []) {
		const link = linkRecord('similar', similar.book_id, similar.book, similar.entry_id, similar.numbering, null);
		link.bodyStart = compact(similar.tarf || similar.matn) || null;
		links.push(link);
	}
	return uniqueBy(links.filter(link => link.sourceEntryId), link => `${link.type}:${link.sourceEntryId}`);
}

function linkRecord(type, sourceBookId, sourceBookTitle, sourceEntryId, num, label) {
	const alias = SOURCE_BOOK_ALIASES[Number(sourceBookId)] || null;
	return {
		type,
		sourceBookId: Number(sourceBookId),
		sourceBookTitle: compact(sourceBookTitle) || null,
		sourceEntryId: Number(sourceEntryId),
		num: compact(num),
		label: compact(label) || null,
		bodyStart: null,
		internalRef: alias && compact(num) ? `${alias}:${compact(num)}` : null
	};
}

async function applyRecord(page, config, record, orderedMatch, runtimeOptions = {}) {
	const refresh = runtimeOptions.refresh === undefined ? options.refresh : runtimeOptions.refresh;
	if (!record.num) throw new Error(`${config.sourceSlug}/h/${record.sourceId}: missing hadith number.`);
	const connection = await getConnection();
	const localRows = orderedMatch ? [{ id: orderedMatch.id, num: orderedMatch.num }]
		: await query(connection, 'SELECT id, num FROM hadiths WHERE bookId=? AND num=? ORDER BY id', [config.bookId, record.num]);
	if (!localRows.length) {
		console.warn(`${config.alias}:${record.num}: no exact local book/reference match for hdith.com entry ${record.sourceId}; skipped.`);
		return;
	}
	if (localRows.length !== 1) throw new Error(`${config.alias}:${record.num}: expected one local hadith, found ${localRows.length}.`);
	const hadithId = localRows[0].id;
	const localReference = localRows[0].num;
	if (narratorCorrectionCache === null) {
		narratorCorrectionCache = new Map((await query(connection, `SELECT source_slug, name_tashkil, name_ala_lc FROM hdith_narrators
			WHERE NULLIF(name_tashkil, '') IS NOT NULL`)).map(row => [row.source_slug, row]));
	}
	const narratorCorrection = narratorCorrectionCache.get(record.narrators?.[0]?.sourceSlug);
	if (narratorCorrection) {
		record.narrator = narratorCorrection.name_tashkil;
		record.narratorEn = narratorCorrection.name_ala_lc || record.narratorEn;
	}
	await correctLocalChainBodySplit(connection, hadithId, record.bodyStart, { replaceBodyFromSource: config.sourceSlug === 'b-8' });
	await query(connection, 'UPDATE hadiths SET body_start=? WHERE id=? AND NOT (body_start <=> ?)',
		[record.bodyStart, hadithId, record.bodyStart]);
	if (!refresh) {
		const existing = await query(connection, 'SELECT source_checksum, source_reference, source_edition_reference, chain_type, narrator, narrator_en, source_isnad_html, gharib_json FROM hdith_hadith_metadata WHERE hadith_id=? LIMIT 1', [hadithId]);
		if (existing[0]?.source_checksum === record.rawChecksum) {
			const expectedCollectionGrades = ignoresExternalGrades(config) ? 0 : (record.collectionGrades || []).length;
			const stored = (await query(connection, `SELECT
				(SELECT COUNT(*) FROM hdith_hadith_narrators WHERE hadith_id=?) narrators,
				(SELECT COUNT(*) FROM hdith_hadith_subjects WHERE hadith_id=?) subjects,
				(SELECT COUNT(*) FROM hdith_hadith_links WHERE hadith_id=?) links,
				(SELECT COUNT(*) FROM hdith_hadith_sharh WHERE hadith_id=?) sharh,
				(SELECT COUNT(*) FROM hdith_hadith_grades WHERE hadith_id=? AND source_slug LIKE 'collection-%') collection_grades`,
				[hadithId, hadithId, hadithId, hadithId, hadithId]))[0];
			const gharibJson = record.gharib.length ? JSON.stringify(record.gharib) : null;
			if (existing[0]?.source_reference !== record.num || existing[0]?.source_edition_reference !== record.editionReference
				|| existing[0]?.chain_type !== record.chainType
				|| existing[0]?.narrator !== record.narrator || existing[0]?.narrator_en !== record.narratorEn
				|| existing[0]?.source_isnad_html !== record.sourceIsnadHtml
				|| (gharibJson && !existing[0]?.gharib_json))
				await query(connection, 'UPDATE hdith_hadith_metadata SET source_reference=?, source_edition_reference=?, chain_type=?, narrator=?, narrator_en=?, source_isnad_html=?, gharib_json=? WHERE hadith_id=?',
					[record.num, record.editionReference, record.chainType, record.narrator, record.narratorEn, record.sourceIsnadHtml, gharibJson, hadithId]);
			const dependentRowsComplete = Number(stored.narrators) >= (record.narrators || []).length
				&& Number(stored.subjects) >= (record.subjects || []).length
				&& Number(stored.links) >= (record.links || []).length
				&& (!(record.sharhPreview || []).length || Number(stored.sharh) > 0)
				&& Number(stored.collection_grades) >= expectedCollectionGrades;
			if (dependentRowsComplete) {
				await upsertSourceReferenceMap(connection, config, record, hadithId, localReference, orderedMatch);
				await backfillLegacyGradeFromOpinions(connection, hadithId);
				await promoteColoredGradeForMissingLegacy(connection, hadithId);
				return hadithId;
			}
		}
	}
	const sharh = record.sharhPreview.length ? await fetchSharh(page, config, record.sourceId) : [];
	const externalGraderOpinions = record.verificationUrl && !ignoresExternalGrades(config)
		? await fetchGraderOpinions(page, record.verificationUrl, config, record.num) : [];
	const graderOpinions = ignoresExternalGrades(config) ? []
		: uniqueBy([...(record.collectionGrades || []), ...externalGraderOpinions], opinion => opinion.sourceSlug);
	try {
		await query(connection, 'START TRANSACTION');
		await query(connection, `INSERT INTO hdith_hadith_metadata
			(hadith_id, source_book_slug, source_entry_id, source_reference, source_edition_reference, attribution, chain_type, narrator, narrator_en, source_isnad_html, gharib_json, takhrij_json, shawahid_json, source_checksum)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON DUPLICATE KEY UPDATE source_entry_id=VALUES(source_entry_id), source_reference=VALUES(source_reference), source_edition_reference=VALUES(source_edition_reference), attribution=VALUES(attribution),
				chain_type=VALUES(chain_type), narrator=VALUES(narrator), narrator_en=VALUES(narrator_en), source_isnad_html=VALUES(source_isnad_html), gharib_json=VALUES(gharib_json), takhrij_json=VALUES(takhrij_json), shawahid_json=VALUES(shawahid_json), source_checksum=VALUES(source_checksum), lastmod=NOW()`,
			[hadithId, config.sourceSlug, record.sourceId, record.num, record.editionReference, record.attribution, record.chainType,
			 record.narrator, record.narratorEn, record.sourceIsnadHtml,
			 record.gharib.length ? JSON.stringify(record.gharib) : null,
			 JSON.stringify(record.links.filter(link => link.type === 'takhrij')),
			 JSON.stringify(record.links.filter(link => link.type === 'shahid')), record.rawChecksum]);
		await upsertSourceReferenceMap(connection, config, record, hadithId, localReference, orderedMatch);
		await replaceNarrators(connection, hadithId, record.narrators);
		await replaceSubjects(connection, hadithId, record.subjects);
		await replaceLinks(connection, hadithId, record.links);
		await replaceSharh(connection, hadithId, sharh);
		await replaceGraderOpinions(connection, hadithId, graderOpinions);
		await backfillLegacyGradeFromOpinions(connection, hadithId);
		await promoteColoredGradeForMissingLegacy(connection, hadithId);
		await query(connection, 'COMMIT');
		return hadithId;
	} catch (err) {
		await query(connection, 'ROLLBACK').catch(() => {});
		narratorIdCache.clear();
		subjectIdCache.clear();
		sharhSourceIdCache.clear();
		throw err;
	}
}

async function queueEnrichedHadithIndex(hadithId) {
	pendingIndexHadithIds.add(Number(hadithId));
	if (pendingIndexHadithIds.size >= INDEX_BATCH_SIZE) await flushEnrichedHadithIndex();
}

async function flushEnrichedHadithIndex() {
	if (!pendingIndexHadithIds.size) return;
	const ids = [...pendingIndexHadithIds];
	const script = path.join(__dirname, '..', 'indexEnrichedHadithBatch.js');
	try {
		const result = await util.promisify(childProcess.execFile)(process.execPath, [script, ids.join(',')], {
			cwd: path.join(__dirname, '..', '..'), maxBuffer: 10 * 1024 * 1024
		});
		console.log(`search: ${String(result.stdout || '').trim()}`);
	} catch (err) {
		fs.mkdirSync(path.dirname(PENDING_INDEX_FILE), { recursive: true });
		fs.appendFileSync(PENDING_INDEX_FILE, `${new Date().toISOString()}\t${ids.join(',')}\n`);
		console.warn(`search: deferred ${ids.length} enriched hadith(s) to ${PENDING_INDEX_FILE}: ${String(err.stderr || err.message).split('\n')[0]}`);
	} finally {
		pendingIndexHadithIds.clear();
	}
}

async function applyRecordWithRetry(page, config, record, orderedMatch, runtimeOptions = {}) {
	const maxAttempts = 8;
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			return await applyRecord(page, config, record, orderedMatch, runtimeOptions);
		} catch (err) {
			const retryable = ['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT', 'ER_SERVER_SHUTDOWN',
				'PROTOCOL_CONNECTION_LOST', 'ECONNREFUSED', 'ECONNRESET'].includes(err?.code);
			if (!retryable || attempt === maxAttempts) throw err;
			const retryDelay = Math.max(250, options.delay, Math.min(10000, attempt * 1000));
			console.warn(`${config.sourceSlug}/h/${record.sourceId}: ${err.code}; retrying apply (${attempt + 1}/${maxAttempts}) after ${retryDelay} ms.`);
			if (!['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(err?.code)) await resetDatabaseConnection();
			await wait(retryDelay);
		}
	}
}

async function resetDatabaseConnection() {
	if (dbConnection) dbConnection.destroy();
	dbConnection = null;
	dbSessionConfigured = false;
}

function ignoresExternalGrades(config) {
	return config.sourceSlug === 'b-1' || config.sourceSlug === 'b-2';
}

async function createBookMatcher(config) {
	const connection = await getConnection();
	const rows = await query(connection, `SELECT id, num, chain, body
		FROM hadiths WHERE bookId=? ORDER BY ${localHadithOrderClause(config)}`, [config.bookId]);
	const rowIndexById = new Map(rows.map((row, index) => [Number(row.id), index]));
	const storedMappings = new Map((await query(connection, `SELECT source_entry_id, hadith_id
		FROM hdith_hadith_metadata WHERE source_book_slug=?`, [config.sourceSlug]))
		.map(mapping => [Number(mapping.source_entry_id), rowIndexById.get(Number(mapping.hadith_id))])
		.filter(mapping => Number.isInteger(mapping[1])));
	let cursor = 0;
	if (options.resumeSourceId && options.books[0] === config.sourceSlug) {
		const previous = await query(connection, `SELECT hadith_id
			FROM hdith_hadith_metadata
			WHERE source_book_slug=? AND source_entry_id < ?
			ORDER BY source_entry_id DESC LIMIT 1`, [config.sourceSlug, options.resumeSourceId]);
		if (previous[0]) {
			const previousIndex = rows.findIndex(row => Number(row.id) === Number(previous[0].hadith_id));
			if (previousIndex < 0)
				throw new Error(`${config.alias}: could not restore ordered matcher cursor before hdith.com entry ${options.resumeSourceId}.`);
			cursor = previousIndex + 1;
			console.log(`${config.alias}: restored ordered matcher after local ${rows[previousIndex].num} for hdith.com resume ${options.resumeSourceId}`);
		}
	}
	return createOrderedTextMatcher(rows, cursor, config.sourceSlug === 'b-11'
		? { existingMatches: storedMappings, preferEarliestOrderedMatch: true, windowSize: 180 }
		: (config.sourceSlug === 'b-24'
			? { existingMatches: storedMappings, minimumScore: 0.80, windowSize: 180 }
			: { existingMatches: storedMappings }));
}

function localHadithOrderClause(config) {
	// Ibn Khuzaymah and Bazzar have imported local ordinals that interleave
	// numbering blocks. hdith.com follows printed-reference order, so an ordinal
	// cursor can skip a valid earlier-numbered candidate and jump to a later
	// similar transmission. Keep these collections in numeric reference order.
	return config?.sourceSlug === 'b-11' || config?.sourceSlug === 'b-19'
		? 'CAST(num AS UNSIGNED), num, id'
		: 'ordinal, id';
}

function createOrderedTextMatcher(rows, initialCursor = 0, matcherOptions = {}) {
	let cursor = initialCursor;
	const minimumScore = Number(matcherOptions.minimumScore) || 0.90;
	let lastMatched = initialCursor > 0 ? { ...rows[initialCursor - 1], index: initialCursor - 1 } : null;
	const indexesByReference = new Map();
	rows.forEach((row, index) => {
		const reference = referenceBase(row.num);
		if (!reference) return;
		if (!indexesByReference.has(reference)) indexesByReference.set(reference, []);
		indexesByReference.get(reference).push(index);
	});
	function scoredMatch(record, indexes, allowSameReferenceMatn = false) {
		const source = normalizeHadithForComparison(record.comparisonText);
		if (!source) return null;
		let best = null;
		for (const index of indexes) {
			if (index < cursor || index >= rows.length) continue;
			let score = hadithPrefixSimilarity(source,
				normalizeHadithForComparison([rows[index].chain, rows[index].body].filter(Boolean).join(' ')));
			if (allowSameReferenceMatn && record.bodyStart)
				score = Math.max(score, hadithPrefixSimilarity(record.bodyStart, rows[index].body));
			if (!best || score > best.score) best = { ...rows[index], index, score };
			if (score >= 0.96) break;
		}
		return best;
	}
	return {
		match(record) {
			const existingIndex = matcherOptions.existingMatches?.get(Number(record.sourceId));
			if (Number.isInteger(existingIndex)) {
				// Preserve a stored source mapping during replay. If it is behind the
				// ordered cursor, it has already been passed and must not be fuzzily
				// rematched to another hadith with the same unique source entry.
				if (existingIndex < cursor) return null;
				const existingMatch = { ...rows[existingIndex], index: existingIndex, score: 1 };
				cursor = existingIndex + 1;
				lastMatched = existingMatch;
				return existingMatch;
			}
			// Repeated/supplementary source records are not standalone edition hadiths.
			// Skipping them without advancing the cursor prevents every later match from shifting.
			if (!record.editionReference || record.editionReferenceRepeated) return null;
			const windowSize = Number(matcherOptions.windowSize) || 120;
			const end = Math.min(rows.length, cursor + windowSize);
			if (matcherOptions.preferEarliestOrderedMatch) {
				const source = normalizeHadithForComparison(record.comparisonText);
				if (!source) return null;
				for (let index = cursor; index < end; index++) {
					const score = hadithPrefixSimilarity(source,
						normalizeHadithForComparison([rows[index].chain, rows[index].body].filter(Boolean).join(' ')));
					if (score < minimumScore) continue;
					const match = { ...rows[index], index, score };
					cursor = index + 1;
					lastMatched = match;
					return match;
				}
				return null;
			}
			let best = null;
			best = scoredMatch(record, indexesByReference.get(referenceBase(record.editionReference)) || [], true);
			if (!best || best.score < minimumScore)
				best = scoredMatch(record, Array.from({ length: end - cursor }, (unused, offset) => cursor + offset));
			if (!best || best.score < minimumScore) return null;
			cursor = best.index + 1;
			lastMatched = best;
			return best;
		},
		lastMatch() { return lastMatched; }
	};
}

function referenceBase(value) {
	const normalized = String(value || '').replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit))).trim();
	return normalized.match(/\d+/)?.[0] || null;
}

function normalizeHadithForComparison(value) {
	return htmlText(value)
		.replace(/[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06edـ]/g, '')
		.replace(/صلى\s+الله\s+عليه\s+وسلم|عليه\s+الصلاة\s+والسلام|ﷺ/gu, ' ')
		.replace(/رض[يى]\s+الله\s+(?:تعالى\s+)?عن(?:ه|ها|هما|هم|هن)|ؓ/gu, ' ')
		.replace(/رحمه\s+الله(?:\s+تعالى)?/gu, ' ')
		.replace(/[إأآٱ]/g, 'ا').replace(/[ئى]/g, 'ي').replace(/ؤ/g, 'و').replace(/ة/g, 'ه')
		.replace(/[^\u0621-\u063a\u0641-\u064a0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
		.replace(/(^|\s)(?:ثنا|نا)(?=\s)/gu, '$1حدثنا')
		.replace(/(^|\s)انا(?=\s)/gu, '$1اخبرنا')
		// hdith.com's Ibn Khuzaymah text commonly includes this fixed riwayah
		// wrapper before the compiler-level chain stored by the local edition.
		// Removing only the exact leading wrapper preserves strict comparison of
		// the actual chain and matn while avoiding collection-wide false failures.
		.replace(/^اخبرنا ابو طاهر قال حدثنا ابو بكر قال\s*/u, '');
}

function normalizedArabicTokensWithOffsets(value) {
	const source = String(value || '');
	const tokens = [];
	const expression = /[\u0621-\u063a\u0641-\u064a\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06edـ]+|[0-9٠-٩]+/gu;
	for (const match of source.matchAll(expression)) {
		const normalized = normalizeHadithForComparison(match[0]);
		if (normalized) tokens.push({ value: normalized, start: match.index, end: match.index + match[0].length });
	}
	return tokens;
}

function proposedChainBodySplit(chain, body, sourceMatn) {
	const originalChain = String(chain || '').trim();
	const originalBody = String(body || '').trim();
	const combined = [originalChain, originalBody].filter(Boolean).join(' ');
	const localTokens = normalizedArabicTokensWithOffsets(combined);
	let sourceTokens = normalizeHadithForComparison(sourceMatn).split(' ').filter(Boolean);
	while (sourceTokens.length && /^\d+$/u.test(sourceTokens[0])) sourceTokens.shift();
	if (!combined || sourceTokens.length < 2 || localTokens.length < 2) return null;

	const candidates = [];
	for (let index = 0; index < localTokens.length; index++) {
		if (localTokens[index].value !== sourceTokens[0]) continue;
		const compared = Math.min(30, sourceTokens.length, localTokens.length - index);
		if (compared < Math.min(4, sourceTokens.length)) continue;
		let exact = 0;
		for (let offset = 0; offset < compared; offset++)
			if (localTokens[index + offset].value === sourceTokens[offset]) exact++;
		const score = exact / compared;
		if (score >= 0.9) candidates.push({ index, score, compared });
	}
	if (!candidates.length) return null;
	candidates.sort((left, right) => right.score - left.score || right.compared - left.compared || left.index - right.index);
	if (candidates[1] && candidates[1].score === candidates[0].score && candidates[1].compared === candidates[0].compared)
		return null;
	let boundary = localTokens[candidates[0].index].start;
	while (boundary > 0 && /[\s*_{[(«“\"]/.test(combined[boundary - 1])) boundary--;
	const correctedChain = combined.slice(0, boundary).trim();
	const correctedBody = combined.slice(boundary).trim();
	if (!correctedBody || (correctedChain === originalChain && correctedBody === originalBody)) return null;
	return { chain: correctedChain, body: correctedBody, score: candidates[0].score };
}

function proposedBodyFootnoteSplit(body, footnote, sourceMatn) {
	const originalBody = String(body || '').trim();
	const originalFootnote = String(footnote || '').trim();
	const localTokens = normalizedArabicTokensWithOffsets(originalBody);
	let sourceTokens = normalizeHadithForComparison(sourceMatn).split(' ').filter(Boolean);
	while (sourceTokens.length && /^\d+$/u.test(sourceTokens[0])) sourceTokens.shift();
	if (sourceTokens.length < 4 || localTokens.length < 4) return null;
	const startCompared = Math.min(30, sourceTokens.length, localTokens.length);
	let startExact = 0;
	for (let index = 0; index < startCompared; index++)
		if (sourceTokens[index] === localTokens[index].value) startExact++;
	if (startExact / startCompared < 0.9) return null;

	const anchorLength = Math.min(8, sourceTokens.length);
	const suffix = sourceTokens.slice(-anchorLength);
	const expectedStart = sourceTokens.length - anchorLength;
	const candidates = [];
	for (let index = 0; index <= localTokens.length - anchorLength; index++) {
		if (suffix.every((token, offset) => token === localTokens[index + offset].value))
			candidates.push(index);
	}
	if (!candidates.length) return null;
	candidates.sort((left, right) => Math.abs(left - expectedStart) - Math.abs(right - expectedStart));
	const suffixStart = candidates[0];
	if (Math.abs(suffixStart - expectedStart) > Math.max(10, Math.ceil(sourceTokens.length * 0.15))) return null;
	let boundary = localTokens[suffixStart + anchorLength - 1].end;
	while (boundary < originalBody.length && /[\s*_.،؛:!?؟۔»”\"')}\]ﷺؓ]/.test(originalBody[boundary])) boundary++;
	const correctedBody = originalBody.slice(0, boundary).trim();
	const moved = originalBody.slice(boundary).trim();
	const correctedFootnote = [moved, originalFootnote].filter(Boolean).join(' ').trim();
	if (!correctedBody || (correctedBody === originalBody && correctedFootnote === originalFootnote)) return null;
	return { body: correctedBody, footnote: correctedFootnote || null };
}

async function correctLocalChainBodySplit(connection, hadithId, sourceMatn, runtimeOptions = {}) {
	const rows = await query(connection, 'SELECT chain, chain_en, body, footnote FROM hadiths WHERE id=? LIMIT 1', [hadithId]);
	if (!rows[0]) return false;
	sourceMatn = Utils.normalizeArabicHonorifics(sourceMatn);
	const split = sourceMatn && proposedChainBodySplit(rows[0].chain, rows[0].body, sourceMatn);
	const chain = Utils.normalizeArabicHonorifics(split ? split.chain : String(rows[0].chain || '').trim()).replace(/\s+/g, ' ').trim();
	let body = Utils.normalizeArabicHonorifics(split ? split.body : String(rows[0].body || '').trim()).replace(/\s+/g, ' ').trim();
	let footnote = Utils.normalizeArabicHonorifics(String(rows[0].footnote || '').trim()) || null;
	const bodyFootnoteSplit = sourceMatn && proposedBodyFootnoteSplit(body, footnote, sourceMatn);
	if (bodyFootnoteSplit) {
		body = bodyFootnoteSplit.body;
		footnote = bodyFootnoteSplit.footnote;
	}
	if (runtimeOptions.replaceBodyFromSource && String(sourceMatn || '').trim()) body = String(sourceMatn).trim();
	const chainEn = Hadith.transliteratedNarratorChain(chain).chain_en;
	const chainChanged = chain !== String(rows[0].chain || '').trim();
	const bodyChanged = body !== String(rows[0].body || '').trim();
	const footnoteChanged = footnote !== (String(rows[0].footnote || '').trim() || null);
	if (!split && !bodyFootnoteSplit && !chainChanged && !bodyChanged && !footnoteChanged && chainEn === String(rows[0].chain_en || '').trim()) return false;
	await query(connection, 'UPDATE hadiths SET chain=?, body=?, footnote=?, chain_en=?, text=? WHERE id=?',
		[chain, body, footnote, chainEn, [chain, body].filter(Boolean).join(' ').trim(), hadithId]);
	return true;
}

function hadithTextSimilarity(left, right) {
	if (!left || !right) return 0;
	if (left === right) return 1;
	if (left.length >= 20 && (left.includes(right) || right.includes(left)))
		return 1;
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
	const rightTokensLength = right.split(' ').length;
	const dice = (2 * intersection) / (leftTokens.length + rightTokensLength);
	// Collections often store only an abridged clause while hdith.com stores the
	// full matn (or vice versa). Strong coverage of the shorter text is still a
	// reliable confirmation, unlike length-sensitive Dice similarity alone.
	const shorterLength = Math.min(leftTokens.length, rightTokensLength);
	const shorterCoverage = shorterLength >= 5 && intersection >= 4 ? intersection / shorterLength : 0;
	return Math.max(dice, shorterCoverage);
}

function hadithPrefixSimilarity(left, right, tokenLimit = 80) {
	const sourceTokens = normalizedPrefixTokens(left, tokenLimit);
	const localTokens = normalizedPrefixTokens(right, tokenLimit);
	if (!sourceTokens.length || !localTokens.length) return 0;
	const previous = new Uint16Array(localTokens.length + 1);
	for (let sourceIndex = 1; sourceIndex <= sourceTokens.length; sourceIndex++) {
		const current = new Uint16Array(localTokens.length + 1);
		for (let localIndex = 1; localIndex <= localTokens.length; localIndex++)
			current[localIndex] = sourceTokens[sourceIndex - 1] === localTokens[localIndex - 1]
				? previous[localIndex - 1] + 1
				: Math.max(previous[localIndex], current[localIndex - 1]);
		previous.set(current);
	}
	return previous[localTokens.length] / Math.min(sourceTokens.length, localTokens.length);
}

function normalizedPrefixTokens(value, tokenLimit) {
	return normalizeHadithForComparison(value)
		.replace(/^\d+(?:\s+\d+)?\s+م?\s*/u, '')
		.split(' ').filter(Boolean).slice(0, tokenLimit);
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
		&& !isCollectionAuthorVerificationResult(sourceBookSlug, result.muhaddith)
	).map(result => ({
		sourceSlug: compact(result.slug),
		grader: compact(result.muhaddith),
		graderSourceId: Number(result.muhaddith_id) || null,
		grade: compact(result.degree),
		gradeCategoryId: Number(result.degree_category_id),
		gradeColor: HDITH_GRADE_COLORS[Number(result.degree_category_id)] || HDITH_GRADE_COLORS[0],
		source: compact(result.source),
		sourceId: Number(result.source_id) || null,
		bookPage: compact(result.book_page) || null,
		driver: compact(result.driver) || null,
		sourceUrl: result.slug ? `${BASE_URL}/h/${result.slug}` : null
	})).filter(result => result.sourceSlug && result.grader && result.grade), result => result.sourceSlug);
}

function isCollectionAuthorVerificationResult(sourceBookSlug, grader) {
	if (sourceBookSlug === 'b-4' || sourceBookSlug === 'b-33') return false;
	const collectionAuthors = {
		'b-1': /البخاري/,
		'b-2': /مسلم/,
		'b-3': /ابو داود/,
		'b-5': /النسايي/,
		'b-6': /ابن ماجه/,
		'b-7': /مالك/,
		'b-8': /احمد(?: بن حنبل)?/,
		'b-9': /الدارمي/,
		'b-10': /ابن حبان/,
		'b-11': /ابن خزيمه/,
		'b-18': /الدارقطني/,
		'b-19': /البزار/,
		'b-24': /الحاكم/,
		'b-33': /الترمذي/
	};
	return collectionAuthors[sourceBookSlug]?.test(normalizeArabicForMatch(grader)) || false;
}

function sourceSlugForVerificationResult(source) {
	const normalized = normalizeArabicForMatch(source);
	if (/البخاري/.test(normalized)) return 'b-1';
	if (/مسلم/.test(normalized)) return 'b-2';
	if (/ابي داود|ابو داود/.test(normalized)) return 'b-3';
	if (/الترمذي/.test(normalized)) return 'b-4';
	if (/النسايي/.test(normalized)) return 'b-5';
	if (/ابن ماجه/.test(normalized)) return 'b-6';
	if (/موطا مالك|مالك/.test(normalized)) return 'b-7';
	if (/مسند احمد|احمد بن حنبل/.test(normalized)) return 'b-8';
	if (/الدارمي/.test(normalized)) return 'b-9';
	if (/ابن حبان/.test(normalized)) return 'b-10';
	if (/ابن خزيمه/.test(normalized)) return 'b-11';
	if (/الدارقطني/.test(normalized)) return 'b-18';
	if (/البزار/.test(normalized)) return 'b-19';
	if (/الحاكم/.test(normalized)) return 'b-24';
	if (/الشمايل/.test(normalized)) return 'b-33';
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
	const translations = new Map((await query(connection, `SELECT source_slug, ordinal, grader_en, grade_en, grade_category_id, grade_color
		FROM hdith_hadith_grades WHERE hadith_id=? AND COALESCE(source_driver, '')<>'admin'`, [hadithId]))
		.map(row => [row.source_slug, row]));
	await query(connection, "DELETE FROM hdith_hadith_grades WHERE hadith_id=? AND COALESCE(source_driver, '')<>'admin'", [hadithId]);
	for (let index = 0; index < opinions.length; index++) {
		const opinion = opinions[index];
		const translation = translations.get(opinion.sourceSlug) || {};
		const ordinal = Number.isFinite(Number(translation.ordinal)) ? Number(translation.ordinal) : index + 1;
		const gradeCategoryId = translation.grade_category_id !== null && translation.grade_category_id !== undefined ? translation.grade_category_id : opinion.gradeCategoryId;
		const gradeColor = translation.grade_color || opinion.gradeColor;
		await query(connection, `INSERT INTO hdith_hadith_grades
			(hadith_id, ordinal, source_slug, grader, grader_en, grader_source_id, grade, grade_en, grade_category_id, grade_color,
			 source_name, source_id, book_page, source_driver, source_url)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [hadithId, ordinal, opinion.sourceSlug, opinion.grader,
				translation.grader_en || null, opinion.graderSourceId, opinion.grade, translation.grade_en || null, gradeCategoryId, gradeColor, opinion.source, opinion.sourceId,
				opinion.bookPage, opinion.driver, opinion.sourceUrl]);
	}
}

function preferredColoredGradeOpinion(opinions) {
	return (Array.isArray(opinions) ? opinions : []).map((opinion, index) => ({ opinion, index }))
		.filter(entry => Number(entry.opinion?.grade_category_id ?? entry.opinion?.gradeCategoryId) >= 1
			&& Number(entry.opinion?.grade_category_id ?? entry.opinion?.gradeCategoryId) <= 4
			&& normalizeArabicForMatch(entry.opinion?.grade))
		.sort((left, right) => Number(right.opinion.grade_category_id ?? right.opinion.gradeCategoryId)
			- Number(left.opinion.grade_category_id ?? left.opinion.gradeCategoryId)
			|| normalizeArabicForMatch(left.opinion.grade).length - normalizeArabicForMatch(right.opinion.grade).length
			|| left.index - right.index)[0]?.opinion || null;
}

async function promoteColoredGradeForMissingLegacy(connection, hadithId) {
	const rows = await query(connection, `SELECT hg.id, hg.ordinal, hg.grade, hg.grade_category_id
		FROM hadiths h JOIN hdith_hadith_grades hg ON hg.hadith_id=h.id
		WHERE h.id=? AND h.gradeId=-1 ORDER BY hg.ordinal, hg.id`, [hadithId]);
	const preferred = preferredColoredGradeOpinion(rows);
	if (!preferred || Number(rows[0]?.id) === Number(preferred.id)) return false;
	const ordered = [preferred, ...rows.filter(row => Number(row.id) !== Number(preferred.id))];
	const cases = ordered.map(() => 'WHEN ? THEN ?').join(' ');
	const values = ordered.flatMap((row, index) => [row.id, index + 1]);
	await query(connection, `UPDATE hdith_hadith_grades SET ordinal=CASE id ${cases} ELSE ordinal END WHERE hadith_id=?`,
		[...values, hadithId]);
	return true;
}

function preferredLegacyOpinion(opinions) {
	const normalized = (opinions || []).map(opinion => ({ ...opinion, normalizedGrader: normalizeArabicForMatch(opinion.grader) }));
	return normalized.find(opinion => /الارنا?و+ط/.test(opinion.normalizedGrader))
		|| normalized.find(opinion => /الالباني/.test(opinion.normalizedGrader)) || null;
}

function legacyGradeForOpinion(opinion, grades) {
	const ruling = normalizeArabicForMatch(opinion?.grade);
	if (!ruling) return null;
	return [...(grades || [])].filter(grade => Number(grade.id) !== -1 && normalizeArabicForMatch(grade.grade))
		.sort((left, right) => normalizeArabicForMatch(right.grade).length - normalizeArabicForMatch(left.grade).length)
		.find(grade => ruling.includes(normalizeArabicForMatch(grade.grade))) || null;
}

async function backfillLegacyGradeFromOpinions(connection, hadithId) {
	const hadith = (await query(connection, 'SELECT gradeId FROM hadiths WHERE id=? LIMIT 1', [hadithId]))[0];
	if (!hadith || (hadith.gradeId !== null && Number(hadith.gradeId) !== -1)) return false;
	const opinion = preferredLegacyOpinion(await query(connection,
		'SELECT grader, grade FROM hdith_hadith_grades WHERE hadith_id=? ORDER BY ordinal, id', [hadithId]));
	if (!opinion) return false;
	if (!legacyGradesCache) legacyGradesCache = await query(connection, 'SELECT id, grade FROM grades WHERE id<>-1');
	if (!legacyGradersCache) legacyGradersCache = await query(connection, 'SELECT id, shortName, name FROM graders');
	const grade = legacyGradeForOpinion(opinion, legacyGradesCache);
	const normalizedGrader = normalizeArabicForMatch(opinion.grader);
	const grader = legacyGradersCache.find(candidate => {
		const names = `${normalizeArabicForMatch(candidate.shortName)} ${normalizeArabicForMatch(candidate.name)}`;
		return /الالباني/.test(normalizedGrader) ? /الالباني/.test(names) : /الارنا?و+ط/.test(names);
	});
	if (!grade || !grader) return false;
	const result = await query(connection, `UPDATE hadiths SET gradeId=?, graderId=?
		WHERE id=? AND (gradeId IS NULL OR gradeId=-1)`, [grade.id, grader.id, hadithId]);
	return result.affectedRows > 0;
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
	const values = links.map(link => {
		return [hadithId, link.type, link.sourceBookId, link.sourceBookTitle, link.sourceEntryId, link.num || null, link.label, link.bodyStart || null,
			null, null,
			`${BASE_URL}/encyclopedia/book/b-${link.sourceBookId}/h/${link.sourceEntryId}`];
	});
	for (let index = 0; index < values.length; index += 500)
		await query(connection, `INSERT INTO hdith_hadith_links
			(hadith_id, link_type, source_book_id, source_book_title, source_entry_id, source_num, label, source_body_start, internal_hadith_id, internal_ref, source_url)
			VALUES ?`, [values.slice(index, index + 500)]);
}

async function upsertSourceReferenceMap(connection, config, record, hadithId, localReference, orderedMatch) {
	const sourceBookId = Number(config.sourceSlug.replace(/^b-/, ''));
	await query(connection, `INSERT INTO hdith_book_reference_crosswalk
		(source_book_id, source_entry_id, source_num, source_edition_num, local_hadith_id, local_ref, similarity, is_supplementary)
		VALUES (?, ?, ?, ?, ?, ?, ?, 0)
		ON DUPLICATE KEY UPDATE source_num=VALUES(source_num), source_edition_num=VALUES(source_edition_num), local_hadith_id=VALUES(local_hadith_id),
			local_ref=VALUES(local_ref), similarity=VALUES(similarity), is_supplementary=0, lastmod=NOW()`,
	[sourceBookId, record.sourceId, record.num, record.editionReference, hadithId, localReference, orderedMatch ? orderedMatch.score : 1]);
}

async function markSupplementaryTransmission(config, record, previousMatch) {
	const connection = await getConnection();
	const sourceReference = referenceBase(record.editionReference);
	let target = previousMatch && sourceReference === referenceBase(previousMatch.num) ? previousMatch : null;
	if (!target && sourceReference) {
		const stored = await query(connection, `SELECT m.hadith_id AS id, h.num
			FROM hdith_hadith_metadata m JOIN hadiths h ON h.id=m.hadith_id
			WHERE m.source_book_slug=? AND m.source_edition_reference=? LIMIT 1`, [config.sourceSlug, sourceReference]);
		target = stored[0] || null;
	}
	if (!target) return false;
	await query(connection, 'UPDATE hadiths SET hasSupplementaryTransmissions=1 WHERE id=?', [target.id]);
	const sourceBookId = Number(config.sourceSlug.replace(/^b-/, ''));
	await query(connection, `INSERT INTO hdith_book_reference_crosswalk
		(source_book_id, source_entry_id, source_num, source_edition_num, local_hadith_id, local_ref, similarity, is_supplementary)
		VALUES (?, ?, ?, ?, ?, ?, NULL, 1)
		ON DUPLICATE KEY UPDATE source_num=VALUES(source_num), source_edition_num=VALUES(source_edition_num),
			local_hadith_id=VALUES(local_hadith_id), local_ref=VALUES(local_ref), similarity=NULL, is_supplementary=1, lastmod=NOW()`,
		[sourceBookId, record.sourceId, record.num, record.editionReference, target.id, target.num]);
	return target;
}

async function deferInternalLinkResolution() {
	const connection = await getConnection();
	await query(connection, `UPDATE hdith_hadith_links SET internal_hadith_id=NULL, internal_ref=NULL
		WHERE internal_hadith_id IS NOT NULL OR internal_ref IS NOT NULL`);
}

function resolveLinkTarget(link, crosswalkMatch = null) {
	const target = HDITH_LOCAL_BOOKS[link.sourceBookId];
	return {
		sourceNum: link.num || null,
		internalHadithId: crosswalkMatch?.id || null,
		internalRef: crosswalkMatch && target ? `${target.alias}:${crosswalkMatch.num}` : null
	};
}

async function seedHdithBookMappings(connection) {
	const values = Object.entries(HDITH_LOCAL_BOOKS).map(([sourceBookId, book]) => [
		Number(sourceBookId), book.title, book.bookId, book.alias, book.referenceMode
	]);
	await query(connection, `INSERT INTO hdith_book_mappings
		(source_book_id, source_book_title, local_book_id, local_alias, reference_mode) VALUES ?
		ON DUPLICATE KEY UPDATE source_book_title=VALUES(source_book_title), local_book_id=VALUES(local_book_id),
			local_alias=VALUES(local_alias), reference_mode=VALUES(reference_mode), lastmod=NOW()`, [values]);
	await ensureBookHdithReferences(connection);
}

async function ensureBookHdithReferences(connection) {
	const columns = await query(connection, `SELECT 1 FROM information_schema.columns
		WHERE table_schema=DATABASE() AND table_name='books' AND column_name='hdith_book_id' LIMIT 1`);
	if (!columns.length)
		await query(connection, 'ALTER TABLE books ADD COLUMN hdith_book_id INT NULL AFTER id');
	const indexes = await query(connection, `SELECT 1 FROM information_schema.statistics
		WHERE table_schema=DATABASE() AND table_name='books' AND index_name='books_hdith_book_id' LIMIT 1`);
	if (!indexes.length)
		await query(connection, 'ALTER TABLE books ADD UNIQUE KEY books_hdith_book_id (hdith_book_id)');
	await query(connection, `UPDATE books b JOIN hdith_book_mappings m ON m.local_book_id=b.id
		SET b.hdith_book_id=m.source_book_id
		WHERE b.hdith_book_id IS NULL OR b.hdith_book_id<>m.source_book_id`);
}

async function enrichSingleHadith({ sourceBookId, sourceEntryId, localHadithId, localReference, similarity = 1 }) {
	const mapped = HDITH_LOCAL_BOOKS[Number(sourceBookId)];
	if (!mapped) throw new Error(`hdith.com book b-${sourceBookId} is not mapped to a local book.`);
	if (!Number.isInteger(Number(sourceEntryId)) || Number(sourceEntryId) < 1)
		throw new Error('A valid hdith.com source entry id is required.');
	if (!Number.isInteger(Number(localHadithId)) || Number(localHadithId) < 1)
		throw new Error('A valid local hadith id is required.');
	const config = { ...mapped, sourceSlug: `b-${Number(sourceBookId)}` };
	let browser;
	try {
		await ensureSchema();
		browser = await startLightpanda();
		const page = await browser.context.newPage();
		const record = await loadRecord(page, config, Number(sourceEntryId), { refresh: true });
		await applyRecordWithRetry(page, config, record, {
			id: Number(localHadithId), num: String(localReference), score: Number(similarity)
		}, { refresh: true });
		return {
			sourceBookId: Number(sourceBookId), sourceEntryId: record.sourceId,
			sourceReference: record.num,
			sourceUrl: `${BASE_URL}/encyclopedia/book/${config.sourceSlug}/h/${record.sourceId}`
		};
	} finally {
		if (browser) await browser.close();
	}
}

async function fetchSharh(page, config, sourceId) {
	const props = await fetchProps(page, `/encyclopedia/book/${config.sourceSlug}/h/${sourceId}/service/6`,
		path.join(CACHE_DIR, config.sourceSlug, '_sharh', `${sourceId}.json.gz`));
	const items = props.items || [];
	const authors = new Map();
	for (const item of items) {
		if (!authors.has(item.book_id)) authors.set(item.book_id, await sourceBookAuthor(page, item.book_id));
	}
	return dedupeSharhItems(items.map(item => ({
		sourceEntryId: Number(item.entry_id), sourceBookId: Number(item.book_id), title: compact(item.book),
		author: authors.get(item.book_id), chapter: compact(item.chapter) || null, page: Number(item.page_num) || null,
		text: sharhToMarkdown(item.content), format: 'md',
		sourceUrl: `${BASE_URL}/encyclopedia/book/${config.sourceSlug}/h/${sourceId}/service/6`
	})).filter(item => item.sourceEntryId && item.text));
}

function dedupeSharhItems(items) {
	const byEntry = new Map();
	for (const item of items) {
		const existing = byEntry.get(item.sourceEntryId);
		if (!existing || item.text.length > existing.text.length)
			byEntry.set(item.sourceEntryId, item);
	}
	return [...byEntry.values()];
}

async function sourceBookAuthor(page, bookId) {
	if (sourceBookAuthorCache.has(Number(bookId)))
		return sourceBookAuthorCache.get(Number(bookId));
	if (options.apply) {
		const connection = await getConnection();
		const stored = await query(connection,
			'SELECT author FROM hdith_sharh_sources WHERE source_book_id=? AND author IS NOT NULL LIMIT 1', [Number(bookId)]);
		if (stored[0]?.author) {
			sourceBookAuthorCache.set(Number(bookId), stored[0].author);
			return stored[0].author;
		}
	}
	const props = await fetchProps(page, `/encyclopedia/book/b-${bookId}`,
		path.join(CACHE_DIR, '_source-books', `b-${bookId}.json.gz`));
	const author = compact(props.book?.author) || null;
	sourceBookAuthorCache.set(Number(bookId), author);
	return author;
}

async function replaceSharh(connection, hadithId, items) {
	const existingEntries = new Map((await query(connection, 'SELECT source_entry_id, text_en, title, title_en FROM hdith_hadith_sharh WHERE hadith_id=?', [hadithId]))
		.map(row => [Number(row.source_entry_id), row]));
	await query(connection, `DELETE hs FROM hdith_hadith_sharh hs
		JOIN hdith_sharh_sources ss ON ss.id=hs.source_id
		WHERE hs.hadith_id=? AND ss.source_book_id>0`, [hadithId]);
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
			(hadith_id, source_id, source_entry_id, chapter, page_num, title, title_en, text, text_en, format, source_url)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON DUPLICATE KEY UPDATE source_id=VALUES(source_id), chapter=VALUES(chapter), page_num=VALUES(page_num), title=VALUES(title), title_en=VALUES(title_en),
				text=VALUES(text), text_en=VALUES(text_en), format=VALUES(format), source_url=VALUES(source_url)`,
		[hadithId, sourceId, item.sourceEntryId, item.chapter, item.page,
			existingEntries.get(Number(item.sourceEntryId))?.title || null, existingEntries.get(Number(item.sourceEntryId))?.title_en || null,
			item.text, existingEntries.get(Number(item.sourceEntryId))?.text_en || null, item.format, item.sourceUrl]);
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
	return Utils.normalizeArabicHonorifics(source.split(/\n\s*\n/).map(paragraph => paragraph.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n\n'))
		.replace(/[ \t]{2,}/g, ' ').trim();
}

async function fetchProps(page, pathname, compressedCacheFile = null) {
	if (!options.refresh && compressedCacheFile && fs.existsSync(compressedCacheFile))
		return JSON.parse(zlib.gunzipSync(fs.readFileSync(compressedCacheFile)).toString('utf8'));
	await wait(options.delay);
	const url = `${BASE_URL}${pathname}`;
	let html;
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
	const $ = cheerio.load(html);
	const json = $('script[data-page="app"][type="application/json"]').html();
	if (!json) throw new Error(`${url}: missing Inertia payload.`);
	const props = JSON.parse(json).props;
	if (props.hadith) props.hadith.narrator = parsePageNarrator($) || props.hadith.narrator || null;
	props.__verificationUrl = $('a[href^="/s?q="], a[href^="https://hdith.com/s?q="]').first().attr('href') || null;
	if (compressedCacheFile) {
		fs.mkdirSync(path.dirname(compressedCacheFile), { recursive: true });
		const temporaryFile = `${compressedCacheFile}.${process.pid}.tmp`;
		fs.writeFileSync(temporaryFile, zlib.gzipSync(JSON.stringify(props)));
		fs.renameSync(temporaryFile, compressedCacheFile);
	}
	return props;
}

function parsePageNarrator($) {
	let narrator = '';
	$('span').each(function () {
		if (narrator) return;
		const match = compact($(this).text()).match(/^(?:·\s*)?رواه\s+(.+)$/u);
		if (match) narrator = compact(match[1]);
	});
	return narrator || null;
}

async function ensureSchema() {
	const connection = await getConnection();
	for (const statement of schemaStatements()) await query(connection, statement);
	const bodyStartColumn = await query(connection, `SELECT 1 FROM information_schema.columns
		WHERE table_schema=DATABASE() AND table_name='hadiths' AND column_name='body_start' LIMIT 1`);
	const legacyTarfColumn = await query(connection, `SELECT 1 FROM information_schema.columns
		WHERE table_schema=DATABASE() AND table_name='hadiths' AND column_name='tarf' LIMIT 1`);
	if (legacyTarfColumn.length) {
		if (!bodyStartColumn.length)
			await query(connection, 'ALTER TABLE hadiths CHANGE COLUMN tarf body_start MEDIUMTEXT NULL');
		else {
			await query(connection, 'UPDATE hadiths SET body_start=tarf WHERE tarf IS NOT NULL AND NOT (body_start <=> tarf)');
			await query(connection, 'ALTER TABLE hadiths DROP COLUMN tarf');
		}
	}
	else if (!bodyStartColumn.length)
		await query(connection, 'ALTER TABLE hadiths ADD COLUMN body_start MEDIUMTEXT NULL AFTER body');
	const supplementaryColumn = await query(connection, `SELECT 1 FROM information_schema.columns
		WHERE table_schema=DATABASE() AND table_name='hadiths' AND column_name='hasSupplementaryTransmissions' LIMIT 1`);
	if (!supplementaryColumn.length)
		await query(connection, 'ALTER TABLE hadiths ADD COLUMN hasSupplementaryTransmissions TINYINT(1) NOT NULL DEFAULT 0 AFTER body_start');
	const crosswalkSupplementaryColumn = await query(connection, `SELECT 1 FROM information_schema.columns
		WHERE table_schema=DATABASE() AND table_name='hdith_book_reference_crosswalk' AND column_name='is_supplementary' LIMIT 1`);
	if (!crosswalkSupplementaryColumn.length)
		await query(connection, 'ALTER TABLE hdith_book_reference_crosswalk ADD COLUMN is_supplementary TINYINT(1) NOT NULL DEFAULT 0 AFTER similarity');
	const mappingModeColumn = await query(connection, `SELECT column_type FROM information_schema.columns
		WHERE table_schema=DATABASE() AND table_name='hdith_book_mappings' AND column_name='reference_mode' LIMIT 1`);
	if (mappingModeColumn[0] && !(mappingModeColumn[0].column_type || mappingModeColumn[0].COLUMN_TYPE).includes("'crosswalk'"))
		await query(connection, "ALTER TABLE hdith_book_mappings MODIFY reference_mode ENUM('exact','source-entry','crosswalk','unresolved') NOT NULL");
	await HadithAttributions.ensureSchema((sql, values) => query(connection, sql, values));
	const referenceColumn = await query(connection, `SELECT 1 FROM information_schema.columns
		WHERE table_schema=DATABASE() AND table_name='hdith_hadith_metadata' AND column_name='source_reference' LIMIT 1`);
	if (!referenceColumn.length)
		await query(connection, 'ALTER TABLE hdith_hadith_metadata ADD COLUMN source_reference VARCHAR(45) NULL AFTER source_entry_id');
	const editionReferenceColumn = await query(connection, `SELECT 1 FROM information_schema.columns
		WHERE table_schema=DATABASE() AND table_name='hdith_hadith_metadata' AND column_name='source_edition_reference' LIMIT 1`);
	if (!editionReferenceColumn.length)
		await query(connection, 'ALTER TABLE hdith_hadith_metadata ADD COLUMN source_edition_reference VARCHAR(45) NULL AFTER source_reference');
	const crosswalkEditionColumn = await query(connection, `SELECT 1 FROM information_schema.columns
		WHERE table_schema=DATABASE() AND table_name='hdith_book_reference_crosswalk' AND column_name='source_edition_num' LIMIT 1`);
	if (!crosswalkEditionColumn.length)
		await query(connection, 'ALTER TABLE hdith_book_reference_crosswalk ADD COLUMN source_edition_num VARCHAR(45) NULL AFTER source_num');
	const chainTypeColumn = await query(connection, `SELECT 1 FROM information_schema.columns
		WHERE table_schema=DATABASE() AND table_name='hdith_hadith_metadata' AND column_name='chain_type' LIMIT 1`);
	if (!chainTypeColumn.length)
		await query(connection, 'ALTER TABLE hdith_hadith_metadata ADD COLUMN chain_type VARCHAR(128) NULL AFTER attribution');
	const sourceIsnadColumn = await query(connection, `SELECT 1 FROM information_schema.columns
		WHERE table_schema=DATABASE() AND table_name='hdith_hadith_metadata' AND column_name='source_isnad_html' LIMIT 1`);
	if (!sourceIsnadColumn.length)
		await query(connection, 'ALTER TABLE hdith_hadith_metadata ADD COLUMN source_isnad_html MEDIUMTEXT NULL AFTER chain_type');
	const narratorColumn = await query(connection, `SELECT column_type FROM information_schema.columns
		WHERE table_schema=DATABASE() AND table_name='hdith_hadith_metadata' AND column_name='narrator' LIMIT 1`);
	if (!narratorColumn.length)
		await query(connection, 'ALTER TABLE hdith_hadith_metadata ADD COLUMN narrator TEXT NULL AFTER chain_type');
	else if (!/text/i.test(narratorColumn[0].column_type))
		await query(connection, 'ALTER TABLE hdith_hadith_metadata MODIFY narrator TEXT NULL');
	const narratorEnglishColumn = await query(connection, `SELECT column_type FROM information_schema.columns
		WHERE table_schema=DATABASE() AND table_name='hdith_hadith_metadata' AND column_name='narrator_en' LIMIT 1`);
	if (!narratorEnglishColumn.length)
		await query(connection, 'ALTER TABLE hdith_hadith_metadata ADD COLUMN narrator_en TEXT NULL AFTER narrator');
	else if (!/text/i.test(narratorEnglishColumn[0].column_type))
		await query(connection, 'ALTER TABLE hdith_hadith_metadata MODIFY narrator_en TEXT NULL');
	const narratorTashkilColumn = await query(connection, `SELECT 1 FROM information_schema.columns
		WHERE table_schema=DATABASE() AND table_name='hdith_narrators' AND column_name='name_tashkil' LIMIT 1`);
	if (!narratorTashkilColumn.length)
		await query(connection, 'ALTER TABLE hdith_narrators ADD COLUMN name_tashkil TEXT NULL AFTER name');
	const narratorAlaLcColumn = await query(connection, `SELECT 1 FROM information_schema.columns
		WHERE table_schema=DATABASE() AND table_name='hdith_narrators' AND column_name='name_ala_lc' LIMIT 1`);
	if (!narratorAlaLcColumn.length)
		await query(connection, 'ALTER TABLE hdith_narrators ADD COLUMN name_ala_lc TEXT NULL AFTER name_tashkil');
	const gharibColumn = await query(connection, `SELECT 1 FROM information_schema.columns
		WHERE table_schema=DATABASE() AND table_name='hdith_hadith_metadata' AND column_name='gharib_json' LIMIT 1`);
	if (!gharibColumn.length)
		await query(connection, 'ALTER TABLE hdith_hadith_metadata ADD COLUMN gharib_json JSON NULL AFTER chain_type');
	const gradeColorColumn = await query(connection, `SELECT 1 FROM information_schema.columns
		WHERE table_schema=DATABASE() AND table_name='hdith_hadith_grades' AND column_name='grade_color' LIMIT 1`);
	if (!gradeColorColumn.length)
		await query(connection, 'ALTER TABLE hdith_hadith_grades ADD COLUMN grade_color VARCHAR(40) NULL AFTER grade_category_id');
	const graderEnglishColumn = await query(connection, `SELECT 1 FROM information_schema.columns
		WHERE table_schema=DATABASE() AND table_name='hdith_hadith_grades' AND column_name='grader_en' LIMIT 1`);
	if (!graderEnglishColumn.length)
		await query(connection, 'ALTER TABLE hdith_hadith_grades ADD COLUMN grader_en VARCHAR(255) NULL AFTER grader');
	const gradeEnglishColumn = await query(connection, `SELECT 1 FROM information_schema.columns
		WHERE table_schema=DATABASE() AND table_name='hdith_hadith_grades' AND column_name='grade_en' LIMIT 1`);
	if (!gradeEnglishColumn.length)
		await query(connection, 'ALTER TABLE hdith_hadith_grades ADD COLUMN grade_en TEXT NULL AFTER grade');
	const sharhEnglishColumn = await query(connection, `SELECT 1 FROM information_schema.columns
		WHERE table_schema=DATABASE() AND table_name='hdith_hadith_sharh' AND column_name='text_en' LIMIT 1`);
	if (!sharhEnglishColumn.length)
		await query(connection, 'ALTER TABLE hdith_hadith_sharh ADD COLUMN text_en LONGTEXT NULL AFTER text');
	const sharhTitleColumn = await query(connection, `SELECT 1 FROM information_schema.columns
		WHERE table_schema=DATABASE() AND table_name='hdith_hadith_sharh' AND column_name='title' LIMIT 1`);
	if (!sharhTitleColumn.length)
		await query(connection, 'ALTER TABLE hdith_hadith_sharh ADD COLUMN title VARCHAR(255) NULL AFTER page_num');
	const sharhTitleEnglishColumn = await query(connection, `SELECT 1 FROM information_schema.columns
		WHERE table_schema=DATABASE() AND table_name='hdith_hadith_sharh' AND column_name='title_en' LIMIT 1`);
	if (!sharhTitleEnglishColumn.length)
		await query(connection, 'ALTER TABLE hdith_hadith_sharh ADD COLUMN title_en VARCHAR(255) NULL AFTER title');
	const linkBookTitleColumn = await query(connection, `SELECT 1 FROM information_schema.columns
		WHERE table_schema=DATABASE() AND table_name='hdith_hadith_links' AND column_name='source_book_title' LIMIT 1`);
	if (!linkBookTitleColumn.length)
		await query(connection, 'ALTER TABLE hdith_hadith_links ADD COLUMN source_book_title VARCHAR(255) NULL AFTER source_book_id');
	const linkBodyStartColumn = await query(connection, `SELECT 1 FROM information_schema.columns
		WHERE table_schema=DATABASE() AND table_name='hdith_hadith_links' AND column_name='source_body_start' LIMIT 1`);
	const legacySourceTarfColumn = await query(connection, `SELECT 1 FROM information_schema.columns
		WHERE table_schema=DATABASE() AND table_name='hdith_hadith_links' AND column_name='source_tarf' LIMIT 1`);
	if (legacySourceTarfColumn.length) {
		if (!linkBodyStartColumn.length)
			await query(connection, 'ALTER TABLE hdith_hadith_links CHANGE COLUMN source_tarf source_body_start MEDIUMTEXT NULL');
		else {
			await query(connection, 'UPDATE hdith_hadith_links SET source_body_start=source_tarf WHERE source_tarf IS NOT NULL AND NOT (source_body_start <=> source_tarf)');
			await query(connection, 'ALTER TABLE hdith_hadith_links DROP COLUMN source_tarf');
		}
	}
	else if (!linkBodyStartColumn.length)
		await query(connection, 'ALTER TABLE hdith_hadith_links ADD COLUMN source_body_start MEDIUMTEXT NULL AFTER label');
	const linkTypeColumn = await query(connection, `SELECT column_type FROM information_schema.columns
		WHERE table_schema=DATABASE() AND table_name='hdith_hadith_links' AND column_name='link_type' LIMIT 1`);
	if (linkTypeColumn[0] && !(linkTypeColumn[0].column_type || linkTypeColumn[0].COLUMN_TYPE).includes("'similar'"))
		await query(connection, "ALTER TABLE hdith_hadith_links MODIFY link_type ENUM('takhrij','shahid','similar') NOT NULL");
	const linkBookIndex = await query(connection, `SELECT 1 FROM information_schema.statistics
		WHERE table_schema=DATABASE() AND table_name='hdith_hadith_links' AND index_name='hdith_link_source_book' LIMIT 1`);
	if (!linkBookIndex.length)
		await query(connection, 'ALTER TABLE hdith_hadith_links ADD KEY hdith_link_source_book (source_book_id)');
	const linkSourceEntryIndex = await query(connection, `SELECT 1 FROM information_schema.statistics
		WHERE table_schema=DATABASE() AND table_name='hdith_hadith_links' AND index_name='hdith_link_source_entry' LIMIT 1`);
	if (!linkSourceEntryIndex.length)
		await query(connection, 'ALTER TABLE hdith_hadith_links ADD KEY hdith_link_source_entry (source_book_id, source_entry_id)');
	const crosswalkLocalIndex = await query(connection, `SELECT non_unique AS nonUnique FROM information_schema.statistics
		WHERE table_schema=DATABASE() AND table_name='hdith_book_reference_crosswalk'
			AND index_name='hdith_crosswalk_local' LIMIT 1`);
	if (crosswalkLocalIndex[0] && Number(crosswalkLocalIndex[0].nonUnique) === 0)
		await query(connection, `ALTER TABLE hdith_book_reference_crosswalk
			DROP INDEX hdith_crosswalk_local, ADD KEY hdith_crosswalk_local (source_book_id, local_hadith_id)`);
	const crosswalkSimilarity = await query(connection, `SELECT is_nullable AS isNullable FROM information_schema.columns
		WHERE table_schema=DATABASE() AND table_name='hdith_book_reference_crosswalk' AND column_name='similarity' LIMIT 1`);
	if (crosswalkSimilarity[0]?.isNullable === 'NO')
		await query(connection, 'ALTER TABLE hdith_book_reference_crosswalk MODIFY similarity DECIMAL(6,5) NULL');
	await seedHdithBookMappings(connection);
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
		`CREATE TABLE IF NOT EXISTS hdith_book_mappings (
			source_book_id INT NOT NULL PRIMARY KEY, source_book_title VARCHAR(255) NOT NULL,
			local_book_id INT NOT NULL, local_alias VARCHAR(45) NOT NULL,
			reference_mode ENUM('exact','source-entry','crosswalk','unresolved') NOT NULL,
			lastmod DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			UNIQUE KEY hdith_book_mapping_local (local_book_id),
			CONSTRAINT hdith_book_mapping_book_fk FOREIGN KEY (local_book_id) REFERENCES books(id) ON DELETE CASCADE ON UPDATE CASCADE
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
		`CREATE TABLE IF NOT EXISTS hdith_book_reference_crosswalk (
			source_book_id INT NOT NULL, source_entry_id INT NOT NULL, source_num VARCHAR(45) NULL, source_edition_num VARCHAR(45) NULL,
			local_hadith_id INT NOT NULL, local_ref VARCHAR(45) NOT NULL, similarity DECIMAL(6,5) NULL, is_supplementary TINYINT(1) NOT NULL DEFAULT 0,
			lastmod DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY (source_book_id, source_entry_id), KEY hdith_crosswalk_local (source_book_id, local_hadith_id),
			KEY hdith_crosswalk_hadith (local_hadith_id),
			CONSTRAINT hdith_crosswalk_hadith_fk FOREIGN KEY (local_hadith_id) REFERENCES hadiths(id) ON DELETE CASCADE ON UPDATE CASCADE
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
		`CREATE TABLE IF NOT EXISTS hdith_hadith_metadata (
			hadith_id INT NOT NULL PRIMARY KEY, source_book_slug VARCHAR(16) NOT NULL, source_entry_id INT NOT NULL,
			source_reference VARCHAR(45) NULL, source_edition_reference VARCHAR(45) NULL, attribution VARCHAR(64) NULL, chain_type VARCHAR(128) NULL, narrator TEXT NULL, narrator_en TEXT NULL, source_isnad_html MEDIUMTEXT NULL, gharib_json JSON NULL, takhrij_json JSON NULL, shawahid_json JSON NULL, source_checksum CHAR(64) NOT NULL,
			lastmod DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			UNIQUE KEY hdith_metadata_source (source_book_slug, source_entry_id),
			CONSTRAINT hdith_metadata_hadith_fk FOREIGN KEY (hadith_id) REFERENCES hadiths(id) ON DELETE CASCADE ON UPDATE CASCADE
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
		`CREATE TABLE IF NOT EXISTS hdith_narrators (
			id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, source_slug VARCHAR(32) NOT NULL, name VARCHAR(255) NOT NULL, name_tashkil TEXT NULL, name_ala_lc TEXT NULL,
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
			id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY, hadith_id INT NOT NULL, link_type ENUM('takhrij','shahid','similar') NOT NULL,
			source_book_id INT NOT NULL, source_book_title VARCHAR(255) NULL, source_entry_id INT NOT NULL, source_num VARCHAR(45) NULL, label VARCHAR(255) NULL, source_body_start MEDIUMTEXT NULL,
			internal_hadith_id INT NULL, internal_ref VARCHAR(96) NULL, source_url VARCHAR(512) NOT NULL,
			UNIQUE KEY hdith_link_source (hadith_id, link_type, source_entry_id), KEY hdith_link_internal (internal_hadith_id), KEY hdith_link_source_book (source_book_id),
			CONSTRAINT hdith_link_hadith_fk FOREIGN KEY (hadith_id) REFERENCES hadiths(id) ON DELETE CASCADE ON UPDATE CASCADE,
			CONSTRAINT hdith_link_internal_fk FOREIGN KEY (internal_hadith_id) REFERENCES hadiths(id) ON DELETE SET NULL ON UPDATE CASCADE
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
		`CREATE TABLE IF NOT EXISTS hdith_sharh_sources (
			id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, source_book_id INT NOT NULL, title VARCHAR(255) NOT NULL, title_en VARCHAR(255) NULL, author VARCHAR(255) NULL,
			source_url VARCHAR(512) NOT NULL, UNIQUE KEY hdith_sharh_book (source_book_id)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
		`CREATE TABLE IF NOT EXISTS hdith_hadith_sharh (
			id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY, hadith_id INT NOT NULL, source_id INT NOT NULL, source_entry_id INT NOT NULL,
			chapter VARCHAR(512) NULL, page_num INT NULL, title VARCHAR(255) NULL, title_en VARCHAR(255) NULL,
			text LONGTEXT NOT NULL, text_en LONGTEXT NULL, format VARCHAR(8) NOT NULL DEFAULT 'md', source_url VARCHAR(512) NOT NULL,
			UNIQUE KEY hdith_sharh_entry (hadith_id, source_entry_id), KEY hdith_sharh_source (source_id), FULLTEXT KEY hdith_sharh_text (text),
			CONSTRAINT hdith_sharh_hadith_fk FOREIGN KEY (hadith_id) REFERENCES hadiths(id) ON DELETE CASCADE ON UPDATE CASCADE,
			CONSTRAINT hdith_sharh_source_fk FOREIGN KEY (source_id) REFERENCES hdith_sharh_sources(id) ON DELETE CASCADE ON UPDATE CASCADE
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
		`CREATE TABLE IF NOT EXISTS hdith_hadith_grades (
			id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY, hadith_id INT NOT NULL, ordinal SMALLINT UNSIGNED NOT NULL,
			source_slug VARCHAR(32) NOT NULL, grader VARCHAR(255) NOT NULL, grader_en VARCHAR(255) NULL, grader_source_id INT NULL,
			grade TEXT NOT NULL, grade_en TEXT NULL, grade_category_id INT NULL, grade_color VARCHAR(40) NULL, source_name VARCHAR(255) NULL, source_id INT NULL,
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

function escapeHtml(value) {
	return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
	if (dbConnection.state === 'authenticated') return configureDatabaseSession(dbConnection);
	return new Promise((resolve, reject) => dbConnection.connect(err => err ? reject(err) : resolve(dbConnection)))
		.then(configureDatabaseSession);
}

async function configureDatabaseSession(connection) {
	if (!dbSessionConfigured) {
		await query(connection, 'SET SESSION innodb_lock_wait_timeout=20');
		dbSessionConfigured = true;
	}
	return connection;
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
	CACHE_DIR, FOLLOWUP_BOOKS, HDITH_GRADE_COLORS, HDITH_LOCAL_BOOKS, MIN_REQUEST_DELAY_MS, SIX_BOOKS, SUPPORTED_BOOKS, compressCachedRecord, createOrderedTextMatcher, dedupeSharhItems, fetchProps, firstHadithId, loadRecord, normalizeArabicForMatch, parseCollectionGrades, parseEditionReference, parseGharib, parseGraderOpinions, parseHadithPayload, parseLinks,
	correctLocalChainBodySplit, hadithPrefixSimilarity, hadithTextSimilarity, ignoresExternalGrades, isSourceNotFoundError, localHadithOrderClause, normalizeHadithForComparison, normalizedArabicTokensWithOffsets, parseNarrators, parsePageNarrator, parsePrimaryNarrator, parseSourceIsnadHtml, proposedBodyFootnoteSplit, proposedChainBodySplit, readOptions, referenceBase, referencesEquivalent,
	enrichSingleHadith, legacyGradeForOpinion, preferredColoredGradeOpinion, preferredLegacyOpinion, promoteColoredGradeForMissingLegacy, resolveLinkTarget, schemaStatements, sharhToMarkdown, sourceSlugForVerificationResult
};
