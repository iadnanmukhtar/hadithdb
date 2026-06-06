#!/usr/bin/env node
/* jslint node:true, esversion:9 */
'use strict';

require('dotenv').config();
require('../../lib/Globals');
const fs = require('fs');
const path = require('path');
const MySQL = require('mysql');
const cheerio = require('cheerio');

const TAFSIRS = {
	'tafsir-tabari': {
		ordinal: 11,
		shortName_en: 'Tabari',
		shortName: 'الطبري',
		name_en: 'Jami al-Bayan',
		name: 'جامع البيان',
		author_en: 'Ibn Jarir al-Tabari',
		author: 'ابن جرير الطبري',
		lang: 'ar',
		format: 'md',
		file: 'data/tafsir/tabari.json',
		column: 'text',
		sourceFormat: 'html'
	},
	'tafsir-baghawi': {
		ordinal: 12,
		shortName_en: 'Baghawi',
		shortName: 'البغوي',
		name_en: 'Maalim al-Tanzil',
		name: 'معالم التنزيل',
		author_en: 'al-Husayn b. Muhammad al-Farra al-Baghawi',
		author: 'البغوي',
		lang: 'ar',
		format: 'md',
		file: 'data/tafsir/baghawi.json',
		column: 'text',
		sourceFormat: 'html'
	},
	'tafsir-ibn-al-jawzi': {
		ordinal: 13,
		shortName_en: 'Ibn al-Jawzi',
		shortName: 'ابن الجوزي',
		name_en: 'Zad al-Masir',
		name: 'زاد المسير',
		author_en: 'Abd al-Rahman b. Abu Hasan Ali b. al-Jawzi',
		author: 'ابن الجوزي',
		lang: 'ar',
		format: 'md',
		file: 'data/tafsir/ibn-al-jawzi.json',
		column: 'text',
		sourceFormat: 'html'
	},
	'tafsir-qurtubi': {
		ordinal: 15,
		shortName_en: 'Qurtubi',
		shortName: 'القرطبي',
		name_en: 'al-Jami li-Ahkam al-Quran',
		name: 'الجامع لأحكام القرآن',
		author_en: 'Muhammad b. Abu Bakr al-Ansari al-Qurtubi',
		author: 'القرطبي',
		lang: 'ar',
		format: 'md',
		file: 'data/tafsir/qurtubi.json',
		column: 'text',
		sourceFormat: 'html'
	},
	'tafsir-ibn-ashur': {
		ordinal: 17,
		shortName_en: 'Ibn Ashur',
		shortName: 'ابن عاشور',
		name_en: 'al-Tahrir wa-al-Tanwir',
		name: 'التحرير والتنوير',
		author_en: 'Muhammad al-Tahir b. Ashur',
		author: 'ابن عاشور',
		lang: 'ar',
		format: 'md',
		file: 'data/tafsir/ibn-ashur.json',
		column: 'text',
		sourceFormat: 'html'
	},
	'tafsir-mathur': {
		ordinal: 91,
		shortName_en: 'Mathur',
		shortName: 'المأثور',
		name_en: 'Encyclopedia of Narrated Tafsir',
		name: 'موسوعة التفسير المأثور',
		author_en: 'al-Shatibi Institute',
		author: 'معهد الشاطبي',
		lang: 'ar',
		format: 'md',
		file: 'data/tafsir/tafsir-al-mathur.json',
		column: 'text',
		sourceFormat: 'html'
	},
	'tafsir-suyuti': {
		ordinal: 92,
		shortName_en: 'Suyuti',
		shortName: 'السيوطي',
		name_en: 'al-Durr al-Manthur',
		name: 'الدر المنثور',
		author_en: 'Jalal al-Din al-Suyuti',
		author: 'جلال الدين السيوطي',
		lang: 'ar',
		format: 'md',
		file: 'data/tafsir/tafsir-suyuti.json',
		column: 'text',
		sourceFormat: 'html'
	},
	'gharib-al-quran': {
		ordinal: 93,
		shortName_en: 'Gharib',
		shortName: 'الغريب',
		name_en: 'al-Siraj fi Bayan Gharib al-Quran',
		name: 'السراج في بيان غريب القرآن',
		author_en: 'Tafsir Center for Quranic Studies',
		author: 'مركز تفسير للدراسات القرآنية',
		lang: 'ar',
		format: 'md',
		file: 'data/tafsir/gharib-al-quran.json',
		column: 'text',
		sourceFormat: 'html'
	},
	'en-tafsir-maarif-al-quran': {
		ordinal: 4,
		shortName_en: "Ma'ariful Qur'an",
		name_en: "Ma'ariful Qur'an",
		author_en: 'Mufti Muhammad Shafi',
		directory: 'data/en-maarifulquran'
	},
	'en-tafsir-tazkir-al-quran': {
		ordinal: 5,
		shortName_en: 'Tazkirul Quran',
		name_en: 'Tazkirul Quran',
		author_en: 'Maulana Wahiduddin Khan',
		directory: 'data/en-tazkirulquran'
	},
	'en-tafsir-mokhtasar': {
		ordinal: 6,
		shortName_en: 'Mokhtasar',
		shortName: 'المختصر',
		name_en: 'al-Mukhtasar fi al-Tafsir al-Quran al-Karim',
		name: 'المختصر في تفسير القرآن الكريم',
		author_en: 'Tafsir Center for Quranic Studies',
		author: 'مركز تفسير للدراسات القرآنية',
		lang: 'en',
		format: 'en:md,ar:md',
		files: {
			en: 'data/en-mokhtasar.json',
			ar: 'data/ar-mokhtasar.json'
		}
	},
	'irab-al-quran': {
		ordinal: 61,
		shortName_en: 'Irab',
		shortName: 'الإعراب',
		name_en: 'al-Jadwal fi Irab al-Quran',
		name: 'الجدول في إعراب القرآن',
		author_en: 'Mahmud Safi',
		author: 'محمود صافي',
		lang: 'ar',
		format: 'md',
		file: 'data/irab.json',
		column: 'text',
		sourceFormat: 'html'
	},
	'qiraat': {
		ordinal: 62,
		shortName_en: "Qira'at",
		shortName: 'القراءات',
		name_en: "al-Jadwal fi Qira'at al-Quran",
		name: 'الجدول في قراءات القرآن',
		author_en: 'Mahmud Safi',
		author: 'محمود صافي',
		lang: 'ar',
		format: 'md',
		file: 'data/qiraat.json',
		column: 'text',
		sourceFormat: 'html'
	}
};
const options = readOptions(process.argv.slice(2));

