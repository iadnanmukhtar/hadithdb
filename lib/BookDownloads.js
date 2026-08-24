'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { homedir } = require('os');
const zlib = require('zlib');
const createError = require('http-errors');
const Tafsir = require('./Tafsir');
const Utils = require('./Utils');
const Books = require('./Books');
const Arabic = require('./Arabic');
const CommentaryHeadings = require('./CommentaryHeadings');

const DOWNLOAD_DIR = path.join(homedir(), '.hadithdb', 'cache', 'downloads');
const DOWNLOAD_FORMATS = new Set(['json', 'epub']);
const DOWNLOAD_SCHEMA_VERSION = 'book-v42';

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
		await sendBookDownload(req, res, book, format, () => isDefaultTranslationBook(book) ? defaultTranslationBookRows(book) : commentaryBookRows(book));
	} catch (err) {
		next(err);
	}
}

async function sendBookDownload(req, res, book, format, loadRows) {
	await Books.ensureBookContentLastmodColumn();
	const cacheFile = downloadCacheFile(book, format);
	const contentLastmod = await bookContentLastmod(book);
	const flush = Utils.shouldFlushCache(req);
	if (flush)
		await flushBookDownloadCache(book, format);
	const diskCacheEnabled = Utils.diskCacheEnabled();
	const cachedFile = diskCacheEnabled ? preferredDownloadCacheFile(cacheFile) : null;
	if (diskCacheEnabled && !flush && cachedFile && await isCacheFresh(cacheFile, contentLastmod))
		return sendCachedFile(res, cachedFile, book, format, contentLastmod, { flushed: flush }, req);
	const rows = await loadRows();
	const document = buildBookDocument(book, rows);
	const commentaryHeadings = await commentaryDownloadHeadings(book);
	const downloadDocument = bookDownloadDocument(book, rows, document, {
		format: format,
		commentaryHeadings: commentaryHeadings
	});
	const content = format === 'json'
		? Buffer.from(JSON.stringify(downloadDocument, null, 2), 'utf8')
		: Buffer.from(Utils.toEpub(book, downloadDocument), 'utf8');
	if (!diskCacheEnabled)
		return sendDownloadContent(res, content, book, format, contentLastmod, { flushed: flush }, req);
	await fsp.mkdir(path.dirname(cacheFile), { recursive: true });
	const cacheGzipFile = `${cacheFile}.gz`;
	const compressed = zlib.gzipSync(content);
	try {
		await fsp.unlink(cacheGzipFile);
	} catch (error) {
		if (error && error.code !== 'ENOENT')
			throw error;
	}
	await fsp.writeFile(cacheGzipFile, compressed);
	try {
		await fsp.unlink(cacheFile);
	} catch (error) {
		if (error && error.code !== 'ENOENT')
			throw error;
	}
	return sendCachedFile(res, cacheGzipFile, book, format, contentLastmod, { flushed: flush }, req);
}

function sendDownloadContent(res, content, book, format, contentLastmod, options, req) {
	const filename = `hadithunlocked_${Utils.safeFilename(book.alias)}.${format}`;
	res.setHeader('Content-Type', format === 'json' ? 'application/json; charset=utf-8' : 'application/epub+zip');
	res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
	if (options?.flushed)
		res.setHeader('Cache-Control', 'no-store');
	if (contentLastmod instanceof Date && !Number.isNaN(contentLastmod.getTime()))
		res.setHeader('Last-Modified', contentLastmod.toUTCString());
	if (Utils.shouldUseGzipEncoding(req)) {
		res.setHeader('Content-Encoding', 'gzip');
		res.setHeader('Vary', 'Accept-Encoding');
		return res.end(zlib.gzipSync(content));
	}
	return res.end(content);
}

function downloadCacheFile(book, format) {
	const type = book && (book.type || book.book_type || book.book_model || 'hadith');
	return path.join(DOWNLOAD_DIR, type, `${Utils.safeFilename(book.alias)}.${DOWNLOAD_SCHEMA_VERSION}.${format}`);
}

