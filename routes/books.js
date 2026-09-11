/* jslint node:true, esversion:9 */
'use strict';

const debug = require('../lib/Debug')('hadithdb:Books');
const ejs = require('ejs');
const express = require('express');
const Index = require('../lib/Index');
const Tafsir = require('../lib/Tafsir');
const Utils = require('../lib/Utils');
const BookDownloads = require('../lib/BookDownloads');

const router = express.Router();

async function withContentLanguageBadges(books) {
  if (!books.length)
    return books;
  let englishBookAliases;
  try {
    englishBookAliases = await Index.distinctTermsFromQuery('hadiths', {
      bool: {
        filter: [
          { exists: { field: 'body_en' } }
        ]
      }
    }, 'book_alias', Math.max(100, books.length));
  } catch (err) {
    debug.error(`catalog language badge index lookup failed; using database fallback: ${err.message}\n${err.stack || ''}`);
  }
  if (Array.isArray(englishBookAliases))
    return applyContentLanguageBadges(books, englishBookAliases, 'alias');

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
  return applyContentLanguageBadges(books, englishRows.map(row => row.book_id), 'id');
}

function applyContentLanguageBadges(books, englishBooks, key) {
  const normalize = key === 'id' ? Number : String;
  const hasEnglish = new Set(englishBooks.map(normalize));
  return books.map(book => ({
    ...book,
    catalog_language_badge: hasEnglish.has(normalize(book[key])) ? 'EN-AR' : ((book.lang || 'ar').toLowerCase() === 'en' ? 'EN' : 'AR')
  }));
}

router.get('/', async function (req, res, next) {
  res.locals.req = req;
  res.locals.res = res;
  const editMode = req.admin && req.editMode;
  const cacheableHtml = !('json' in req.query) && !('tsv' in req.query) && !('tab' in req.query);
  const cachedFile = Utils.cacheFileFromFilename('_books');
  const flushCache = Utils.shouldFlushCache(req);
  if (flushCache) {
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
    const renderLocals = {
      BookDownloads: BookDownloads,
      books: results,
      Tafsir: Tafsir,
      tafsirs: tafsirs,
      translations: translations
    };
    if (!editMode && Utils.diskCacheEnabled() && cacheableHtml) {
      const html = await ejs.renderFile(`${__dirname}/../views/books.ejs`, Utils.cachedRenderLocals(res, {
        noadmin: true,
        ...renderLocals
      }));
      Utils.writeCachedHtml(cachedFile, html);
      await Utils.indexCachedItem(bookCatalogCacheRefs(results, tafsirs, translations), cachedFile);
      if (Utils.sendCachedHtml(res, req, cachedFile, 'text/html; charset=UTF-8'))
        return;
    }
    res.render('books', renderLocals);
  }
});

function bookCatalogCacheRefs(books, tafsirs, translations) {
  const refs = new Set(['books', 'tafsirs', 'tafsir:books', 'translations:books']);
  (books || []).forEach(book => refs.add(book.alias));
  (tafsirs || []).forEach(book => refs.add(`tafsir:${book.alias}:catalog`));
  (translations || []).forEach(book => refs.add(`translation:${book.alias}:catalog`));
  return Array.from(refs);
}

router.get('/tafsir', async function (req, res, next) {
  res.redirect(301, Utils.quranUrl(req, '/quran/tafsir'));
});

module.exports = router;
