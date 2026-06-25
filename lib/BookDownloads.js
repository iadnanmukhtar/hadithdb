'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { homedir } = require('os');
const createError = require('http-errors');
const Tafsir = require('./Tafsir');
const Utils = require('./Utils');
const Books = require('./Books');

const DOWNLOAD_DIR = path.join(homedir(), '.hadithdb', 'cache', 'downloads');
const DOWNLOAD_FORMATS = new Set(['json', 'epub']);
const DOWNLOAD_SCHEMA_VERSION = 'book-v4';

function hadithDownloadPath(book, format) {
	return absoluteHadithUrl(`/${encodeURIComponent(book.alias)}.${format}`);
}

function relativeHadithDownloadPath(book, format) {
	return `/${encodeURIComponent(book.alias)}.${format}`;
}

function tafsirDownloadPath(book, format) {
	const slug = book.slug || Tafsir.tafsirSlug(book.alias);
	return absoluteQuranUrl(Utils.quranPath(`/quran/tafsir/${encodeURIComponent(slug)}.${format}`));
}

function relativeTafsirDownloadPath(book, format) {
	const slug = book.slug || Tafsir.tafsirSlug(book.alias);
	return Utils.quranPath(`/quran/tafsir/${encodeURIComponent(slug)}.${format}`);
}

function translationDownloadPath(book, format) {
	return absoluteQuranUrl(Utils.quranPath(`/quran/${encodeURIComponent(book.quranBookSlug || book.alias)}.${format}`));
}

function relativeTranslationDownloadPath(book, format) {
	return Utils.quranPath(`/quran/${encodeURIComponent(book.quranBookSlug || book.alias)}.${format}`);
}

function downloadPath(book, format) {
	const type = book && (book.type || book.book_type || book.book_model);
	if (type === 'tafsir')
		return tafsirDownloadPath(book, format);
	if (type === 'trans')
		return translationDownloadPath(book, format);
	return hadithDownloadPath(book, format);
}

function relativeDownloadPath(book, format) {
	const type = book && (book.type || book.book_type || book.book_model);
	if (type === 'tafsir')
		return relativeTafsirDownloadPath(book, format);
	if (type === 'trans')
		return relativeTranslationDownloadPath(book, format);
	return relativeHadithDownloadPath(book, format);
}

function downloadLinks(book) {
	return {
		json: downloadPath(book, 'json'),
		epub: downloadPath(book, 'epub')
	};
}

function relativeDownloadLinks(book) {
	return {
		json: relativeDownloadPath(book, 'json'),
		epub: relativeDownloadPath(book, 'epub')
	};
}

function assertFormat(format) {
	format = (format || '').toString().toLowerCase();
	if (!DOWNLOAD_FORMATS.has(format))
		throw createError(404, 'Download format not found');
	return format;
}

async function sendHadithBook(req, res, next) {
	try {
		const format = assertFormat(req.params.format);
		const book = (global.books || []).find(row => row && Number(row.hidden) === 0 && row.alias === req.params.bookAlias);
		if (!book)
			return next(createError(404, `Book '${req.params.bookAlias}' does not exist`));
		await sendBookDownload(req, res, book, format, () => hadithBookRows(book));
	} catch (err) {
		next(err);
	}
}

async function sendTafsirBook(req, res, next) {
	try {
		const format = assertFormat(req.params.format);
		const book = await Tafsir.resolveTafsir(req.params.tafsirAlias);
		if (!book)
			return next(createError(404, `Tafsir '${req.params.tafsirAlias}' does not exist`));
		await sendBookDownload(req, res, book, format, () => commentaryBookRows(book));
	} catch (err) {
		next(err);
	}
}

async function sendTranslationBook(req, res, next) {
	try {
		const format = assertFormat(req.params.format);
		const alias = (req.params.translationAlias || '').toString();
		const book = Tafsir.visibleTranslationsSync().find(row => row.alias === alias || row.quranBookSlug === alias);
		if (!book)
			return next(createError(404, `Translation '${alias}' does not exist`));
		await sendBookDownload(req, res, book, format, () => commentaryBookRows(book));
	} catch (err) {
		next(err);
	}
}