async function isCacheFresh(cacheFile, contentLastmod) {
	const cached = await latestDownloadCacheFile(cacheFile);
	if (!cached)
		return false;
	try {
		if (cached.stat.size <= 0 || !Utils.isCacheFileFresh(cached.file))
			return false;
		return !contentLastmod || cached.stat.mtimeMs >= contentLastmod.getTime();
	} catch (_err) {
		return false;
	}
}

function preferredDownloadCacheFile(cacheFile) {
	const gzFile = `${cacheFile}.gz`;
	try {
		if (fs.existsSync(gzFile))
			return gzFile;
	} catch (_err) {
		// fall through to raw file
	}
	return cacheFile;
}

async function latestDownloadCacheFile(cacheFile) {
	const gzFile = `${cacheFile}.gz`;
	const [rawStat, gzStat] = await Promise.all([
		fsp.stat(cacheFile).then(stat => ({ file: cacheFile, stat })).catch(() => null),
		fsp.stat(gzFile).then(stat => ({ file: gzFile, stat })).catch(() => null)
	]);
	return gzStat || rawStat;
}

async function flushBookDownloadCache(book, format) {
	const dir = path.dirname(downloadCacheFile(book, format));
	const prefix = `${Utils.safeFilename(book.alias)}.`;
	const suffix = `.${format}`;
	const suffixGz = `${suffix}.gz`;
	try {
		const files = await fsp.readdir(dir);
		await Promise.all(files
			.filter(file => file.startsWith(prefix) && file.endsWith(suffix))
			.map(file => fsp.unlink(path.join(dir, file)).catch(() => {})));
		await Promise.all(files
			.filter(file => file.startsWith(prefix) && file.endsWith(suffixGz))
			.map(file => fsp.unlink(path.join(dir, file)).catch(() => {})));
	} catch (err) {
		if (err && err.code !== 'ENOENT')
			throw err;
	}
}

function sendCachedFile(res, cacheFile, book, format, contentLastmod, options, req) {
	const filename = `hadithunlocked_${Utils.safeFilename(book.alias)}.${format}`;
	res.setHeader('Content-Type', format === 'json' ? 'application/json; charset=utf-8' : 'application/epub+zip');
	res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
	if (options?.flushed)
		res.setHeader('Cache-Control', 'no-store');
	if (contentLastmod instanceof Date && !Number.isNaN(contentLastmod.getTime()))
		res.setHeader('Last-Modified', contentLastmod.toUTCString());
	const shouldGzip = Utils.shouldUseGzipEncoding(req);
	if (cacheFile.endsWith('.gz') && !shouldGzip) {
		fs.createReadStream(cacheFile).pipe(zlib.createGunzip()).pipe(res);
		return;
	}
	if (cacheFile.endsWith('.gz') && shouldGzip) {
		res.setHeader('Content-Encoding', 'gzip');
		res.setHeader('Vary', 'Accept-Encoding');
	}
	fs.createReadStream(cacheFile).pipe(res);
}

async function bookContentLastmod(book) {
	const bookIds = [Number(book.id)].filter(value => Number.isInteger(value));
	if (isDefaultTranslationBook(book))
		bookIds.push(0);
	const row = (await global.query(`
		SELECT MAX(UNIX_TIMESTAMP(content_lastmod) * 1000) AS content_lastmod_ms
		FROM books
		WHERE id IN (${bookIds.map(Number).join(',') || Number(book.id)})
		LIMIT 1`))[0];
	const value = row && Number(row.content_lastmod_ms);
	return Number.isFinite(value) && value > 0 ? new Date(value) : null;
}

function isDefaultTranslationBook(book) {
	const type = book && (book.type || book.book_type || book.book_model);
	return type === 'trans' && book.source === 'default';
}

function isReverseSurahOrder(book) {
	const value = book && book.dir !== undefined && book.dir !== null ? book.dir : book && book.surah_dir;
	return Number(value) === 1;
}

