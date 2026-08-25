#!/usr/bin/env node
/* jslint node:true, esversion:9 */
'use strict';

require('dotenv').config();

const axios = require('axios');
const cheerio = require('cheerio');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const fs = require('fs');
const mysql = require('mysql');
const os = require('os');
const path = require('path');

const EXPECTED_SURAHS = 114;
const MIN_INTRODUCTION_LENGTH = 20;
const DEFAULT_ALIAS = 'en-maududi';
const DEFAULT_SOURCE_SLUG = 'maududi';
const DEFAULT_BASE_URL = 'https://www.alim.org/quran/tafsir/maududi/surah';

async function run(argv = process.argv.slice(2)) {
	const options = readOptions(argv);
	if (!options)
		return null;
	const introductions = await loadSource(options);
	const db = await connectDb();
	let result;
	try {
		result = await importIntroductions(db, options, introductions);
	} finally {
		await closeDb(db);
	}
	if (!options.dryRun && options.buildIndex && result.changed) {
		console.log(`Rebuilding the toc index for '${options.alias}' (book ${result.bookId})...`);
		execFileSync(process.execPath, [
			path.resolve(__dirname, '../buildSearchIndex.js'),
			'--book-id', String(result.bookId),
			'--toc-only'
		], { stdio: 'inherit', env: process.env });
	}
	return result;
}

async function loadSource(options) {
	const document = options.refresh ? emptyCache(options) : readCache(options);
	const missing = [];
	for (let surah = 1; surah <= EXPECTED_SURAHS; surah++) {
		if (!validCachedIntroduction(document.surahs[surah], surah, options.baseUrl))
			missing.push(surah);
	}
	if (missing.length) {
		console.log(`Downloading ${missing.length} Alim ${options.sourceName} surah introduction page(s) with concurrency ${Math.min(options.concurrency, missing.length)}...`);
		let next = 0;
		let completed = 0;
		const workers = Array.from({ length: Math.min(options.concurrency, missing.length) }, async () => {
			while (next < missing.length) {
				const surah = missing[next++];
				const url = introductionUrl(options.baseUrl, surah);
				const html = await fetchPage(url, options);
				document.surahs[surah] = parseIntroductionPage(html, surah, url);
				document.fetchedAt = new Date().toISOString();
				writeCache(options.cacheFile, document);
				completed++;
				if (completed % 10 === 0 || completed === missing.length)
					console.log(`Downloaded ${completed}/${missing.length} missing introduction page(s)...`);
				if (options.delay)
					await sleep(options.delay);
			}
		});
		await Promise.all(workers);
	} else {
		console.log(`Using cached Alim ${options.sourceName} introductions: ${displayPath(options.cacheFile)}`);
	}
	const introductions = Object.values(document.surahs).sort((a, b) => a.surah - b.surah);
	validateSource(introductions, options.baseUrl, options.sourceName);
	console.log(`Validated ${introductions.length} ${options.sourceName} surah introductions from Alim.`);
	return introductions;
}

function emptyCache(options) {
	return { schemaVersion: 1, source: options.baseUrl, fetchedAt: null, surahs: {} };
}

function readCache(options) {
	if (!fs.existsSync(options.cacheFile))
		return emptyCache(options);
	try {
		const document = JSON.parse(fs.readFileSync(options.cacheFile, 'utf8'));
		if (document && document.schemaVersion === 1 && document.source === options.baseUrl &&
				document.surahs && typeof document.surahs === 'object' && !Array.isArray(document.surahs))
			return document;
		console.warn(`Ignoring incompatible Alim cache: ${displayPath(options.cacheFile)}`);
	} catch (err) {
		console.warn(`Ignoring unreadable Alim cache ${displayPath(options.cacheFile)}: ${err.message}`);
	}
	return emptyCache(options);
}

