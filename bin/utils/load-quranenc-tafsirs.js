#!/usr/bin/env node
/* jslint node:true, esversion:9 */
'use strict';

require('dotenv').config();
require('../../lib/Globals');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const MySQL = require('mysql');

const API_BASE = 'https://quranenc.com/api/v1/translation/sura';
const CACHE_DIR = path.resolve(__dirname, '../../data/tafsir/quranenc');
const DEFAULT_BATCH_SIZE = 250;

const SOURCES = {
	english_saheeh: {
		alias: 'en-quranenc-saheeh',
		ordinal: 94,
		lang: 'en',
		shortName_en: 'Saheeh International',
		shortName: 'صحيح إنترناشونال',
		name_en: 'Saheeh International Translation',
		name: 'ترجمة صحيح إنترناشونال',
		author_en: 'Saheeh International',
		author: 'صحيح إنترناشونال',
		description: 'QuranEnc English translation by Saheeh International.',
		aqidah: 'Translation'
	},
	english_rwwad: {
		alias: 'en-quranenc-rwwad',
		ordinal: 95,
		lang: 'en',
		shortName_en: 'Rwwad',
		shortName: 'رُوَّاد',
		name_en: 'Rwwad Translation',
		name: 'ترجمة رواد',
		author_en: 'Rwwad Translation Center',
		author: 'مركز رواد الترجمة',
		description: 'QuranEnc English translation from Rwwad Translation Center.',
		aqidah: 'Translation'
	},
	english_hilali_khan: {
		alias: 'en-quranenc-hilali-khan',
		ordinal: 96,
		lang: 'en',
		shortName_en: 'Hilali-Khan',
		shortName: 'الهلالي وخان',
		name_en: 'Hilali-Khan Translation',
		name: 'ترجمة الهلالي وخان',
		author_en: 'Muhammad Taqi-ud-Din al-Hilali and Muhammad Muhsin Khan',
		author: 'محمد تقي الدين الهلالي ومحمد محسن خان',
		description: 'QuranEnc English translation by Muhammad Taqi-ud-Din al-Hilali and Muhammad Muhsin Khan.',
		aqidah: 'Translation'
	},
	arabic_nafahat: {
		alias: 'ar-quranenc-nafahat',
		ordinal: 97,
		lang: 'ar',
		shortName_en: 'Nafahat',
		shortName: 'نَفَحَات',
		name_en: 'Nafahat min Tafsir al-Quran al-Karim',
		name: 'نَفَحَاتٌ مِنْ تَفْسِيرِ القُرْآنِ الكَرِيمِ',
		author_en: 'Tafsir Center for Quranic Studies',
		author: 'مَرْكَزُ تَفْسِيرٍ لِلدِّرَاسَاتِ القُرْآنِيَّةِ',
		description: 'QuranEnc Arabic tafsir Nafahat min Tafsir al-Quran al-Karim.',
		aqidah: 'Contemporary Sunni'
	},
	arabic_yaseer: {
		alias: 'ar-quranenc-yaseer',
		ordinal: 98,
		lang: 'ar',
		shortName_en: 'Yaseer',
		shortName: 'اليَسِير',
		name_en: 'al-Tafsir al-Yaseer',
		name: 'التَّفْسِيرُ اليَسِير',
		author_en: 'Tafsir Center for Quranic Studies',
		author: 'مَرْكَزُ تَفْسِيرٍ لِلدِّرَاسَاتِ القُرْآنِيَّةِ',
		description: 'QuranEnc Arabic tafsir al-Tafsir al-Yaseer.',
		aqidah: 'Contemporary Sunni'
	},
	arabic_seraj: {
		alias: 'ar-quranenc-seraj',
		ordinal: 99,
		lang: 'ar',
		shortName_en: 'Seraj',
		shortName: 'السِّرَاج',
		name_en: 'al-Seraj fi Bayan Gharib al-Quran',
		name: 'السِّرَاجُ فِي بَيَانِ غَرِيبِ القُرْآنِ',
		author_en: 'Tafsir Center for Quranic Studies',
		author: 'مَرْكَزُ تَفْسِيرٍ لِلدِّرَاسَاتِ القُرْآنِيَّةِ',
		description: 'QuranEnc Arabic glossary tafsir al-Seraj fi Bayan Gharib al-Quran.',
		aqidah: 'Contemporary Sunni'
	}
};

const options = readOptions(process.argv.slice(2));