async function hadithBookRows(book) {
	const table = Number(book.virtual) === 1 ? 'v_hadiths_virtual_snapshot' : 'v_hadiths';
	return global.query(`SELECT * FROM ${table} WHERE book_id=${Number(book.id)} ORDER BY ordinal`);
}

function buildBookDocument(book, rows) {
	rows = Array.isArray(rows) ? rows : [];
	const type = book && (book.type || book.book_type || book.book_model || rows[0]?.commentary_type || 'hadith');
	const sourceMetadata = Utils.exportSourceMetadata(book);
	const metadata = compactObject({
		source: compactObject({
			name: sourceMetadata.name,
			publisher: sourceMetadata.publisher,
			url: sourceMetadata.url,
			quranUrl: sourceMetadata.quranUrl,
			primaryUrl: sourceMetadata.primaryUrl,
			description: sourceMetadata.description,
			generatedBy: sourceMetadata.publisher
		}),
		accessibility: bookAccessibilityMetadata()
	});
	const document = compactObject({
		format: DOWNLOAD_SCHEMA_VERSION,
		metadata: metadata,
		source: metadata.source,
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
			description: localizedText(book && book.description, ''),
			death: book && book.death,
			downloads: downloadLinks(book)
		}),
		accessibility: metadata.accessibility,
		description: localizedText(book && book.description, ''),
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

function bookDownloadDocument(book, rows, document, options) {
	const type = book && (book.type || book.book_type || book.book_model || document?.book?.type);
	if (type !== 'tafsir' && type !== 'trans')
		return document;
	let output = type === 'tafsir' ? buildTafsirPassageDocument(book, rows, document) : document;
	output = withCommentaryHeadingContent(output, options?.commentaryHeadings);
	if (type === 'trans' && options?.format === 'epub')
		output = withTranslationEpubPrefatoryBasmalah(rows, output);
	if (options?.format === 'epub')
		output = withCommentaryEpubFrontMatter(output);
	return output;
}

async function commentaryDownloadHeadings(book) {
	const type = book && (book.type || book.book_type || book.book_model);
	if ((type !== 'tafsir' && type !== 'trans') || !Number(book.id))
		return null;
	const [introductions, surahs] = await Promise.all([
		CommentaryHeadings.introductionArticles(book.id),
		CommentaryHeadings.surahIntroductions(book.id)
	]);
	return { introductions, surahs };
}

function withCommentaryHeadingContent(document, headings) {
	if (!headings)
		return document;
	const introductions = (headings.introductions || [])
		.filter(CommentaryHeadings.hasText)
		.map(row => compactObject({
			number: numberOrString(row.h2),
			title: localizedText(row.title_en, row.title),
			intro: localizedText(row.intro_en, row.intro)
		}));
	const surahIntros = new Map((headings.surahs || [])
		.filter(CommentaryHeadings.hasText)
		.map(row => [Number(row.h1), localizedText(row.intro_en, row.intro)]));
	(document.chapters || []).forEach(chapter => {
		const intro = surahIntros.get(Number(chapter.number));
		if (intro)
			chapter.intro = intro;
	});
	const output = { ...document };
	if (introductions.length)
		output.introductions = introductions;
	return output;
}

function withCommentaryEpubFrontMatter(document) {
	const frontMatter = [];
	const description = document.description || document.book?.description;
	if (description && (description.en || description.ar)) {
		frontMatter.push({
			title: localizedText('About this book', ''),
			intro: description,
			sections: [],
			items: []
		});
	}
	(document.introductions || []).forEach(introduction => {
		frontMatter.push({
			number: introduction.number,
			title: introduction.title,
			intro: introduction.intro,
			sections: [],
			items: []
		});
	});
	return frontMatter.length ? { ...document, chapters: frontMatter.concat(document.chapters || []) } : document;
}

function withTranslationEpubPrefatoryBasmalah(rows, document) {
	const source = translationBasmalahSource(rows);
	if (!source)
		return document;
	(document.chapters || []).forEach(chapter => {
		const surah = Number(chapter.number);
		if (!Number.isInteger(surah) || surah === 1 || surah === 9)
			return;
		const item = translationPrefatoryBasmalahItem(source, surah);
		if (item)
			prependItemToFirstQuranGroup(chapter, item);
	});
	return document;
}

function translationBasmalahSource(rows) {
	const row = (Array.isArray(rows) ? rows : []).find(item => {
		return Number(item.surah || item.h1) === 1
			&& Number(item.ayahFrom || item.numInChapter || item.h2) === 1;
	});
	if (!row)
		return null;
	const text = itemTextAndFootnotes(row).text || {};
	const en = Utils.stripQuranDisplayFootnotes(text.en || row.body_en || row.text || row.quran_body_en || '');
	const ar = text.ar || row.quran_body || row.body || '';
	if (!en)
		return null;
	return {
		en: en,
		ar: ar
	};
}

function translationPrefatoryBasmalahItem(source, surah) {
	return compactObject({
		ref: `quran:${surah}:0`,
		text: localizedText(source.en, source.ar),
		quranText: true,
		display: {
			prefatoryBasmalah: true,
			title: false
		}
	});
}

function prependItemToFirstQuranGroup(group, item) {
	if (!group)
		return false;
	if (Array.isArray(group.items) && group.items.length > 0) {
		group.items.unshift(item);
		return true;
	}
	const children = (group.sections || []).concat(group.subsections || []);
	for (const child of children) {
		if (prependItemToFirstQuranGroup(child, item))
			return true;
	}
	return false;
}

function buildTafsirPassageDocument(book, rows, document) {
	rows = Array.isArray(rows) ? rows : [];
	const output = {
		...document,
		chapters: []
	};
	const chapterMap = new Map();
	rows.forEach(row => {
		const chapter = getGroup(chapterMap, chapterKey(row), () => buildChapter(row));
		if (!chapter._sections)
			chapter._sections = new Map();
		const section = getGroup(chapter._sections, tafsirPassageKey(row), () => buildTafsirPassageSection(book, row));
		updateTafsirPassageSectionRange(section, row);
		section.items.push(buildItem(row));
	});
	output.chapters = Array.from(chapterMap.values()).map(finalizeTafsirPassageGroup);
	return output;
}

function tafsirPassageKey(row) {
	return [
		valueKey(row.surah || row.h1 || 'book'),
		valueKey(row.passageNum || row.ayahFrom || row.h2 || row.id || 'passage')
	].join(':');
}

function buildTafsirPassageSection(book, row) {
	const passageNumber = numberOrString(row.passageNum || row.ayahFrom || row.h2);
	const title = tafsirPassageRangeLabel(row) || `Passage ${passageNumber || ''}`.trim();
	return {
		title: localizedText(title, ''),
		path: tafsirPassageUrl(book, row),
		intro: localizedText('', ''),
		subsections: [],
		items: []
	};
}

function updateTafsirPassageSectionRange(section, row) {
	const range = tafsirPassageRange(row);
	if (!range)
		return;
	if (!section._range) {
		section._range = range;
		return;
	}
	if (range.startSurah < section._range.startSurah
		|| range.startSurah === section._range.startSurah && range.startAyah < section._range.startAyah) {
		section._range.startSurah = range.startSurah;
		section._range.startAyah = range.startAyah;
	}
	if (range.endSurah > section._range.endSurah
		|| range.endSurah === section._range.endSurah && range.endAyah > section._range.endAyah) {
		section._range.endSurah = range.endSurah;
		section._range.endAyah = range.endAyah;
	}
	section.title = localizedText(tafsirPassageRangeLabel(section._range), '');
}

function finalizeTafsirPassageGroup(group) {
	applyTafsirPassageRangeTitles(group);
	return finalizeGroup(group);
}

function applyTafsirPassageRangeTitles(group) {
	if (!group)
		return;
	if (group._range) {
		group.title = localizedText(tafsirPassageRangeLabel(group._range), '');
		delete group._range;
	}
	(group._sections ? Array.from(group._sections.values()) : group.sections || []).forEach(applyTafsirPassageRangeTitles);
	(group._subsections ? Array.from(group._subsections.values()) : group.subsections || []).forEach(applyTafsirPassageRangeTitles);
}

function tafsirPassageRangeLabel(value) {
	const range = value && value.startSurah !== undefined ? value : tafsirPassageRange(value);
	if (!range)
		return '';
	const start = `${range.startSurah}:${range.startAyah}`;
	const end = `${range.endSurah}:${range.endAyah}`;
	return start === end ? start : `${start}–${end}`;
}

function tafsirPassageRange(row) {
	const startSurah = Number(row.surah || row.h1);
	const startAyah = Number(row.ayahFrom || row.numInChapter || row.h2);
	const endSurah = Number(row.ayahToSurah || row.surah || row.h1);
	const endAyah = Number(row.ayahTo || row.ayahFrom || row.numInChapter || row.h2);
	if (!Number.isFinite(startSurah) || !Number.isFinite(startAyah) || !Number.isFinite(endSurah) || !Number.isFinite(endAyah))
		return null;
	return { startSurah, startAyah, endSurah, endAyah };
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
		path: sectionUrl(row),
		intro: localizedText(row.h2_intro_en, row.h2_intro),
		subsections: [],
		items: []
	};
}