function writeCache(filename, document) {
	fs.mkdirSync(path.dirname(filename), { recursive: true });
	const temporary = `${filename}.${process.pid}.tmp`;
	fs.writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`);
	fs.renameSync(temporary, filename);
}

async function fetchPage(url, options) {
	let lastError;
	for (let attempt = 1; attempt <= options.retries + 1; attempt++) {
		try {
			const response = await axios.get(url, {
				headers: {
					'Accept': 'text/html,application/xhtml+xml',
					'Accept-Language': 'en-US,en;q=0.9',
					'User-Agent': 'Mozilla/5.0 (compatible; HadithDB Alim tafsir introduction importer)'
				},
				maxRedirects: 5,
				timeout: options.timeout,
				responseType: 'text',
				validateStatus: status => status === 200
			});
			return response.data;
		} catch (err) {
			lastError = err;
			if (attempt <= options.retries)
				await sleep(options.retryDelay * attempt);
		}
	}
	throw new Error(`${url}: ${describeAxiosError(lastError)}`);
}

function parseIntroductionPage(html, surah, url = introductionUrl(DEFAULT_BASE_URL, surah)) {
	const $ = cheerio.load(html);
	const canonical = $('link[rel="canonical"]').attr('href');
	if (canonical && normalizeUrl(canonical) !== normalizeUrl(url))
		throw new Error(`Surah ${surah}: canonical URL '${canonical}' did not match '${url}'.`);
	const title = normalizeSpace($('title').first().text());
	if (title && !new RegExp(`(?:^|\\s)${surah}:0(?:\\s|$)`).test(title))
		throw new Error(`Surah ${surah}: source title did not identify ayah 0.`);
	const containers = $('.tafsirContent');
	const notes = $('.tafsirContent note');
	if (containers.length !== 1 || notes.length > 1)
		throw new Error(`Surah ${surah}: expected one .tafsirContent container and at most one note, found ${containers.length} and ${notes.length}.`);
	const content = (notes.length === 1 ? notes.first() : containers.first()).clone();
	content.find('script, style, noscript').remove();
	const intro = escapeUnescapedMarkdownBackticks(normalizeMarkdown(markdownChildren($, content[0])));
	const sourceText = normalizeSpace(content.text());
	if (sourceText.length < MIN_INTRODUCTION_LENGTH || intro.length < MIN_INTRODUCTION_LENGTH)
		throw new Error(`Surah ${surah}: introduction was unexpectedly short.`);
	return {
		surah,
		url,
		intro_en: intro,
		sourceTextLength: sourceText.length,
		sha256: crypto.createHash('sha256').update(intro).digest('hex')
	};
}

function markdownChildren($, element) {
	return $(element).contents().map((index, node) => markdownNode($, node)).get().join('');
}

function markdownNode($, node) {
	if (node.type === 'text')
		return escapeMarkdownText(String(node.data || '').replace(/\s+/g, ' '));
	if (node.type !== 'tag')
		return '';
	const tag = String(node.name || '').toLowerCase();
	if (tag === 'br')
		return '  \n';
	if (tag === 'hr')
		return '\n\n---\n\n';
	if (/^h[1-6]$/.test(tag)) {
		const level = Math.max(2, Number(tag.slice(1)));
		return `\n\n${'#'.repeat(level)} ${normalizeInline(markdownChildren($, node))}\n\n`;
	}
	if (tag === 'div' && $(node).hasClass('title'))
		return `\n\n## ${normalizeInline(markdownChildren($, node))}\n\n`;
	if (tag === 'div' && $(node).hasClass('arabic_text_style'))
		return `\n\n${normalizeInline(markdownChildren($, node))}\n\n`;
	if (tag === 'p')
		return `\n\n${normalizeInline(markdownChildren($, node))}\n\n`;
	if (tag === 'strong' || tag === 'b')
		return wrapInline('**', markdownChildren($, node));
	if (tag === 'em' || tag === 'i')
		return wrapInline('*', markdownChildren($, node));
	if (tag === 'blockquote')
		return `\n\n${prefixLines(normalizeMarkdown(markdownChildren($, node)), '> ')}\n\n`;
	if (tag === 'ul' || tag === 'ol')
		return renderList($, node, tag === 'ol');
	if (tag === 'li')
		return normalizeMarkdown(markdownChildren($, node));
	if (tag === 'a') {
		const label = normalizeInline(markdownChildren($, node));
		const href = $(node).attr('href');
		if (!label || !href || /^javascript:/i.test(href))
			return label;
		return `[${label}](${new URL(href, 'https://www.alim.org').href})`;
	}
	return markdownChildren($, node);
}

