'use strict';

const express = require('express');
const Tafsir = require('../lib/Tafsir');
const Utils = require('../lib/Utils');

const router = express.Router();

router.get('/', async function (req, res, next) {
  res.locals.req = req;
  res.locals.res = res;

  var tafsirs = await Tafsir.visibleTafsirs();
  tafsirs = await Tafsir.withFirstPassages(tafsirs);
  if ('json' in req.query) {
    Utils.sendJsonDownload(res, 'hadithunlocked_quran_tafsirs.json', tafsirs);
  } else if ('tsv' in req.query) {
    res.setHeader('Content-Type', 'text/tab-separated-values; charset=utf-8');
    var keyNames = Object.keys(tafsirs[0] || {});
    if ('keys' in req.query)
      keyNames = req.query.keys.split(/,/);
    res.end(Utils.toTSV(tafsirs, keyNames));
  } else {
    res.render('tafsir_books', {
      Tafsir: Tafsir,
      tafsirs: tafsirs
    });
  }
});

module.exports = router;
