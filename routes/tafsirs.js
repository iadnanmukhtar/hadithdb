'use strict';

const express = require('express');
const Tafsir = require('../lib/Tafsir');
const Utils = require('../lib/Utils');
const BookDownloads = require('../lib/BookDownloads');

const router = express.Router();

router.get('/:tafsirAlias.:format(json|epub)', BookDownloads.sendTafsirBook);

router.get('/', async function (req, res) {
  if (!('json' in req.query) && !('tsv' in req.query))
    return res.redirect(301, Utils.urlFor(req, '/books?tafsir'));
  var tafsirs = await Tafsir.visibleTafsirs();
  tafsirs = await Tafsir.withFirstPassages(tafsirs);
  if ('json' in req.query) {
    Utils.sendJsonDownload(res, 'hadithunlocked_quran_tafsirs.json', tafsirs);
  } else {
    res.setHeader('Content-Type', 'text/tab-separated-values; charset=utf-8');
    var keyNames = 'keys' in req.query ? req.query.keys.split(/,/) : Object.keys(tafsirs[0] || {});
    res.end(Utils.toTSV(tafsirs, keyNames));
  }
});

module.exports = router;
