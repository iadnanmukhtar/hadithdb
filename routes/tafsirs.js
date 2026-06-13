'use strict';

const ejs = require('ejs');
const express = require('express');
const fs = require('fs');
const { homedir } = require('os');
const Tafsir = require('../lib/Tafsir');
const Utils = require('../lib/Utils');

const router = express.Router();
const TAFSIR_BOOKS_CACHE_SUFFIX = '.tafsir-books-v5-collapsible-sections';

router.get('/', async function (req, res, next) {
  res.locals.req = req;
  res.locals.res = res;
  const admin = req.admin;
  const editMode = admin && req.editMode;
  const cacheableHtml = !('json' in req.query) && !('tsv' in req.query);
  const cachedFile = `${homedir}/.hadithdb/cache/${tafsirBooksReqToFilename(req)}${TAFSIR_BOOKS_CACHE_SUFFIX}.html`;
  const flushCache = Utils.shouldFlushCache(req);
  if (flushCache)
    await Utils.flushCachedFile(cachedFile);
  if (cacheableHtml && !flushCache && !editMode && fs.existsSync(cachedFile)) {
    sendCachedHtml(req, res, cachedFile);
    return;
  }

  var tafsirs = await Tafsir.visibleTafsirs();
  tafsirs = await Tafsir.withFirstPassages(tafsirs);
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
    if (!editMode) {
      const html = await ejs.renderFile(`${__dirname}/../views/tafsir_books.ejs`, {
        noadmin: true,
        req: req,
        res: res,
        Tafsir: Tafsir,
        tafsirs: tafsirs
      });
      ensureCacheDir();
      fs.writeFileSync(cachedFile, html);
      await Utils.indexCachedItem(tafsirBookCacheRefs(tafsirs), cachedFile);
    }
    res.render('tafsir_books', {
      Tafsir: Tafsir,
      tafsirs: tafsirs
    });
  }
});

function sendCachedHtml(req, res, cachedFile) {
  res.setHeader('Content-Type', 'text/html; charset=UTF-8');
  res.end(Utils.injectCachedAdminControls(fs.readFileSync(cachedFile), req));
}

function tafsirBooksReqToFilename(req) {
  return Utils.cacheReqToFilename({ url: `${req.baseUrl || ''}${req.url}` });
}

function tafsirBookCacheRefs(tafsirs) {
  const refs = new Set(['tafsirs', 'tafsir:books']);
  (tafsirs || []).forEach(function (tafsir) {
    refs.add(`tafsir:${tafsir.alias}`);
    refs.add(`tafsir:${tafsir.slug || Tafsir.tafsirSlug(tafsir.alias)}`);
  });
  return Array.from(refs);
}

function ensureCacheDir() {
  fs.mkdirSync(`${homedir}/.hadithdb/cache`, { recursive: true });
}

module.exports = router;
