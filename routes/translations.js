'use strict';

const createError = require('http-errors');
const ejs = require('ejs');
const express = require('express');
const Index = require('../lib/Index');
const QuranHeadings = require('../lib/QuranHeadings');
const QuranMushaf = require('../lib/QuranMushaf');
const Tafsir = require('../lib/Tafsir');
const Utils = require('../lib/Utils');
const BookDownloads = require('../lib/BookDownloads');
const HttpRange = require('../lib/HttpRange');
const QuranAyahNavigation = require('../lib/QuranAyahNavigation');
const { invalidateQuranMemoryCaches } = require('../lib/QuranCacheInvalidation');
const { Item } = require('../lib/Model');

const router = express.Router();

router.get('/', async function (req, res) {
  res.locals.req = req;
  res.locals.res = res;

  const translations = await Tafsir.visibleTranslations();
  if ('json' in req.query) {
    Utils.sendJsonDownload(res, 'hadithunlocked_quran_translations.json', translations);
  } else if ('tsv' in req.query) {
    res.setHeader('Content-Type', 'text/tab-separated-values; charset=utf-8');
    var keyNames = Object.keys(translations[0] || {});
    if ('keys' in req.query)
      keyNames = req.query.keys.split(/,/);
    res.end(Utils.toTSV(translations, keyNames));
  } else {
    res.render('translation_books', {
      BookDownloads: BookDownloads,
      translations: translations
    });
  }
});

router.get('/:surah/:ayah', function (req, res, next) {
  const surahNum = Number(req.params.surah);
  const ayahNum = Number(req.params.ayah);
  const surah = (global.surahs || []).find(item => Number(item.num) === surahNum);
  const minimumAyah = surahNum === 1 ? 0 : 1;
  const surahCount = Math.max(0, ...(global.surahs || []).map(item => Number(item.num)).filter(Number.isInteger));
  if (Number.isInteger(surahNum) && (surahNum < 1 || surahNum > surahCount))
    return next(HttpRange.notSatisfiable('quran-surahs', surahCount, `Quran surah ${req.params.surah} is out of range`));
  if (surah && Number.isInteger(ayahNum) && (ayahNum < minimumAyah || ayahNum > Number(surah.ayahs)))
    return next(HttpRange.notSatisfiable('quran-ayahs', Number(surah.ayahs), `Quran ayah ${req.params.surah}:${req.params.ayah} is out of range`));
  if (!surah || !Number.isInteger(surahNum) || !Number.isInteger(ayahNum) ||
      ayahNum < minimumAyah || ayahNum > Number(surah.ayahs))
    return next(createError(404, `Quran ayah ${req.params.surah}:${req.params.ayah} not found`));
  return res.redirect(301, canonicalTranslationUrl(req, surahNum, ayahNum));
});