(async () => {
	try {
		ensureDirectory(CACHE_DIR);
		const quran = await loadQuranAyahs();
		for (const sourceKey of options.sources) {
			const config = SOURCES[sourceKey];
			const document = await loadOrDownloadSource(sourceKey);
			const passages = buildPassages(sourceKey, config, document, quran);
			if (options.dryRun) {
				reportDryRun(config, passages);
				continue;
			}
			const bookId = await upsertCommentary(config);
			await upsertPassages(bookId, config, passages);
			console.log(`Loaded ${passages.length} '${config.alias}' passage(s).`);
		}
	} catch (err) {
		console.error(`ERROR: ${err.message}`);
		process.exitCode = 1;
	} finally {
		global.dbPool.end();
	}
})();

async function loadOrDownloadSource(sourceKey) {
	const cacheFile = path.join(CACHE_DIR, `${sourceKey}.json`);
	const document = readCache(cacheFile);
	const missing = [];
	for (let surah = 1; surah <= 114; surah++) {
		if (!Array.isArray(document[surah]) || document[surah].length < 1)
			missing.push(surah);
	}
	if (missing.length < 1) {
		console.log(`Using cached QuranEnc '${sourceKey}' source: ${cacheFile}`);
		return document;
	}
	console.log(`Downloading ${missing.length} QuranEnc '${sourceKey}' surah(s)...`);
	let completed = 0;
	let next = 0;
	const workers = [];
	const workerCount = Math.min(options.concurrency, missing.length);
	for (let i = 0; i < workerCount; i++) {
		workers.push((async () => {
			while (next < missing.length) {
				const surah = missing[next++];
				document[surah] = await fetchSurah(sourceKey, surah);
				completed++;
				if (completed % options.saveEvery === 0 || completed === missing.length) {
					writeCache(cacheFile, document);
					console.log(`Downloaded ${completed}/${missing.length} QuranEnc '${sourceKey}' surah(s)...`);
				}
				if (options.delay)
					await sleep(options.delay);
			}
		})());
	}
	await Promise.all(workers);
	writeCache(cacheFile, document);
	return document;
}

async function fetchSurah(sourceKey, surah) {
	let lastError;
	for (let attempt = 1; attempt <= options.retries + 1; attempt++) {
		try {
			const response = await axios.get(`${API_BASE}/${sourceKey}/${surah}`, { timeout: options.timeout });
			const result = response.data?.result;
			if (!Array.isArray(result))
				throw new Error('API response did not contain a result array.');
			return result;
		} catch (err) {
			lastError = err;
			if (attempt <= options.retries)
				await sleep(options.retryDelay);
		}
	}
	throw new Error(`${sourceKey} surah ${surah}: ${describeAxiosError(lastError)}`);
}

function readCache(cacheFile) {
	if (!fs.existsSync(cacheFile))
		return {};
	const document = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
	if (!document || Array.isArray(document) || typeof document !== 'object')
		throw new Error(`${cacheFile} must contain a surah-keyed object.`);
	return document;
}

function writeCache(cacheFile, document) {
	const sorted = {};
	Object.keys(document).sort((a, b) => Number(a) - Number(b)).forEach(key => {
		sorted[key] = document[key];
	});
	fs.writeFileSync(cacheFile, `${JSON.stringify(sorted, null, 2)}\n`);
}

function buildPassages(sourceKey, config, document, quran) {
	const quranByRef = new Map(quran.map(row => [row.ref, row]));
	const passages = [];
	for (let surah = 1; surah <= 114; surah++) {
		const rows = document[surah];
		if (!Array.isArray(rows))
			throw new Error(`QuranEnc '${sourceKey}' is missing surah ${surah}.`);
		for (const row of rows) {
			const ref = `${Number(row.sura)}:${Number(row.aya)}`;
			const ayah = quranByRef.get(ref);
			if (!ayah)
				throw new Error(`QuranEnc '${sourceKey}' returned unknown Quran ref '${ref}'.`);
			const text = toMarkdownText(row.translation);
			const footnotes = toMarkdownFootnotes(row.footnotes);
			passages.push({
				hadithId: ayah.id,
				surah: ayah.surah,
				ayah: ayah.ayah,
				text: config.lang === 'ar' ? text : null,
				text_en: config.lang === 'en' ? text : null,
				footnotes: config.lang === 'ar' ? footnotes : null,
				footnotes_en: config.lang === 'en' ? footnotes : null
			});
		}
	}
	if (passages.length !== quran.length)
		throw new Error(`Expected ${quran.length} QuranEnc '${sourceKey}' passages, found ${passages.length}.`);
	return passages.sort((a, b) => a.surah - b.surah || a.ayah - b.ayah);
}