async function sendBookDownload(req, res, book, format, loadRows) {
	await Books.ensureBookContentLastmodColumn();
	const cacheFile = downloadCacheFile(book, format);
	const contentLastmod = await bookContentLastmod(book);
	const flush = Utils.shouldFlushCache(req);
	if (!flush && await isCacheFresh(cacheFile, contentLastmod))
		return sendCachedFile(res, cacheFile, book, format, contentLastmod);
	const rows = await loadRows();
	const document = buildBookDocument(book, rows);
	await fsp.mkdir(path.dirname(cacheFile), { recursive: true });
	if (format === 'json') {
		await fsp.writeFile(cacheFile, JSON.stringify(document, null, 2));
	} else {
		await fsp.writeFile(cacheFile, Utils.toEpub(book, document));
	}
	return sendCachedFile(res, cacheFile, book, format, contentLastmod);
}

function downloadCacheFile(book, format) {
	const type = book && (book.type || book.book_type || book.book_model || 'hadith');
	return path.join(DOWNLOAD_DIR, type, `${Utils.safeFilename(book.alias)}.${DOWNLOAD_SCHEMA_VERSION}.${format}`);
}

async function isCacheFresh(cacheFile, contentLastmod) {
	try {
		const stat = await fsp.stat(cacheFile);
		if (!contentLastmod)
			return stat.size > 0;
		return stat.size > 0 && stat.mtimeMs >= contentLastmod.getTime();
	} catch (_err) {
		return false;
	}
}

function sendCachedFile(res, cacheFile, book, format, contentLastmod) {
	const filename = `hadithunlocked_${Utils.safeFilename(book.alias)}.${format}`;
	res.setHeader('Content-Type', format === 'json' ? 'application/json; charset=utf-8' : 'application/epub+zip');
	res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
	if (contentLastmod instanceof Date && !Number.isNaN(contentLastmod.getTime()))
		res.setHeader('Last-Modified', contentLastmod.toUTCString());
	fs.createReadStream(cacheFile).pipe(res);
}

async function bookContentLastmod(book) {
	const row = (await global.query(`
		SELECT UNIX_TIMESTAMP(content_lastmod) * 1000 AS content_lastmod_ms
		FROM books
		WHERE id=${Number(book.id)}
		LIMIT 1`))[0];
	const value = row && Number(row.content_lastmod_ms);
	return Number.isFinite(value) && value > 0 ? new Date(value) : null;
}

async function hadithBookRows(book) {
	const table = Number(book.virtual) === 1 ? 'v_hadiths_virtual_snapshot' : 'v_hadiths';
	return global.query(`SELECT * FROM ${table} WHERE book_id=${Number(book.id)} ORDER BY ordinal`);
}

function buildBookDocument(book, rows) {
	rows = Array.isArray(rows) ? rows : [];
	const type = book && (book.type || book.book_type || book.book_model || rows[0]?.commentary_type || 'hadith');
	const document = compactObject({
		format: DOWNLOAD_SCHEMA_VERSION,
		book: compactObject({
			id: numberOrUndefined(book && book.id),
			alias: book && book.alias,
			type: type,
			language: book && book.lang,
			source: book && book.source,
			url: bookUrl(book),
			title: localizedText(book && (book.name_en || book.title_en || book.shortName_en), book && (book.name || book.title || book.shortName)),
			shortName: localizedText(book && book.shortName_en, book && book.shortName),
			author: localizedText(book && book.author_en, book && book.author),
			death: book && book.death,
			downloads: downloadLinks(book)
		}),
		intro: localizedText(book && book.description, ''),
		chapters: []
	});
	const chapterMap = new Map();
	rows.forEach(row => {
		const chapter = getGroup(chapterMap, chapterKey(row), () => buildChapter(row));
		const sectionKeyValue = sectionKey(row);
		if (sectionKeyValue) {
			if (!chapter._sections)
				chapter._sections = new Map();
			const section = getGroup(chapter._sections, sectionKeyValue, () => buildSection(row));
			const subsectionKeyValue = subsectionKey(row);
			if (subsectionKeyValue) {
				if (!section._subsections)
					section._subsections = new Map();
				const subsection = getGroup(section._subsections, subsectionKeyValue, () => buildSubsection(row));
				subsection.items.push(buildItem(row));
			} else {
				section.items.push(buildItem(row));
			}
		} else {
			chapter.items.push(buildItem(row));
		}
	});
	document.chapters = Array.from(chapterMap.values()).map(finalizeGroup);
	return document;
}

