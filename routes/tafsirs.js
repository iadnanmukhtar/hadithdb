'use strict';

const ejs = require('ejs');
const express = require('express');
const Tafsir = require('../lib/Tafsir');
const Utils = require('../lib/Utils');
const BookDownloads = require('../lib/BookDownloads');
const { invalidateQuranMemoryCaches } = require('../lib/QuranCacheInvalidation');

const router = express.Router();

router.get('/:tafsirAlias.:format(json|epub)', BookDownloads.sendTafsirBook);

router.get('/', async function (req, res, next) {
  res.locals.req = req;
  res.locals.res = res;

  const editMode = req.admin && req.editMode;
  const cacheableHtml = !('json' in req.query) && !('tsv' in req.query);
  const cachedFile = Utils.htmlCacheFile(req, { includeBaseUrl: true });
  const flushCache = Utils.shouldFlushCache(req);
  if (flushCache) {
    invalidateQuranMemoryCaches({ allMushaf: true });
    await Utils.flushCachedFile(cachedFile, { strict: true });
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  if (cacheableHtml && !flushCache && !editMode && Utils.cachedTextPathForRead(cachedFile)) {
    if (Utils.sendCachedHtml(res, req, cachedFile, 'text/html; charset=UTF-8'))
      return;
    await Utils.flushCachedFile(cachedFile);
  }

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
    const renderLocals = {
      BookDownloads: BookDownloads,
      Tafsir: Tafsir,
      tafsirs: tafsirs
    };
    if (!editMode && Utils.diskCacheEnabled()) {
      const html = await ejs.renderFile(`${__dirname}/../views/tafsir_books.ejs`, Utils.cachedRenderLocals(res, {
        noadmin: true,
        ...renderLocals
      }));
      Utils.writeCachedHtml(cachedFile, html);
      await Utils.indexCachedItem(tafsirBookCacheRefs(tafsirs), cachedFile);
      if (Utils.sendCachedHtml(res, req, cachedFile, 'text/html; charset=UTF-8'))
        return;
    }
    res.render('tafsir_books', renderLocals);
  }
});

function tafsirBookCacheRefs(tafsirs) {
  const refs = new Set(['tafsirs', 'tafsir:books']);
  (tafsirs || []).forEach(function (tafsir) {
    refs.add(`tafsir:${tafsir.alias}:catalog`);
    refs.add(`tafsir:${tafsir.slug || Tafsir.tafsirSlug(tafsir.alias)}:catalog`);
  });
  return Array.from(refs);
}

module.exports = router;