async function upsertCommentary(config) {
	await global.query(`
		INSERT INTO books
			(ordinal, alias, type, shortName_en, shortName, hidden, source, lang, format, name_en, author_en, title, author, death, description, aqidah)
		VALUES
			(${config.ordinal}, ${MySQL.escape(config.alias)}, 'tafsir', ${MySQL.escape(config.shortName_en)}, ${MySQL.escape(config.shortName || null)},
				0, 'local', ${MySQL.escape(config.lang)}, 'md',
				${MySQL.escape(config.name_en)}, ${MySQL.escape(config.author_en)},
				${MySQL.escape(config.name || null)}, ${MySQL.escape(config.author || null)}, NULL,
				${MySQL.escape(config.description || null)}, ${MySQL.escape(config.aqidah || null)})
		ON DUPLICATE KEY UPDATE
			ordinal=VALUES(ordinal),
			type=VALUES(type),
			shortName_en=VALUES(shortName_en),
			shortName=VALUES(shortName),
			hidden=VALUES(hidden),
			source=VALUES(source),
			lang=VALUES(lang),
			format=VALUES(format),
			name_en=VALUES(name_en),
			author_en=VALUES(author_en),
			title=VALUES(title),
			author=VALUES(author),
			death=VALUES(death),
			description=VALUES(description),
			aqidah=VALUES(aqidah)`);
	const rows = await global.query(`
		SELECT id
		FROM books
		WHERE alias=${MySQL.escape(config.alias)}
			AND source='local'
			AND type='tafsir'
		LIMIT 1`);
	if (rows.length !== 1)
		throw new Error(`Local commentary '${config.alias}' was not found after upsert.`);
	return rows[0].id;
}

async function upsertPassages(bookId, config, passages) {
	for (let offset = 0; offset < passages.length; offset += options.batchSize) {
		const values = passages.slice(offset, offset + options.batchSize).map(passage => `(
			${bookId},
			${passage.hadithId},
			${passage.surah},
			${passage.ayah},
			${passage.ayah},
			${passage.ayah},
			${MySQL.escape(passage.text)},
			${MySQL.escape(passage.text_en)},
			${MySQL.escape(passage.footnotes)},
			${MySQL.escape(passage.footnotes_en)}
		)`).join(',\n');
		await global.query(`
			INSERT INTO hadiths_commentary
				(bookId, hadithId, surah, ayahFrom, ayahTo, passageNum, text, text_en, footnotes, footnotes_en)
			VALUES ${values}
			ON DUPLICATE KEY UPDATE
				hadithId=VALUES(hadithId),
				passageNum=VALUES(passageNum),
				text=VALUES(text),
				text_en=VALUES(text_en),
				footnotes=VALUES(footnotes),
				footnotes_en=VALUES(footnotes_en)`);
		console.log(`Stored ${Math.min(offset + options.batchSize, passages.length)}/${passages.length} '${config.alias}' passage(s)...`);
	}
}

async function loadQuranAyahs() {
	const rows = await global.query(`
		SELECT id, num
		FROM hadiths
		WHERE bookId=0
			AND num REGEXP '^[0-9]+:[1-9][0-9]*$'
		ORDER BY id`);
	if (rows.length !== 6236)
		throw new Error(`Expected 6236 Quran āyāt, found ${rows.length}.`);
	return rows.map(row => {
		const location = parseRef(row.num);
		return {
			id: row.id,
			ref: row.num,
			surah: location.surah,
			ayah: location.ayah
		};
	});
}

function toMarkdownText(value) {
	return normalizeMarkdown(value).replace(/\[([0-9]+)\]/g, '[^$1]');
}

function toMarkdownFootnotes(value) {
	const text = normalizeMarkdown(value);
	if (!text)
		return null;
	const notes = parseNumberedFootnotes(text);
	if (!notes.length)
		return text;
	return notes.map(note => `[^${note.number}]: ${markdownFootnoteDefinition(note.text)}`).join('\n');
}

function parseNumberedFootnotes(text) {
	const matches = Array.from(text.matchAll(/(?:^|\n)\s*\[([0-9]+)\]\s*/g));
	if (!matches.length)
		return [];
	return matches.map((match, index) => {
		const start = match.index + match[0].length;
		const end = index + 1 < matches.length ? matches[index + 1].index : text.length;
		return {
			number: match[1],
			text: text.slice(start, end).trim()
		};
	}).filter(note => note.text);
}

