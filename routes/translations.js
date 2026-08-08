'use strict';

const createError = require('http-errors');
const express = require('express');
const Index = require('../lib/Index');
const QuranHeadings = require('../lib/QuranHeadings');
const QuranMushaf = require('../lib/QuranMushaf');
const Tafsir = require('../lib/Tafsir');
const Utils = require('../lib/Utils');
const BookDownloads = require('../lib/BookDownloads');
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
  if (!surah || !Number.isInteger(surahNum) || !Number.isInteger(ayahNum) ||
      ayahNum < 1 || ayahNum > Number(surah.ayahs))
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
  if (!surah || !Number.isInteger(ayahNum) || ayahNum < 1 || ayahNum > Number(surah.ayahs))
    return next(createError(404, `Quran ayah ${req.params.ref} not found`));
  if (Object.prototype.hasOwnProperty.call(req.query || {}, 'lang'))
    return res.redirect(302, canonicalTranslationUrl(req, surah.num, ayahNum));

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

  res.render('translation_passage', {
    Tafsir: Tafsir,
    ayah: ayahNum,
    ayahs: [ayah],
    chapter: chapter,
    navigation: translationNavigation(surahNum, ayahNum),
    section: section,
    surah: surah
  });
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
  surah = Number(surah);
  ayah = Number(ayah);
  direction = direction > 0 ? 1 : -1;
  const currentSurah = (global.surahs || []).find(item => Number(item.num) === surah);
  if (!currentSurah)
    return null;
  if (direction > 0 && ayah < Number(currentSurah.ayahs))
    return { surah: surah, ayah: ayah + 1 };
  if (direction < 0 && ayah > 1)
    return { surah: surah, ayah: ayah - 1 };
  const nextSurah = (global.surahs || []).find(item => Number(item.num) === surah + direction);
  if (!nextSurah)
    return null;
  return {
    surah: Number(nextSurah.num),
    ayah: direction > 0 ? 1 : Number(nextSurah.ayahs)
  };
}

function quranAdjacentRef(surah, ayah, direction) {
  const adjacent = adjacentQuranAyah(surah, ayah, direction);
  return adjacent ? `quran:${adjacent.surah}:${adjacent.ayah}` : '';
}

module.exports = router;