function buildSubsection(row) {
	return {
		number: numberOrString(row.h3),
		title: localizedText(row.h3_title_en, row.h3_title),
		path: subsectionUrl(row),
		intro: localizedText(row.h3_intro_en, row.h3_intro),
		items: []
	};
}

function sectionUrl(row) {
	if (isQuranCommentary(row) || row.book_alias === 'quran' || Number(row.book_id) === 0)
		return absoluteQuranUrl(row.quran_section_path || quranSectionPath(row));
	return absoluteHadithUrl(hadithSectionPath(row));
}

function subsectionUrl(row) {
	if (isQuranCommentary(row) || row.book_alias === 'quran' || Number(row.book_id) === 0)
		return absoluteQuranUrl(row.quran_section_path || quranSectionPath(row));
	return absoluteHadithUrl(hadithSubsectionPath(row));
}

function tafsirPassageUrl(book, row) {
	const surah = Number(row.surah || row.h1);
	const ayah = Number(row.ayahFrom || row.numInChapter || row.h2);
	if (!Number.isFinite(surah) || !Number.isFinite(ayah))
		return '';
	return absoluteQuranUrl(Tafsir.browseUrl(book, surah, ayah, Tafsir.visibleTafsirsSync()));
}

function quranSectionPath(row) {
	if (row.h1 !== undefined && row.h1 !== null && row.h2 !== undefined && row.h2 !== null && row.h2 !== '')
		return `/quran/${row.h1}/${row.h2}`;
	return row.path || row.ref || '';
}