function normalizeMarkdown(value) {
	return (value == null ? '' : String(value))
		.replace(/\r\n?/g, '\n')
		.split(/\n{2,}/)
		.map(block => block.split('\n').map(line => line.trim()).filter(Boolean).join('\n'))
		.filter(Boolean)
		.join('\n\n');
}

function markdownFootnoteDefinition(note) {
	return note.replace(/\r\n?/g, '\n').split('\n').map((line, index) => {
		return index === 0 ? line : `    ${line}`;
	}).join('\n');
}

function parseRef(ref) {
	const match = /^([0-9]+):([0-9]+)$/.exec(ref);
	if (!match)
		throw new Error(`Invalid Quran reference '${ref}'.`);
	return { surah: Number(match[1]), ayah: Number(match[2]) };
}

function reportDryRun(config, passages) {
	const populated = passages.filter(passage => {
		return config.lang === 'ar' ? passage.text : passage.text_en;
	}).length;
	const footnoted = passages.filter(passage => {
		return config.lang === 'ar' ? passage.footnotes : passage.footnotes_en;
	}).length;
	console.log(`Checked '${config.alias}': ${passages.length} passage(s), ${populated} populated, ${footnoted} with markdown footnotes.`);
}

function readOptions(argv) {
	const options = {
		sources: Object.keys(SOURCES),
		concurrency: 4,
		retries: 2,
		retryDelay: 1000,
		timeout: 20000,
		delay: 0,
		saveEvery: 10,
		batchSize: DEFAULT_BATCH_SIZE,
		dryRun: false
	};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--source') {
			const source = requiredValue(argv, ++i, arg);
			if (!SOURCES[source])
				throw new Error(`Unknown source '${source}'. Valid sources: ${Object.keys(SOURCES).join(', ')}`);
			options.sources = [source];
		} else if (arg === '--concurrency')
			options.concurrency = positiveInteger(argv, ++i, arg);
		else if (arg === '--retries')
			options.retries = nonNegativeInteger(argv, ++i, arg);
		else if (arg === '--retry-delay')
			options.retryDelay = nonNegativeInteger(argv, ++i, arg);
		else if (arg === '--timeout')
			options.timeout = positiveInteger(argv, ++i, arg);
		else if (arg === '--delay')
			options.delay = nonNegativeInteger(argv, ++i, arg);
		else if (arg === '--save-every')
			options.saveEvery = positiveInteger(argv, ++i, arg);
		else if (arg === '--batch-size')
			options.batchSize = positiveInteger(argv, ++i, arg);
		else if (arg === '--dry-run')
			options.dryRun = true;
		else if (arg === '--help' || arg === '-h') {
			console.log(usage());
			process.exit(0);
		} else
			throw new Error(`Unknown option '${arg}'.\n\n${usage()}`);
	}
	return options;
}

function requiredValue(argv, index, option) {
	if (!argv[index] || argv[index].startsWith('--'))
		throw new Error(`${option} requires a value.`);
	return argv[index];
}

function nonNegativeInteger(argv, index, option) {
	const value = Number(requiredValue(argv, index, option));
	if (!Number.isInteger(value) || value < 0)
		throw new Error(`${option} requires a non-negative integer.`);
	return value;
}

function positiveInteger(argv, index, option) {
	const value = nonNegativeInteger(argv, index, option);
	if (value < 1)
		throw new Error(`${option} requires a positive integer.`);
	return value;
}

function ensureDirectory(directory) {
	fs.mkdirSync(directory, { recursive: true });
}

function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function describeAxiosError(err) {
	const status = err.response?.status ? `HTTP ${err.response.status}: ` : '';
	const message = err.response?.data?.message || err.response?.data?.error || err.message;
	return `${status}${message}`;
}

function usage() {
	return [
		'Usage: node bin/utils/load-quranenc-tafsirs.js [options]',
		'',
		'Downloads QuranEnc surah translation/tafsir APIs and imports them as local tafsir rows.',
		'',
		'Options:',
		`  --source <name>       Import one source (${Object.keys(SOURCES).join(', ')})`,
		'  --concurrency <num>  Parallel surah downloads (default: 4)',
		'  --retries <num>      Retries per API request (default: 2)',
		'  --retry-delay <ms>   Delay between retries (default: 1000)',
		'  --timeout <ms>       API timeout (default: 20000)',
		'  --delay <ms>         Delay after each surah fetch (default: 0)',
		'  --save-every <num>   Cache write interval by completed surahs (default: 10)',
		'  --batch-size <num>   MySQL insert batch size (default: 250)',
		'  --dry-run            Download/cache and report without updating MySQL',
		'  --help               Show this help'
	].join('\n');
}