(async () => {
	const connection = await getConnection();
	try {
		const quran = await loadQuranAyahs(connection);
		for (const alias of options.aliases)
			await importTafsir(connection, alias, quran);
	} catch (err) {
		console.error(`ERROR: ${err.message}`);
		process.exitCode = 1;
	} finally {
		connection.release();
		global.dbPool.end();
	}
})();

async function importTafsir(connection, alias, quran) {
	const config = TAFSIRS[alias];
	const passages = loadPassages(config, quran);
	console.log(`${options.dryRun ? 'Checking' : 'Loading'} ${passages.length} '${alias}' passages...`);
	if (options.dryRun)
		return;

	await query(connection, 'START TRANSACTION');
	try {
		const bookCommentaryId = await upsertCommentary(connection, alias, config);
		for (let offset = 0; offset < passages.length; offset += 250)
			await upsertPassages(connection, bookCommentaryId, passages.slice(offset, offset + 250));
		await query(connection, 'COMMIT');
		console.log(`Loaded '${alias}'.`);
	} catch (err) {
		await query(connection, 'ROLLBACK');
		throw err;
	}
}

async function loadQuranAyahs(connection) {
	const rows = await query(connection, `
		SELECT id, num, body_en
		FROM hadiths
		WHERE bookId=0
			AND num REGEXP '^[0-9]+:[1-9][0-9]*$'`);
	const quran = new Map(rows.map(row => [row.num, row]));
	if (quran.size !== 6236)
		throw new Error(`Expected 6236 Quran ayahs, found ${quran.size}.`);
	return quran;
}

function loadPassages(config, quran) {
	if (config.files)
		return loadPairedPassages(config, quran);
	if (config.file)
		return loadSingleRefPassages(config, quran);
	const directory = path.resolve(__dirname, '../..', config.directory);
	const passages = [];
	const seen = new Set();
	for (let surah = 1; surah <= 114; surah++) {
		const filename = path.join(directory, `${surah}.json`);
		const document = JSON.parse(fs.readFileSync(filename, 'utf8'));
		if (!Array.isArray(document.ayahs))
			throw new Error(`${filename} does not contain an ayahs array.`);
		for (const ayah of document.ayahs) {
			const ref = `${surah}:${ayah.ayah}`;
			const quranAyah = quran.get(ref);
			if (!quranAyah)
				throw new Error(`Quran ayah '${ref}' was not found.`);
			if (ayah.surah !== surah || !Number.isInteger(ayah.ayah) || ayah.ayah < 1)
				throw new Error(`Invalid ayah in ${filename}: ${JSON.stringify(ayah)}`);
			if (seen.has(ref))
				throw new Error(`Duplicate ayah '${ref}' in ${filename}.`);
			seen.add(ref);
			passages.push({
				hadithId: quranAyah.id,
				surah,
				ayah: ayah.ayah,
				text_en: plainTextToMarkdown([quranAyah.body_en, ayah.text].filter(Boolean).join('\n\n')),
				text: null
			});
		}
	}
	if (passages.length !== quran.size)
		throw new Error(`Expected ${quran.size} passages in '${config.directory}', found ${passages.length}.`);
	return passages;
}