router.get('/:ref', async function (req, res, next) {
  res.locals.req = req;
  res.locals.res = res;

  const refMatch = /^quran:(\d+):(\d+)$/.exec(req.params.ref);
  const surahNum = refMatch ? Number(refMatch[1]) : NaN;
  const ayahNum = refMatch ? Number(refMatch[2]) : NaN;
  const surah = (global.surahs || []).find(item => Number(item.num) === surahNum);
  const minimumAyah = surahNum === 1 ? 0 : 1;
  const surahCount = Math.max(0, ...(global.surahs || []).map(item => Number(item.num)).filter(Number.isInteger));
  if (refMatch && (surahNum < 1 || surahNum > surahCount))
    return next(HttpRange.notSatisfiable('quran-surahs', surahCount, `Quran surah ${surahNum} is out of range`));
  if (surah && Number.isInteger(ayahNum) && (ayahNum < minimumAyah || ayahNum > Number(surah.ayahs)))
    return next(HttpRange.notSatisfiable('quran-ayahs', Number(surah.ayahs), `Quran ayah ${req.params.ref} is out of range`));
  if (!surah || !Number.isInteger(ayahNum) || ayahNum < minimumAyah || ayahNum > Number(surah.ayahs))
    return next(createError(404, `Quran ayah ${req.params.ref} not found`));
  if (Object.prototype.hasOwnProperty.call(req.query || {}, 'lang'))
    return res.redirect(302, canonicalTranslationUrl(req, surah.num, ayahNum));

  const editMode = req.admin && req.editMode;
  const cachedFile = Utils.htmlCacheFile(req, { includeBaseUrl: true });
  const flushCache = Utils.shouldFlushCache(req);
  if (flushCache) {
    invalidateQuranMemoryCaches();
    await Utils.flushCachedFile(cachedFile, { strict: true });
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  if (!flushCache && !editMode && Utils.cachedTextPathForRead(cachedFile)) {
    if (Utils.sendCachedHtml(res, req, cachedFile, 'text/html; charset=UTF-8'))
      return;
    await Utils.flushCachedFile(cachedFile);
  }

  const ayahs = await quranAyahs(surahNum, ayahNum, ayahNum);
  const ayah = ayahs.find(item => Number(item.ayah) === ayahNum) || ayahs[0];
  if (!ayah)
    return next(createError(404, `Quran ayah ${req.params.surah}:${req.params.ayah} not found`));

  const section = await QuranHeadings.sectionForAyah(surahNum, ayahNum);
  const chapter = section
    ? await section.getChapter()
    : await QuranHeadings.chapter(surahNum);
  if (chapter && typeof chapter.getSections === 'function')
    await chapter.getSections();
  if (section)
    section.mushafPage = await QuranMushaf.pageForRef(surahNum, ayahNum);

  const renderLocals = {
    Tafsir: Tafsir,
    ayah: ayahNum,
    ayahs: [ayah],
    chapter: chapter,
    navigation: translationNavigation(surahNum, ayahNum),
    section: section,
    surah: surah
  };

  if (!editMode && Utils.diskCacheEnabled()) {
    const html = await ejs.renderFile(`${__dirname}/../views/translation_passage.ejs`, Utils.cachedRenderLocals(res, {
      noadmin: true,
      ...renderLocals
    }));
    Utils.writeCachedHtml(cachedFile, html);
    await Utils.indexCachedItem([
      `quran:${surahNum}:${ayahNum}`,
      `quran:surah:${surahNum}`,
      `translations:quran:${surahNum}:${ayahNum}`
    ], cachedFile);
    if (Utils.sendCachedHtml(res, req, cachedFile, 'text/html; charset=UTF-8'))
      return;
  }

  res.render('translation_passage', renderLocals);
});

function canonicalTranslationUrl(req, surah, ayah) {
  const params = new URLSearchParams();
  Object.entries(req.query || {}).forEach(([key, value]) => {
    if (key === 'lang')
      return;
    if (Array.isArray(value))
      value.forEach(item => params.append(key, item));
    else if (value !== undefined)
      params.append(key, value);
  });
  const query = params.toString();
  return Utils.quranPath(`/quran/translations/quran:${surah}:${ayah}${query ? `?${query}` : ''}`);
}

async function quranAyahs(surah, startAyah, endAyah) {
  let rows;
  try {
    rows = await Index.docsFromQueryString(
      Item.INDEX,
      `book_alias:quran AND h1:${Number(surah)} AND numInChapter:[${Number(startAyah)} TO ${Number(endAyah)}]`,
      0,
      endAyah - startAyah + 1,
      'numInChapter'
    );
  } catch (err) {
    if (!isSearchBackendUnavailable(err) || typeof global.query !== 'function')
      throw err;
    rows = await quranAyahsFromDb(surah, startAyah, endAyah);
  }
  return rows.map(row => new Item(row)).map(row => {
    const ayah = Number(row.numInChapter);
    return {
      id: row.id,
      ref: row.ref,
      num: row.num,
      ayah: ayah,
      body: row.ar?.body || row.body || '',
      body_en: row.en?.body || row.body_en || '',
      en: row.en,
      ar: row.ar,
      prev_ref: quranAdjacentRef(surah, ayah, -1),
      next_ref: quranAdjacentRef(surah, ayah, 1)
    };
  });
}

async function quranAyahsFromDb(surah, startAyah, endAyah) {
  return global.query(`
    SELECT *
    FROM v_hadiths
    WHERE book_alias='quran'
      AND h1=${Number(surah)}
      AND numInChapter BETWEEN ${Number(startAyah)} AND ${Number(endAyah)}
    ORDER BY numInChapter ASC`);
}

function isSearchBackendUnavailable(err) {
  const status = err && (err.status || err.statusCode);
  return [502, 503, 504].includes(Number(status));
}

function translationNavigation(surah, ayah) {
  const prev = adjacentQuranAyah(surah, ayah, -1);
  const next = adjacentQuranAyah(surah, ayah, 1);
  return {
    prev: prev ? Utils.quranPath(`/quran/translations/quran:${prev.surah}:${prev.ayah}`) : '',
    prevTitle: prev ? `§${prev.surah}.${prev.ayah}` : '',
    next: next ? Utils.quranPath(`/quran/translations/quran:${next.surah}:${next.ayah}`) : '',
    nextTitle: next ? `§${next.surah}.${next.ayah}` : ''
  };
}

function adjacentQuranAyah(surah, ayah, direction) {
	return QuranAyahNavigation.adjacent(surah, ayah, direction);
}

function quranAdjacentRef(surah, ayah, direction) {
  const adjacent = adjacentQuranAyah(surah, ayah, direction);
  return adjacent ? `quran:${adjacent.surah}:${adjacent.ayah}` : '';
}

module.exports = router;