function getGroup(map, key, factory) {
	if (!map.has(key))
		map.set(key, factory());
	return map.get(key);
}

function chapterKey(row) {
	return valueKey(row.h1 || row.surah || 'book');
}

function sectionKey(row) {
	return row.h2 !== undefined && row.h2 !== null && row.h2 !== '' ? valueKey(row.h2) : '';
}

function subsectionKey(row) {
	return row.h3 !== undefined && row.h3 !== null && row.h3 !== '' ? valueKey(row.h3) : '';
}

function valueKey(value) {
	return value === undefined || value === null || value === '' ? '' : value.toString();
}

function buildChapter(row) {
	return {
		number: numberOrString(row.h1 || row.surah),
		title: localizedText(row.h1_title_en || row.book_name_en || row.book_shortName_en, row.h1_title || row.book_name || row.book_shortName),
		intro: localizedText(row.h1_intro_en, row.h1_intro),
		sections: [],
		items: []
	};
}

function buildSection(row) {
	return {
		number: numberOrString(row.h2),
		title: localizedText(row.h2_title_en, row.h2_title),
		intro: localizedText(row.h2_intro_en, row.h2_intro),
		subsections: [],
		items: []
	};
}

function buildSubsection(row) {
	return {
		number: numberOrString(row.h3),
		title: localizedText(row.h3_title_en, row.h3_title),
		intro: localizedText(row.h3_intro_en, row.h3_intro),
		items: []
	};
}

function buildItem(row) {
	return compactObject({
		id: numberOrUndefined(row.hId || row.id),
		ref: row.ref,
		path: itemUrl(row),
		number: row.num,
		range: row.surah ? compactObject({
			surah: numberOrUndefined(row.surah),
			from: numberOrUndefined(row.ayahFrom),
			to: numberOrUndefined(row.ayahTo)
		}) : undefined,
		title: localizedText(row.title_en || row.part_en || row.ref || row.num, row.title || row.part),
		chain: localizedText(row.chain_en, row.chain),
		text: itemText(row),
		quran: row.commentary_type === 'tafsir' ? compactObject({
			ref: row.ref,
			path: quranAyahUrl(row),
			range: row.surah ? compactObject({
				surah: numberOrUndefined(row.surah),
				from: numberOrUndefined(row.ayahFrom),
				to: numberOrUndefined(row.ayahTo)
			}) : undefined,
			ayahs: row.quran_ayahs,
			text: quranContextText(row)
		}) : undefined,
		footnotes: localizedText(row.footnote_en, row.footnote),
		grade: localizedText(row.grade_grade_en || row.grade_grades, row.grade_grade),
		quranText: isQuranTextItem(row) ? true : undefined
	});
}

function isQuranCommentary(row) {
	return row.commentary_type === 'trans' || row.commentary_type === 'tafsir';
}

function itemText(row) {
	if (row.commentary_type === 'trans')
		return localizedText(row.body_en || row.text, row.quran_body);
	return localizedText(row.body_en || row.text, row.body || row.text_en);
}

function isQuranTextItem(row) {
	return row.commentary_type === 'trans' || row.book_alias === 'quran' || Number(row.book_id) === 0;
}

function quranContextText(row) {
	return localizedText(includeDefaultQuranTranslation(row) ? row.quran_body_en : '', row.quran_body);
}

function includeDefaultQuranTranslation(row) {
	return row.commentary_type === 'trans' && row.commentary_source === 'default';
}

function finalizeGroup(group) {
	const output = { ...group };
	if (output._sections) {
		output.sections = Array.from(output._sections.values()).map(finalizeGroup);
		delete output._sections;
	}
	if (output._subsections) {
		output.subsections = Array.from(output._subsections.values()).map(finalizeGroup);
		delete output._subsections;
	}
	return compactObject(output);
}

function localizedText(en, ar) {
	return compactObject({
		en: normalizedString(en),
		ar: normalizedString(ar)
	});
}

function normalizedString(value) {
	value = Utils.trimToEmpty(value);
	return value === '' ? undefined : value;
}

