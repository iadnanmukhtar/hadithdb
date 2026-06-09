'use strict';

const express = require('express');
const Tafsir = require('../lib/Tafsir');
const Utils = require('../lib/Utils');

const router = express.Router();

router.get('/', async function (req, res, next) {
  res.locals.req = req;
  res.locals.res = res;
  var tafsirs = await Tafsir.visibleTafsirs();
  tafsirs = await withFirstPassages(tafsirs);
  if ('json' in req.query) {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(tafsirs));
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

async function withFirstPassages(tafsirs) {
  const firstPassagesByKey = new Map();
  await Promise.all(tafsirs.map(async function (tafsir) {
    const key = `${tafsir.alias}:${Number(tafsir.surah_dir) || 0}`;
    if (!firstPassagesByKey.has(key))
      firstPassagesByKey.set(key, Tafsir.firstPassage(tafsir));
    const firstPassage = await firstPassagesByKey.get(key);
    tafsir.firstSurah = firstPassage?.surah || 1;
    tafsir.firstAyah = firstPassage?.ayah || 1;
  }));
  return tafsirs;
}

module.exports = router;
