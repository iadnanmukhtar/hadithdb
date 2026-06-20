/* jslint node:true, esversion:9 */
'use strict';

const debug = require('../lib/Debug')('hadithdb:Books');
const express = require('express');
const Tafsir = require('../lib/Tafsir');
const Utils = require('../lib/Utils');

const router = express.Router();

router.get('/', async function (req, res, next) {
  res.locals.req = req;
  res.locals.res = res;
  var results = global.books.filter(function (val) {
    return (val.hidden == 0 && val.alias !== 'quran');
  });
  if ('json' in req.query) {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(results));
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
