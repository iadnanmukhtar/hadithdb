/* jslint node:true, esversion:9 */
'use strict';

const debug = require('../lib/Debug')('hadithdb:Books');
const express = require('express');
const Tafsir = require('../lib/Tafsir');
const Utils = require('../lib/Utils');
const BookDownloads = require('../lib/BookDownloads');

const router = express.Router();

router.get('/', async function (req, res, next) {
  res.locals.req = req;
  res.locals.res = res;
  var results = global.books.filter(function (val) {
    return (val.hidden == 0 && val.alias !== 'quran' && (val.type || val.book_type || val.book_model || 'hadith') === 'hadith');
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
