/* jslint node:true, esversion:9 */
'use strict';

const debug = require('../lib/Debug')('hadithdb:Books');
const express = require('express');
const Tafsir = require('../lib/Tafsir');
const Utils = require('../lib/Utils');
const BookDownloads = require('../lib/BookDownloads');

const router = express.Router();

async function withContentLanguageBadges(books) {
  if (!books.length)
    return books;
  const physicalIds = books.filter(book => Number(book.virtual) !== 1).map(book => Number(book.id)).filter(Number.isFinite);
  const virtualIds = books.filter(book => Number(book.virtual) === 1).map(book => Number(book.id)).filter(Number.isFinite);
  const englishRows = [];
  if (physicalIds.length)
    englishRows.push(...await global.query(`
      SELECT DISTINCT bookId AS book_id
      FROM hadiths
      WHERE bookId IN (${physicalIds.join(',')})
        AND NULLIF(TRIM(body_en), '') IS NOT NULL
    `));
  if (virtualIds.length)
    englishRows.push(...await global.query(`
      SELECT DISTINCT book_id
      FROM v_hadiths_virtual_snapshot
      WHERE book_id IN (${virtualIds.join(',')})
        AND NULLIF(TRIM(body_en), '') IS NOT NULL
    `));
  const hasEnglish = new Set(englishRows.map(row => Number(row.book_id)));
  return books.map(book => ({
    ...book,
    catalog_language_badge: hasEnglish.has(Number(book.id)) ? 'EN-AR' : ((book.lang || 'ar').toLowerCase() === 'en' ? 'EN' : 'AR')
  }));
}

router.get('/', async function (req, res, next) {
  res.locals.req = req;
  res.locals.res = res;
  var results = global.books.filter(function (val) {
    return (val.hidden == 0 && val.alias !== 'quran' && ['hadith', 'sirah'].includes(val.type || val.book_type || val.book_model || 'hadith'));
  });
  if ('json' in req.query) {
    var tafsirs = await Tafsir.visibleTafsirs();
    tafsirs = await Tafsir.withFirstPassages(tafsirs);
    var translations = await Tafsir.visibleTranslations();
    Utils.sendJsonDownload(res, 'hadithunlocked_books.json', {
      books: results,
      tafsirs: tafsirs,
      translations: translations
    });
  } else if ('tsv' in req.query) {
    res.setHeader('Content-Type', 'text/tab-separated-values; charset=utf-8');
    var keyNames = Object.keys(results[0]);
    if ('keys' in req.query)
      keyNames = req.query.keys.split(/,/);
    res.end(Utils.toTSV(results, keyNames));
  } else {
    results = await withContentLanguageBadges(results);
    var tafsirs = await Tafsir.visibleTafsirs();
    tafsirs = await Tafsir.withFirstPassages(tafsirs);
    var translations = await Tafsir.visibleTranslations();
    res.render('books', {
      BookDownloads: BookDownloads,
      books: results,
      Tafsir: Tafsir,
      tafsirs: tafsirs,
      translations: translations
    });
  }
});

router.get('/tafsir', async function (req, res, next) {
  res.redirect(301, Utils.quranUrl(req, '/quran/tafsir'));
});

module.exports = router;