function hadithSectionPath(row) {
	const value = Utils.trimToEmpty(row.path || '');
	if (value && row.h3 !== undefined && row.h3 !== null && row.h3 !== '')
		return trimPathSegments(value, 3);
	if (value)
		return value;
	if (row.book_alias && row.h1 !== undefined && row.h1 !== null && row.h2 !== undefined && row.h2 !== null && row.h2 !== '')
		return `/${row.book_alias}/${row.h1}/${row.h2}`;
	return '';
}

function hadithSubsectionPath(row) {
	const value = Utils.trimToEmpty(row.path || '');
	if (value)
		return value;
	if (row.book_alias && row.h1 !== undefined && row.h1 !== null && row.h2 !== undefined && row.h2 !== null && row.h2 !== '' && row.h3 !== undefined && row.h3 !== null && row.h3 !== '')
		return `/${row.book_alias}/${row.h1}/${row.h2}/${row.h3}`;
	return hadithSectionPath(row);
}

function trimPathSegments(value, count) {
	value = Utils.trimToEmpty(value);
	if (!value || /^https?:\/\//i.test(value))
		return value;
	const match = value.match(/^([^?#]*)(.*)$/);
	const pathname = match ? match[1] : value;
	const suffix = match ? match[2] : '';
	const prefix = pathname.charAt(0) === '/' ? '/' : '';
	const segments = pathname.replace(/^\/+/, '').split('/').filter(Boolean);
	return `${prefix}${segments.slice(0, count).join('/')}${suffix}`;
}

function buildItem(row) {
	const textAndFootnotes = itemTextAndFootnotes(row);
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
		book: localizedText(row.book_shortName_en || row.book_name_en || row.book_alias, row.book_shortName || row.book_name || row.book_alias),
		title: localizedText(row.title_en || row.part_en || (row.commentary_type ? row.ref || row.num : ''), row.title || row.part),
		chain: localizedText(row.chain_en, row.chain),
		text: textAndFootnotes.text,
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
		footnotes: textAndFootnotes.footnotes,
		grade: localizedText(row.grade_grade_en || row.grade_grades, row.grade_grade),
		grader: localizedText(row.grader_shortName_en || row.grader_name_en, row.grader_shortName || row.grader_name),
		source: hadithSource(row),
		display: itemDisplay(row),
		quranText: isQuranTextItem(row) ? true : undefined
	});
}

function hadithSource(row) {
	if (row.commentary_type || row.ref_ref === undefined && row.book_alias_ref === undefined)
		return undefined;
	return compactObject({
		ref: row.ref_ref || (row.book_alias_ref && row.num_ref ? `${row.book_alias_ref}:${row.num_ref}` : undefined),
		path: row.path_ref ? absoluteHadithUrl(pathOrRef(row.path_ref)) : undefined,
		book: localizedText(row.book_shortName_en_ref || row.book_name_en_ref, row.book_shortName_ref || row.book_name_ref),
		number: numberOrString(row.num_ref)
	});
}

function isQuranCommentary(row) {
	return row.commentary_type === 'trans' || row.commentary_type === 'tafsir';
}

function itemTextAndFootnotes(row) {
	const sourceText = row.commentary_type === 'trans'
		? localizedText(row.body_en || row.text, row.quran_body)
		: localizedText(row.body_en || row.text, row.body || row.text_en);
	const explicitFootnotes = localizedText(row.footnote_en, row.footnote);
	const en = normalizeFootnotedText(sourceText.en, explicitFootnotes.en);
	const ar = normalizeFootnotedText(sourceText.ar, explicitFootnotes.ar);
	return compactObject({
		text: localizedText(en.text, ar.text),
		footnotes: compactObject({
			en: en.footnotes,
			ar: ar.footnotes
		})
	});
}

function normalizeFootnotedText(text, footnotes) {
	text = normalizedString(text);
	footnotes = normalizedString(footnotes);
	const notes = new Map();
	extractMarkdownFootnotes(footnotes).forEach(note => notes.set(note.key, note.text));
	extractMarkdownFootnotes(text).forEach(note => notes.set(note.key, note.text));
	text = removeMarkdownFootnoteDefinitions(text);
	let counter = nextFootnoteNumber(notes);
	text = Utils.trimToEmpty(text).replace(/(?:\\\[|\[)(?:\\\[|\[)([\s\S]*?)(?:\\\]|\])(?:\\\]|\])/g, function (_marker, noteText) {
		noteText = Utils.trimToEmpty(noteText).replace(/\s+/g, ' ');
		if (!noteText)
			return '';
		while (notes.has(counter.toString()))
			counter += 1;
		const key = counter.toString();
		notes.set(key, noteText);
		counter += 1;
		return `[^${key}]`;
	});
	if (notes.size === 0 && footnotes) {
		notes.set('1', footnotes);
		if (text && text.indexOf('[^1]') < 0)
			text = `${text}[^1]`;
	}
	return {
		text: normalizedString(text),
		footnotes: footnoteArray(notes)
	};
}

function extractMarkdownFootnotes(value) {
	value = Utils.trimToEmpty(value);
	if (!value)
		return [];
	const notes = [];
	const pattern = /\[\^([^\]]+)\]:\s*([\s\S]*?)(?=\n\[\^[^\]]+\]:|$)/g;
	let match;
	while ((match = pattern.exec(value)) !== null) {
		const key = Utils.trimToEmpty(match[1]);
		const text = Utils.trimToEmpty(match[2]).replace(/\s+/g, ' ');
		if (key && text)
			notes.push({ key, text });
	}
	return notes;
}