function loadSingleRefPassages(config, quran) {
	const source = loadRefMap(config.file);
	const passages = [];
	for (const [ref, quranAyah] of quran.entries()) {
		const location = parseRef(ref);
		const text = resolveRefText(source, ref, config.file, [], config.sourceFormat === 'html');
		const passage = {
			hadithId: quranAyah.id,
			surah: location.surah,
			ayah: location.ayah,
			text: null,
			text_en: null
		};
		passage[config.column || 'text'] = commentarySourceToMarkdown(text, config);
		passages.push(passage);
	}
	if (passages.length !== quran.size)
		throw new Error(`Expected ${quran.size} passages in '${config.file}', found ${passages.length}.`);
	return passages;
}

function loadPairedPassages(config, quran) {
	const english = loadRefMap(config.files.en);
	const arabic = loadRefMap(config.files.ar);
	const passages = [];
	for (const [ref, quranAyah] of quran.entries()) {
		const location = parseRef(ref);
		const englishText = resolveRefText(english, ref, config.files.en);
		const arabicText = resolveRefText(arabic, ref, config.files.ar);
		passages.push({
			hadithId: quranAyah.id,
			surah: location.surah,
			ayah: location.ayah,
			text_en: plainTextToMarkdown([quranAyah.body_en, englishText].filter(Boolean).join('\n\n')),
			text: plainTextToMarkdown(arabicText)
		});
	}
	if (passages.length !== quran.size)
		throw new Error(`Expected ${quran.size} passages in paired tafsir files, found ${passages.length}.`);
	return passages;
}

function loadRefMap(relativeFile) {
	const filename = path.resolve(__dirname, '../..', relativeFile);
	const document = JSON.parse(fs.readFileSync(filename, 'utf8'));
	if (!document || Array.isArray(document) || typeof document !== 'object')
		throw new Error(`${filename} must contain a reference keyed object.`);
	if (Object.keys(document).length !== 6236)
		throw new Error(`${filename} must contain 6236 ayah references.`);
	return document;
}

function resolveRefText(map, ref, sourceFile, stack = [], preserveHtml = false) {
	const value = map[ref];
	if (typeof value === 'string') {
		if (stack.includes(ref))
			throw new Error(`Circular reference in ${sourceFile}: ${stack.concat(ref).join(' -> ')}`);
		return resolveRefText(map, value, sourceFile, stack.concat(ref), preserveHtml);
	}
	if (value && typeof value === 'object' && Object.keys(value).length === 0)
		return '';
	if (!value || typeof value.text !== 'string')
		throw new Error(`${sourceFile} does not contain text for '${ref}'.`);
	return preserveHtml ? value.text.trim() : htmlToText(value.text);
}

function parseRef(ref) {
	const match = /^([0-9]+):([0-9]+)$/.exec(ref);
	if (!match)
		throw new Error(`Invalid Quran reference '${ref}'.`);
	return { surah: Number(match[1]), ayah: Number(match[2]) };
}

async function upsertCommentary(connection, alias, config) {
	await query(connection, `
		INSERT INTO books_commentaries
			(ordinal, alias, type, shortName_en, shortName, hidden, source, lang, format, name_en, author_en, name, author)
		VALUES
			(${config.ordinal}, ${MySQL.escape(alias)}, 'tafsir', ${MySQL.escape(config.shortName_en)}, ${MySQL.escape(config.shortName || null)},
				0, 'local', ${MySQL.escape(config.lang || 'en')}, ${MySQL.escape(config.format || 'md')},
				${MySQL.escape(config.name_en)}, ${MySQL.escape(config.author_en)},
				${MySQL.escape(config.name || null)}, ${MySQL.escape(config.author || null)})
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
			name=VALUES(name),
			author=VALUES(author)`);
	const rows = await query(connection, `
		SELECT id
		FROM books_commentaries
		WHERE alias=${MySQL.escape(alias)}
			AND source='local'
		LIMIT 1`);
	if (rows.length !== 1)
		throw new Error(`Local commentary '${alias}' was not found after upsert.`);
	return rows[0].id;
}