function bookUrl(book) {
	const type = book && (book.type || book.book_type || book.book_model);
	if (type === 'tafsir')
		return absoluteQuranUrl(Utils.quranPath(`/quran/tafsir/${encodeURIComponent(book.slug || Tafsir.tafsirSlug(book.alias))}`));
	if (type === 'trans')
		return absoluteQuranUrl(Utils.quranPath(`/quran/${encodeURIComponent(book.quranBookSlug || book.alias)}`));
	if (book && book.alias === 'quran')
		return absoluteQuranUrl('/quran');
	return absoluteHadithUrl(`/${encodeURIComponent(book.alias)}`);
}

function itemUrl(row) {
	if (row.commentary_type === 'tafsir')
		return absoluteQuranUrl(Utils.quranPath(row.path || row.ref || ''));
	if (row.commentary_type === 'trans')
		return absoluteQuranUrl(Utils.quranPath(row.path || row.ref || ''));
	if (row.book_alias === 'quran' || Number(row.book_id) === 0)
		return absoluteQuranUrl(Utils.quranPath(row.path || row.ref || ''));
	return absoluteHadithUrl(pathOrRef(row.path || row.ref || ''));
}

function quranAyahUrl(row) {
	if (row.surah && row.ayahFrom)
		return absoluteQuranUrl(`/quran:${row.surah}:${row.ayahFrom}${Number(row.ayahTo) > Number(row.ayahFrom) ? `-${row.ayahTo}` : ''}`);
	return absoluteQuranUrl(Utils.quranPath(row.ref || row.path || ''));
}

function pathOrRef(value) {
	value = (value || '').toString();
	if (!value)
		return value;
	return value.charAt(0) === '/' ? value : `/${value}`;
}

function absoluteHadithUrl(path) {
	return absoluteUrl(global.settings?.site?.url || '', path);
}

function absoluteQuranUrl(path) {
	const site = global.settings && global.settings.site ? global.settings.site : {};
	return absoluteUrl(site.quranUrl || site.url || '', Utils.quranPath(path));
}

function absoluteUrl(baseUrl, path) {
	if (!path)
		return path;
	path = path.toString();
	if (/^https?:\/\//i.test(path))
		return path;
	baseUrl = (baseUrl || '').toString().replace(/\/+$/, '');
	if (!baseUrl)
		return pathOrRef(path);
	return `${baseUrl}${pathOrRef(path)}`;
}

function numberOrString(value) {
	if (value === undefined || value === null || value === '')
		return undefined;
	const numeric = Number(value);
	return Number.isFinite(numeric) ? numeric : value.toString();
}

function numberOrUndefined(value) {
	const numeric = Number(value);
	return Number.isFinite(numeric) ? numeric : undefined;
}

function compactObject(object) {
	Object.keys(object).forEach(key => {
		const value = object[key];
		if (value === undefined || value === null)
			delete object[key];
		else if (Array.isArray(value) && value.length === 0)
			delete object[key];
		else if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0)
			delete object[key];
	});
	return object;
}

async function commentaryBookRows(book) {
	const commentaryJoin = await Books.commentaryJoin('bc', 'hc');
	const rows = await global.query(`
		SELECT
			hc.id,
			hc.id AS hId,
			'commentary' AS doctype,
			bc.id AS book_id,
			bc.ordinal AS book_ordinal,
			bc.alias AS book_alias,
			bc.shortName_en AS book_shortName_en,
			bc.shortName AS book_shortName,
			bc.name_en AS book_name_en,
			bc.title AS book_name,
			bc.author AS book_author,
			0 AS book_virtual,
			q_start.level,
			q_start.h1_id,
			q_start.h1,
			q_start.h1_title_en,
			q_start.h1_title,
			q_start.h2_id,
			q_start.h2,
			q_start.h2_title_en,
			q_start.h2_title,
			q_start.h3_id,
			q_start.h3,
			q_start.h3_title_en,
			q_start.h3_title,
			hc.id AS ordinal,
			hc.ayahFrom AS numInChapter,
			CONCAT(hc.surah, ':', hc.ayahFrom, IF(hc.ayahTo > hc.ayahFrom, CONCAT('-', hc.ayahTo), '')) AS num,
			CONCAT('quran:', hc.surah, ':', hc.ayahFrom, IF(hc.ayahTo > hc.ayahFrom, CONCAT('-', hc.ayahTo), '')) AS ref,
			CONCAT('quran/', hc.surah, '/', hc.ayahFrom) AS path,
			CONCAT('Quran ', hc.surah, ':', hc.ayahFrom, IF(hc.ayahTo > hc.ayahFrom, CONCAT('-', hc.ayahTo), '')) AS title_en,
			q_start.h1_title AS title,
			'' AS chain_en,
			hc.text_en AS body_en,
			hc.footnotes_en AS footnote_en,
			'' AS chain,
			hc.text AS body,
			hc.footnotes AS footnote,
			q_start.body AS quran_body,
			q_start.body_en AS quran_body_en,
			hc.surah,
			hc.ayahFrom,
			hc.ayahTo,
			hc.passageNum,
			bc.type AS commentary_type,
			bc.lang AS commentary_lang,
			bc.source AS commentary_source,
			bc.format AS commentary_format,
			hc.created,
			hc.lastmod
		FROM ${commentaryJoin.from}
		${commentaryJoin.join}
		JOIN v_hadiths q_start ON q_start.id=hc.hadithId
		WHERE bc.id=${Number(book.id)}
			AND bc.source='local'
			AND bc.hidden=0
			AND ${commentaryJoin.typePredicate}
		ORDER BY hc.surah ASC, hc.ayahFrom ASC, hc.ayahTo ASC, hc.id ASC`);
	await attachQuranRanges(rows);
	return rows;
}

