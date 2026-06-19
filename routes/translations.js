'use strict';

const createError = require('http-errors');
const express = require('express');
const Index = require('../lib/Index');
const QuranHeadings = require('../lib/QuranHeadings');
const Utils = require('../lib/Utils');
const { Item } = require('../lib/Model');

const router = express.Router();

router.get('/', function (req, res) {
  res.redirect(302, Utils.quranPath('/quran/translations/1/1'));
});

router.get('/:surah', async function (req, res, next) {
  const surahNum = Number(req.params.surah);
  const surah = (global.surahs || []).find(item => Number(item.num) === surahNum);
  if (!surah)
    return next(createError(404, `Quran surah ${req.params.surah} not found`));
  res.redirect(302, Utils.quranPath(`/quran/translations/${surah.num}/1`));
});

router.get('/:surah/:ayah', async function (req, res, next) {
  res.locals.req = req;
  res.locals.res = res;

  const surahNum = Number(req.params.surah);
  const ayahNum = Number(req.params.ayah);
  const surah = (global.surahs || []).find(item => Number(item.num) === surahNum);
  if (!surah || !Number.isInteger(ayahNum) || ayahNum < 1 || ayahNum > Number(surah.ayahs))
    return next(createError(404, `Quran ayah ${req.params.surah}:${req.params.ayah} not found`));

  const ayahs = await quranAyahs(surahNum, ayahNum, ayahNum);
  const ayah = ayahs.find(item => Number(item.ayah) === ayahNum) || ayahs[0];
  if (!ayah)
    return next(createError(404, `Quran ayah ${req.params.surah}:${req.params.ayah} not found`));

  const [chapter, section] = await Promise.all([
    QuranHeadings.chapter(surahNum),
    QuranHeadings.sectionForAyah(surahNum, ayahNum)
  ]);

  res.render('translation_passage', {
    ayah: ayahNum,
    ayahs: [ayah],
    chapter: chapter,
    navigation: translationNavigation(surahNum, ayahNum),
    section: section,
    surah: surah
  });
});

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
  return rows.map(row => new Item(row)).map(row => ({
    id: row.id,
    ref: row.ref,
    num: row.num,
    ayah: Number(row.numInChapter),
    body: row.ar?.body || row.body || '',
    body_en: row.en?.body || row.body_en || '',
    en: row.en,
    ar: row.ar
  }));
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
    prev: prev ? Utils.quranPath(`/quran/translations/${prev.surah}/${prev.ayah}`) : '',
    prevTitle: prev ? `§${prev.surah}.${prev.ayah}` : '',
    next: next ? Utils.quranPath(`/quran/translations/${next.surah}/${next.ayah}`) : '',
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

module.exports = router;