async function upsertPassages(connection, bookCommentaryId, passages) {
	const values = passages.map(passage => `(
		${bookCommentaryId},
		${passage.hadithId},
		${passage.surah},
		${passage.ayah},
		${passage.ayah},
		${passage.ayah},
		${MySQL.escape(passage.text)},
		${MySQL.escape(passage.text_en)}
	)`).join(',\n');
	await query(connection, `
		INSERT INTO hadiths_commentary
			(bookCommentaryId, hadithId, surah, ayahFrom, ayahTo, passageNum, text, text_en)
		VALUES ${values}
		ON DUPLICATE KEY UPDATE
			hadithId=VALUES(hadithId),
			passageNum=VALUES(passageNum),
			text=VALUES(text),
			text_en=VALUES(text_en)`);
}

function getConnection() {
	return new Promise((resolve, reject) => {
		global.dbPool.getConnection((err, connection) => err ? reject(err) : resolve(connection));
	});
}

function query(connection, sql) {
	return new Promise((resolve, reject) => {
		connection.query(sql, (err, result) => err ? reject(err) : resolve(result));
	});
}

function plainTextToMarkdown(text) {
	return text.split(/\n+/).filter(Boolean).map(line => {
		return line.replace(/[\\`*_[\]{}()#+\-.!|<>~]/g, '\\$&');
	}).join('\n\n');
}

function commentarySourceToMarkdown(text, config) {
	if (config.format === 'html')
		return text;
	if (config.sourceFormat === 'html')
		return htmlToMarkdown(text);
	return plainTextToMarkdown(text);
}

function htmlToMarkdown(html) {
	const $ = cheerio.load(html, { decodeEntities: true }, false);
	const blocks = [];
	const rootNodes = $('body').length ? $('body').contents().toArray() : $.root().contents().toArray();
	for (const node of rootNodes)
		collectMarkdownBlocks($, node, blocks);
	return blocks.map(block => block.trim()).filter(Boolean).join('\n\n');
}

function collectMarkdownBlocks($, node, blocks) {
	if (!node)
		return;
	if (node.type === 'text') {
		const text = markdownEscape(node.data || '').trim();
		if (text)
			blocks.push(text);
		return;
	}
	const name = (node.name || '').toLowerCase();
	if (name === 'p') {
		const text = renderMarkdownInline($, $(node).contents().toArray()).trim();
		if (text)
			blocks.push(text);
		return;
	}
	if (name === 'br') {
		blocks.push('');
		return;
	}
	for (const child of $(node).contents().toArray())
		collectMarkdownBlocks($, child, blocks);
}

function renderMarkdownInline($, nodes) {
	return nodes.map(node => {
		if (node.type === 'text')
			return markdownEscape(node.data || '');
		const name = (node.name || '').toLowerCase();
		if (name === 'br')
			return '\n';
		const content = renderMarkdownInline($, $(node).contents().toArray());
		if ((name === 'b' || name === 'strong') && content.trim())
			return `**${content.trim()}**`;
		return content;
	}).join('').replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n');
}

function markdownEscape(text) {
	return text.replace(/[\\`*_[\]{}()#+\-.!|<>~]/g, '\\$&');
}

function htmlToText(text) {
	return text
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/p>/gi, '\n')
		.replace(/<[^>]+>/g, '')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.trim();
}

function readOptions(argv) {
	const aliases = [];
	let dryRun = false;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--tafsir') {
			const alias = argv[++i];
			if (!TAFSIRS[alias])
				throw new Error(`Unknown tafsir '${alias || ''}'.`);
			aliases.push(alias);
		} else if (arg === '--dry-run')
			dryRun = true;
		else if (arg === '--help' || arg === '-h') {
			console.log(usage());
			process.exit(0);
		} else
			throw new Error(`Unknown option '${arg}'.\n\n${usage()}`);
	}
	return { aliases: aliases.length ? aliases : Object.keys(TAFSIRS), dryRun };
}

function usage() {
	return [
		'Usage: node bin/utils/load-local-tafsir-json.js [options]',
		'',
		'Loads bundled Quran.com tafsir JSON into local commentary rows.',
		'Each ayah stores the Quran translation first, followed by the commentary.',
		'',
		'Options:',
		'  --tafsir <alias>  Load only one configured local tafsir',
		'  --dry-run         Validate source files without changing MySQL',
		'  --help            Show this help'
	].join('\n');
}