async function attachQuranRanges(rows) {
	rows = Array.isArray(rows) ? rows : [];
	const rangesBySurah = new Map();
	rows.filter(isQuranCommentary).forEach(row => {
		const surah = Number(row.surah);
		const from = Number(row.ayahFrom);
		const to = Number(row.ayahTo || row.ayahFrom);
		if (!Number.isFinite(surah) || !Number.isFinite(from))
			return;
		const current = rangesBySurah.get(surah) || { from, to };
		current.from = Math.min(current.from, from);
		current.to = Math.max(current.to, Number.isFinite(to) ? to : from);
		rangesBySurah.set(surah, current);
	});
	if (rangesBySurah.size === 0)
		return;
	const predicates = Array.from(rangesBySurah.entries()).map(([surah, range]) => {
		return `(h1=${Number(surah)} AND numInChapter BETWEEN ${Number(range.from)} AND ${Number(range.to)})`;
	}).join(' OR ');
	const ayahRows = await global.query(`
		SELECT
			h1 AS surah,
			numInChapter AS ayah,
			ref,
			path,
			body,
			body_en
		FROM v_hadiths
		WHERE book_alias='quran'
			AND (${predicates})
		ORDER BY h1 ASC, numInChapter ASC`);
	const ayahsBySurah = new Map();
	ayahRows.forEach(row => {
		const surah = Number(row.surah);
		if (!ayahsBySurah.has(surah))
			ayahsBySurah.set(surah, []);
		ayahsBySurah.get(surah).push(row);
	});
	rows.filter(isQuranCommentary).forEach(row => {
		const surah = Number(row.surah);
		const from = Number(row.ayahFrom);
		const to = Number(row.ayahTo || row.ayahFrom);
		const ayahs = (ayahsBySurah.get(surah) || []).filter(ayah => {
			const ayahNumber = Number(ayah.ayah);
			return ayahNumber >= from && ayahNumber <= (Number.isFinite(to) ? to : from);
		});
		if (ayahs.length === 0)
			return;
		row.quran_body = ayahs.map(ayah => normalizedString(ayah.body)).filter(Boolean).join(' ');
		row.quran_body_en = includeDefaultQuranTranslation(row)
			? ayahs.map(ayah => normalizedString(ayah.body_en)).filter(Boolean).join(' ')
			: '';
		row.quran_ayahs = ayahs.map(ayah => compactObject({
			ayah: numberOrUndefined(ayah.ayah),
			ref: ayah.ref,
			path: absoluteQuranUrl(`/quran:${row.surah}:${ayah.ayah}`),
			text: localizedText(includeDefaultQuranTranslation(row) ? ayah.body_en : '', ayah.body)
		}));
	});
}

module.exports = {
	downloadLinks,
	hadithDownloadPath,
	relativeDownloadLinks,
	sendHadithBook,
	sendTafsirBook,
	sendTranslationBook,
	tafsirDownloadPath,
	translationDownloadPath
};