function renderList($, element, ordered) {
	const items = $(element).children('li').map((index, item) => {
		const value = normalizeMarkdown(markdownChildren($, item));
		const marker = ordered ? `${index + 1}. ` : '- ';
		return marker + value.split('\n').map((line, lineIndex) => lineIndex ? `   ${line}` : line).join('\n');
	}).get();
	return items.length ? `\n\n${items.join('\n')}\n\n` : '';
}

function wrapInline(marker, value) {
	value = normalizeInline(value);
	return value ? `${marker}${value}${marker}` : '';
}

function prefixLines(value, prefix) {
	return value.split('\n').map(line => line ? `${prefix}${line}` : prefix.trimEnd()).join('\n');
}

function escapeMarkdownText(value) {
	return value.replace(/([\\`*_[\]])/g, '\\$1');
}

function escapeUnescapedMarkdownBackticks(value) {
	let backslashes = 0;
	let escaped = '';
	for (const character of String(value || '')) {
		if (character === '`' && backslashes % 2 === 0)
			escaped += '\\';
		escaped += character;
		backslashes = character === '\\' ? backslashes + 1 : 0;
	}
	return escaped;
}

function hasUnescapedMarkdownBackticks(value) {
	return escapeUnescapedMarkdownBackticks(value) !== String(value || '');
}

function normalizeInline(value) {
	return String(value || '')
		.replace(/[ \t]*\n[ \t]*/g, ' ')
		.replace(/[ \t]{2,}/g, ' ')
		.trim();
}

function normalizeMarkdown(value) {
	return String(value || '')
		.replace(/\r\n?/g, '\n')
		.replace(/[ \t]+\n/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

function validateSource(introductions, baseUrl = DEFAULT_BASE_URL, sourceName = 'Maududi') {
	if (!Array.isArray(introductions) || introductions.length !== EXPECTED_SURAHS)
		throw new Error(`Expected ${EXPECTED_SURAHS} ${sourceName} introductions, found ${introductions ? introductions.length : 0}.`);
	const seen = new Set();
	for (const introduction of introductions) {
		const surah = Number(introduction.surah);
		if (!Number.isInteger(surah) || surah < 1 || surah > EXPECTED_SURAHS || seen.has(surah))
			throw new Error(`Invalid or duplicate ${sourceName} introduction surah '${introduction.surah}'.`);
		seen.add(surah);
		if (hasUnescapedMarkdownBackticks(introduction.intro_en))
			throw new Error(`Cached ${sourceName} introduction for surah ${surah} contains unescaped backticks.`);
		if (!validCachedIntroductionShape(introduction, surah, baseUrl))
			throw new Error(`Incomplete cached ${sourceName} introduction for surah ${surah}.`);
		if (crypto.createHash('sha256').update(introduction.intro_en).digest('hex') !== introduction.sha256)
			throw new Error(`Cached ${sourceName} introduction checksum mismatch for surah ${surah}.`);
	}
}

function validCachedIntroduction(value, surah, baseUrl) {
	return validCachedIntroductionShape(value, surah, baseUrl) &&
		crypto.createHash('sha256').update(value.intro_en).digest('hex') === value.sha256;
}

function validCachedIntroductionShape(value, surah, baseUrl) {
	return Boolean(value && Number(value.surah) === Number(surah) &&
		value.url === introductionUrl(baseUrl, surah) &&
		typeof value.intro_en === 'string' && value.intro_en.length >= MIN_INTRODUCTION_LENGTH &&
		!hasUnescapedMarkdownBackticks(value.intro_en) &&
		Number(value.sourceTextLength) >= MIN_INTRODUCTION_LENGTH && /^[a-f0-9]{64}$/.test(value.sha256 || ''));
}

async function importIntroductions(db, options, introductions) {
	const books = await query(db, `SELECT * FROM books WHERE alias=${mysql.escape(options.alias)} LIMIT 2`);
	if (books.length !== 1)
		throw new Error(`Expected one book with alias '${options.alias}', found ${books.length}.`);
	const book = books[0];
	if (book.type !== 'tafsir' || book.source !== 'local' || !String(book.lang || '').split('-').includes('en'))
		throw new Error(`Alias '${options.alias}' is not a local English tafsir.`);
	const existing = await loadSurahHeadings(db, book.id);
	const changes = countChanges(existing, introductions, options.alias);
	console.log(`${options.dryRun ? 'Would apply' : 'Applying'} ${changes.inserts} heading insert(s), ${changes.updates} introduction update(s), and ${changes.unchanged} unchanged introduction(s) to '${options.alias}'.`);
	if (options.dryRun)
		return { changed: changes.inserts > 0 || changes.updates > 0, bookId: Number(book.id), ...changes };

	let lockHeld = false;
	try {
		const lock = await query(db, `SELECT GET_LOCK(${mysql.escape(options.lockName)}, 30) AS acquired`);
		if (!lock[0] || Number(lock[0].acquired) !== 1)
			throw new Error(`Could not acquire the '${options.alias}' introduction import lock.`);
		lockHeld = true;
		await query(db, 'START TRANSACTION');
		try {
			await query(db, `SELECT id FROM books WHERE id=${Number(book.id)} FOR UPDATE`);
			await upsertIntroductions(db, book.id, introductions, options);
			await verifyImportedIntroductions(db, book.id, introductions, options.alias);
			await query(db, `UPDATE books SET content_lastmod=CURRENT_TIMESTAMP() WHERE id=${Number(book.id)}`);
			await query(db, 'COMMIT');
		} catch (err) {
			await query(db, 'ROLLBACK');
			throw err;
		}
	} finally {
		if (lockHeld)
			await query(db, `SELECT RELEASE_LOCK(${mysql.escape(options.lockName)})`);
	}
	console.log(`Imported and verified all ${EXPECTED_SURAHS} '${options.alias}' toc.intro_en values.`);
	return { changed: changes.inserts > 0 || changes.updates > 0, bookId: Number(book.id), ...changes };
}

async function loadSurahHeadings(db, bookId, forUpdate = false) {
	return query(db, `
		SELECT id, h1, intro_en
		FROM toc
		WHERE bookId=${Number(bookId)} AND level=1 AND h1 BETWEEN 1 AND ${EXPECTED_SURAHS}
		ORDER BY h1, id${forUpdate ? ' FOR UPDATE' : ''}`);
}

function headingsBySurah(rows, alias) {
	const bySurah = new Map();
	for (const row of rows) {
		const surah = Number(row.h1);
		if (bySurah.has(surah))
			throw new Error(`Existing '${alias}' toc has duplicate surah ${surah} H1 headings.`);
		bySurah.set(surah, row);
	}
	return bySurah;
}

function countChanges(existing, introductions, alias = DEFAULT_ALIAS) {
	const bySurah = headingsBySurah(existing, alias);
	let inserts = 0;
	let updates = 0;
	let unchanged = 0;
	for (const introduction of introductions) {
		const heading = bySurah.get(Number(introduction.surah));
		if (!heading)
			inserts++;
		else if (String(heading.intro_en || '') !== introduction.intro_en)
			updates++;
		else
			unchanged++;
	}
	return { inserts, updates, unchanged };
}

async function loadQuranSurahMetadata(db) {
	const rows = await query(db, `
		SELECT h1, title_en, title
		FROM toc
		WHERE bookId=0 AND level=1 AND h1 BETWEEN 1 AND ${EXPECTED_SURAHS}
		ORDER BY h1, id`);
	const bySurah = headingsBySurah(rows, 'quran');
	if (bySurah.size !== EXPECTED_SURAHS)
		throw new Error(`Expected ${EXPECTED_SURAHS} Quran H1 headings, found ${bySurah.size}.`);
	return bySurah;
}

async function upsertIntroductions(db, bookId, introductions, options) {
	const existing = await loadSurahHeadings(db, bookId, true);
	const bySurah = headingsBySurah(existing, options.alias);
	const metadata = await loadQuranSurahMetadata(db);
	for (const introduction of introductions) {
		const surah = Number(introduction.surah);
		const heading = bySurah.get(surah);
		if (heading) {
			if (String(heading.intro_en || '') !== introduction.intro_en) {
				await query(db, `UPDATE toc SET intro_en=${mysql.escape(introduction.intro_en)},
					lastmod_user=${mysql.escape(options.importUser)}, lastfixed=CURRENT_TIMESTAMP()
					WHERE id=${Number(heading.id)}`);
			}
			continue;
		}
		const source = metadata.get(surah);
		await query(db, `INSERT INTO toc
			(ordinal, bookId, level, h1, h2, h3, title_en, title, intro_en, intro, lastmod_user, lastfixed)
			VALUES (${surah * 1000}, ${Number(bookId)}, 1, ${surah}, NULL, NULL,
				${mysql.escape(source.title_en)}, ${mysql.escape(source.title)}, ${mysql.escape(introduction.intro_en)}, '',
				${mysql.escape(options.importUser)}, CURRENT_TIMESTAMP())`);
	}
}

async function verifyImportedIntroductions(db, bookId, introductions, alias) {
	const headings = await loadSurahHeadings(db, bookId);
	if (headings.length !== EXPECTED_SURAHS)
		throw new Error(`Expected ${EXPECTED_SURAHS} '${alias}' H1 headings, found ${headings.length}.`);
	const changes = countChanges(headings, introductions, alias);
	if (changes.inserts || changes.updates || changes.unchanged !== EXPECTED_SURAHS)
		throw new Error(`Imported '${alias}' introductions did not exactly match the Alim source cache.`);
}

function readOptions(argv) {
	const options = {
		alias: DEFAULT_ALIAS,
		sourceSlug: DEFAULT_SOURCE_SLUG,
		baseUrl: DEFAULT_BASE_URL,
		cacheFile: null,
		concurrency: 6,
		timeout: 30000,
		retries: 3,
		retryDelay: 1000,
		delay: 100,
		refresh: false,
		dryRun: true,
		buildIndex: true
	};
	let baseUrlExplicit = false;
	let cacheFileExplicit = false;
	let sourceSlugExplicit = false;
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		if (arg === '--alias') options.alias = requiredValue(argv, ++index, arg);
		else if (arg === '--source-slug') {
			options.sourceSlug = requiredValue(argv, ++index, arg);
			sourceSlugExplicit = true;
		} else if (arg === '--base-url') {
			options.baseUrl = requiredValue(argv, ++index, arg).replace(/\/+$/, '');
			baseUrlExplicit = true;
		} else if (arg === '--cache-file') {
			options.cacheFile = path.resolve(process.cwd(), requiredValue(argv, ++index, arg));
			cacheFileExplicit = true;
		}
		else if (arg === '--concurrency') options.concurrency = positiveInteger(requiredValue(argv, ++index, arg), arg);
		else if (arg === '--timeout') options.timeout = positiveInteger(requiredValue(argv, ++index, arg), arg);
		else if (arg === '--retries') options.retries = nonNegativeInteger(requiredValue(argv, ++index, arg), arg);
		else if (arg === '--retry-delay') options.retryDelay = nonNegativeInteger(requiredValue(argv, ++index, arg), arg);
		else if (arg === '--delay') options.delay = nonNegativeInteger(requiredValue(argv, ++index, arg), arg);
		else if (arg === '--refresh') options.refresh = true;
		else if (arg === '--apply') options.dryRun = false;
		else if (arg === '--dry-run') options.dryRun = true;
		else if (arg === '--no-index') options.buildIndex = false;
		else if (arg === '--help' || arg === '-h') {
			console.log(usage());
			return null;
		} else throw new Error(`Unknown option '${arg}'.\n\n${usage()}`);
	}
	if (!/^[A-Za-z0-9_-]+$/.test(options.alias))
		throw new Error(`--alias must be URL-safe.\n\n${usage()}`);
	if (!/^[a-z0-9-]+$/.test(options.sourceSlug))
		throw new Error(`--source-slug must contain lowercase letters, numbers, and hyphens only.\n\n${usage()}`);
	if (sourceSlugExplicit && !baseUrlExplicit)
		options.baseUrl = `https://www.alim.org/quran/tafsir/${options.sourceSlug}/surah`;
	if (!/^https?:\/\//.test(options.baseUrl))
		throw new Error(`--base-url must be an HTTP URL.\n\n${usage()}`);
	const detectedSourceSlug = sourceSlugFromBaseUrl(options.baseUrl);
	if (!sourceSlugExplicit)
		options.sourceSlug = detectedSourceSlug;
	else if (detectedSourceSlug !== options.sourceSlug)
		throw new Error(`--source-slug '${options.sourceSlug}' did not match --base-url source '${detectedSourceSlug}'.`);
	if (!cacheFileExplicit)
		options.cacheFile = path.resolve(__dirname, `../../data/tafsir/alim-${options.sourceSlug}-introductions.json`);
	options.sourceName = sourceDisplayName(options.sourceSlug);
	options.importUser = `import-alim-${options.sourceSlug}-intros`;
	options.lockName = `hadithdb:import-alim:${options.alias}:intros`;
	return options;
}

function usage() {
	return [
		'Usage: node bin/utils/import-alim-tafsir-introductions.js --alias <alias> --source-slug <slug> [options]',
		'',
		'Downloads and validates all 114 tafsir surah introduction pages from Alim,',
		'converts their structured HTML to Markdown, and imports each value into the',
		"matching local tafsir's toc.intro_en. The default mode is a read-only DB dry run.",
		'',
		'Options:',
		`  --alias <alias>          Tafsir alias (default: ${DEFAULT_ALIAS})`,
		`  --source-slug <slug>     Alim tafsir URL slug (default: ${DEFAULT_SOURCE_SLUG})`,
		'  --base-url <url>          Override the Alim source base URL',
		'  --apply                  Import, verify, and rebuild this book in the toc index',
		'  --dry-run                Validate source and report DB changes only (default)',
		'  --refresh                Download every source page again',
		'  --no-index               Skip the targeted toc index rebuild after --apply',
		'  --cache-file <json>       Override the ignored local source cache path',
		'  --concurrency <number>    Concurrent downloads (default: 6)',
		'  --delay <ms>              Delay after each request (default: 100)',
		'  --help                    Show this help'
	].join('\n');
}

function introductionUrl(baseUrl, surah) {
	return `${String(baseUrl).replace(/\/+$/, '')}/${Number(surah)}/0/`;
}

function sourceSlugFromBaseUrl(baseUrl) {
	const match = /\/quran\/tafsir\/([a-z0-9-]+)\/surah\/?$/i.exec(new URL(baseUrl).pathname);
	if (!match)
		throw new Error(`Could not determine the Alim tafsir source slug from '${baseUrl}'.`);
	return match[1].toLowerCase();
}

function sourceDisplayName(slug) {
	return String(slug).split('-').map(word => word ? word[0].toUpperCase() + word.slice(1) : '').join(' ');
}

function normalizeUrl(value) {
	return String(value || '').replace(/\/+$/, '');
}

function normalizeSpace(value) {
	return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function requiredValue(argv, index, option) {
	if (!argv[index] || argv[index].startsWith('--'))
		throw new Error(`${option} requires a value.`);
	return argv[index];
}

function positiveInteger(value, option) {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1)
		throw new Error(`${option} must be a positive integer.`);
	return parsed;
}

function nonNegativeInteger(value, option) {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 0)
		throw new Error(`${option} must be a non-negative integer.`);
	return parsed;
}

function connectDb() {
	const settings = require(path.join(os.homedir(), '.hadithdb', 'settings.json'));
	const db = mysql.createConnection(settings.mysql.connection);
	return new Promise((resolve, reject) => db.connect(err => err ? reject(err) : resolve(db)));
}

function query(db, sql) {
	return new Promise((resolve, reject) => db.query({ sql, timeout: 600000 }, (err, result) => err ? reject(err) : resolve(result)));
}

function closeDb(db) {
	return new Promise((resolve, reject) => db.end(err => err ? reject(err) : resolve()));
}

function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function displayPath(filename) {
	const relative = path.relative(process.cwd(), filename);
	return relative && !relative.startsWith('..') ? relative : filename;
}

function describeAxiosError(err) {
	if (!err)
		return 'unknown HTTP error';
	if (err.response)
		return `HTTP ${err.response.status}`;
	return err.message;
}

if (require.main === module) {
	run().catch(err => {
		console.error(`ERROR: ${err.stack || err.message}`);
		process.exitCode = 1;
	});
}

module.exports = {
	closeDb,
	connectDb,
	countChanges,
	escapeUnescapedMarkdownBackticks,
	importIntroductions,
	introductionUrl,
	markdownChildren,
	normalizeMarkdown,
	parseIntroductionPage,
	readOptions,
	run,
	validateSource
};