function removeMarkdownFootnoteDefinitions(value) {
	return Utils.trimToEmpty(value).replace(/\[\^([^\]]+)\]:\s*[\s\S]*?(?=\n\[\^[^\]]+\]:|$)/g, '').trim();
}

function nextFootnoteNumber(notes) {
	let max = 0;
	notes.forEach((_text, key) => {
		const numeric = Number(key);
		if (Number.isFinite(numeric))
			max = Math.max(max, numeric);
	});
	return max + 1;
}

function footnoteArray(notes) {
	const output = Array.from(notes.entries()).map(([key, text]) => compactObject({
		key: key,
		text: normalizedString(text)
	})).filter(note => note.text);
	return output.length ? output : undefined;
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

function itemDisplay(row) {
	if (!isQuranTextItem(row))
		return undefined;
	const ayah = numberOrUndefined(row.ayahTo || row.ayahFrom);
	return compactObject({
		title: false,
		quranMarker: ayah ? `\u06dd${Arabic.toArabicDigits(ayah.toString())}` : undefined
	});
}

function bookAccessibilityMetadata() {
	return {
		accessMode: ['textual'],
		accessibilityFeature: ['readingOrder', 'structuralNavigation', 'tableOfContents'],
		accessibilityHazard: ['none'],
		accessModeSufficient: ['textual'],
		accessibilitySummary: 'This download contains structured textual content with table of contents navigation and structured footnotes where notes are present.'
	};
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
			q_start.path AS quran_section_path,
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
		ORDER BY hc.surah ${isReverseSurahOrder(book) ? 'DESC' : 'ASC'}, hc.ayahFrom ASC, hc.ayahTo ASC, hc.id ASC`);
	await attachQuranRanges(rows);
	return rows;
}

async function defaultTranslationBookRows(book) {
	const rows = await global.query(`
		SELECT
			q_start.id,
			q_start.id AS hId,
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
			q_start.path AS quran_section_path,
			q_start.h3_id,
			q_start.h3,
			q_start.h3_title_en,
			q_start.h3_title,
			q_start.ordinal,
			q_start.numInChapter,
			q_start.num,
			q_start.ref,
			q_start.path,
			CONCAT('Quran ', q_start.h1, ':', q_start.numInChapter) AS title_en,
			q_start.h1_title AS title,
			'' AS chain_en,
			q_start.body_en AS body_en,
			q_start.footnote_en AS footnote_en,
			'' AS chain,
			q_start.body AS body,
			q_start.footnote AS footnote,
			q_start.body AS quran_body,
			q_start.body_en AS quran_body_en,
			q_start.h1 AS surah,
			q_start.numInChapter AS ayahFrom,
			q_start.numInChapter AS ayahTo,
			q_start.numInChapter AS passageNum,
			bc.type AS commentary_type,
			bc.lang AS commentary_lang,
			bc.source AS commentary_source,
			bc.format AS commentary_format,
			q_start.lastmod
		FROM books bc
		JOIN v_hadiths q_start ON q_start.book_alias='quran'
		WHERE bc.id=${Number(book.id)}
			AND bc.type='trans'
			AND bc.source='default'
			AND bc.hidden=0
			AND q_start.numInChapter > 0
		ORDER BY q_start.h1 ${isReverseSurahOrder(book) ? 'DESC' : 'ASC'}, q_start.numInChapter ASC`);
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
			CONCAT('quran:', num) AS ref,
			body,
			body_en
		FROM hadiths
		WHERE bookId=0
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
	buildBookDocument,
	bookDownloadDocument,
	downloadLinks,
	hadithDownloadPath,
	relativeDownloadLinks,
	sendHadithBook,
	sendTafsirBook,
	sendTranslationBook,
	tafsirDownloadPath,
	translationDownloadPath
};
