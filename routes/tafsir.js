'use strict';

const createError = require('http-errors');
const express = require('express');
const ejs = require('ejs');
const fs = require('fs');
const Index = require('../lib/Index');
const QuranHeadings = require('../lib/QuranHeadings');
const Tafsir = require('../lib/Tafsir');
const Utils = require('../lib/Utils');
const BookDownloads = require('../lib/BookDownloads');
const QuranTocSubdivisions = require('../lib/QuranTocSubdivisions');
const { Item, Library } = require('../lib/Model');

const router = express.Router();

router.get('/:tafsir', async function (req, res, next) {
  res.locals.req = req;
  res.locals.res = res;

  const tafsir = await Tafsir.resolveTafsir(req.params.tafsir, req.query.lang);
  if (!tafsir)
    return next(createError(404, `Tafsīr '${req.params.tafsir}' not found`));

  await renderTafsirBookToc(req, res, tafsir);
});

router.get('/:tafsir/:surah', async function (req, res, next) {
  res.locals.req = req;
  res.locals.res = res;

  const tafsir = await Tafsir.resolveTafsir(req.params.tafsir, req.query.lang);
  if (!tafsir)
    return next(createError(404, `Tafsīr '${req.params.tafsir}' not found`));

  const surahNum = Number(req.params.surah);
  const surah = (global.surahs || []).find(item => Number(item.num) === surahNum);
  if (!surah)
    return next(createError(404, `Quran surah ${req.params.surah} not found`));

  const passage = await Tafsir.firstPassageInSurah(tafsir, surahNum);
  if (!passage)
    return next(createError(404, `${tafsir.shortName_en || tafsir.alias} has no passages for Surah ${surahNum}`));

  const allTafsirs = await Tafsir.visibleTafsirs();
  res.redirect(302, Utils.quranPath(Tafsir.browseUrl(tafsir, passage.surah, passage.ayah, allTafsirs)));
});

router.get('/:tafsir/:surah/:section', async function (req, res, next) {
  res.locals.req = req;
  res.locals.res = res;
  const editMode = req.admin && req.editMode;
  const cachedFile = cachedRequestFile(req);
  const flushCache = Utils.shouldFlushCache(req);
  if (flushCache)
    await Utils.flushCachedFile(cachedFile);
  if (!flushCache && !editMode && Utils.cachedTextPathForRead(cachedFile)) {
    sendCachedHtml(req, res, cachedFile);
    return;
  }

  const surahNum = Number(req.params.surah);
  const ayahNum = Number(req.params.section);
  const surah = (global.surahs || []).find(item => Number(item.num) === surahNum);
  if (!surah || !Number.isInteger(ayahNum) || ayahNum < 1 || ayahNum > Number(surah.ayahs))
    return next(createError(404, `Quran ayah ${req.params.surah}:${req.params.section} not found`));

  const tafsir = await Tafsir.resolveTafsir(req.params.tafsir, req.query.lang);
  if (!tafsir)
    return next(createError(404, `Tafsīr '${req.params.tafsir}' not found`));

  let entries;
  try {
    entries = await Tafsir.tafsirEntries(tafsir, surahNum, ayahNum, {
      editMode: editMode
    });
  } catch (err) {
    return next(createError(503, `Unable to load ${tafsir.shortName_en || tafsir.alias} for ${surahNum}:${ayahNum}`, {
      cause: err
    }));
  }

  const entryStart = entries.length ? Math.min(...entries.map(entry => entry.startAyah)) : ayahNum;
  const entryEnd = entries.length ? Math.max(...entries.map(entry => entry.endAyah)) : ayahNum;
  const ayahs = await quranAyahs(surahNum, entryStart, entryEnd);
  const allTafsirs = await Tafsir.visibleTafsirs();
  const [chapter, section] = await Promise.all([
    QuranHeadings.chapter(surahNum),
    QuranHeadings.sectionForAyah(surahNum, ayahNum)
  ]);
  const navigationEntries = entries.length || tafsir.source !== 'local'
    ? entries
    : await Tafsir.tafsirEntries(tafsir, surahNum, ayahNum, {
      editMode: editMode,
      includeEmpty: true
    });
  const navigation = await tafsirNavigation(tafsir, navigationEntries, allTafsirs, surahNum, ayahNum);

  const renderLocals = {
    BookDownloads: BookDownloads,
    Tafsir: Tafsir,
    ayah: ayahNum,
    ayahs: ayahs,
    chapter: chapter,
    entries: entries,
    navigation: navigation,
    section: section,
    surah: surah,
    tafsir: tafsir
  };

  if (!editMode) {
    const refs = [
      `quran:${surahNum}:${ayahNum}`,
      `tafsir:${tafsir.alias}`,
      `tafsir:${tafsir.slug || Tafsir.tafsirSlug(tafsir.alias)}`
    ];
    const html = await ejs.renderFile(`${__dirname}/../views/tafsir_passage.ejs`, cachedRenderLocals(res, {
      noadmin: true,
      ...renderLocals
    }));
    Utils.writeCachedHtml(cachedFile, html);
    await Utils.indexCachedItem(refs, cachedFile);
  }

  res.render('tafsir_passage', renderLocals);
});

async function renderTafsirBookToc(req, res, tafsir) {
  const quranBook = (global.books || []).find(book => book && book.alias === 'quran' && Number(book.hidden) === 0);
  if (!quranBook)
    throw createError(404, `Book 'quran' does not exist`);

  const toc = await Library.instance.findBook('quran').getChapters();
  const tafsirs = await Tafsir.visibleTafsirs();
  const quranJuzRows = await QuranTocSubdivisions.juzRows();
  const quranManzilRows = await QuranTocSubdivisions.manzilRows();
  const quranSectionRangesBySurah = await QuranTocSubdivisions.quranSectionRangesBySurah();
  const quranTocDefaultView = (req.query.toc || req.query.view || req.query.tab || 'juz').toString();
  const renderLocals = {
    book: quranBook,
    surahs: global.surahs || [],
    quranJuzRows: quranJuzRows,
    quranManzilRows: quranManzilRows,
    quranSectionRangesBySurah: quranSectionRangesBySurah,
    quranTocDefaultView: quranTocDefaultView,
    BookDownloads: BookDownloads,
    prevBook: null,
    nextBook: null,
    toc: toc,
    random: undefined,
    Tafsir: Tafsir,
    tafsirs: tafsirs,
    quranCommentaryBooks: tafsirs,
    quranCommentaryBook: tafsir
  };

  res.render('toc', renderLocals);
}

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
  return rows.map(row => new Item(row)).map(row => {
    const ayah = Number(row.numInChapter);
    return {
      id: row.id,
      ref: row.ref,
      num: row.num,
      ayah: ayah,
      body: row.ar?.body || row.body || '',
      body_en: row.en?.body || row.body_en || '',
      en: row.en,
      ar: row.ar,
      prev_ref: quranAdjacentRef(surah, ayah, -1),
      next_ref: quranAdjacentRef(surah, ayah, 1)
    };
  });
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

async function tafsirNavigation(tafsir, entries, tafsirs, surah, ayah) {
  const currentRef = tafsir.source !== 'local' ? { surah: surah, ayah: ayah } : null;
  const prev = await Tafsir.adjacentPassage(tafsir, entries, -1, currentRef);
  const next = await Tafsir.adjacentPassage(tafsir, entries, 1, currentRef);
  return {
    prev: prev ? navigationTarget(tafsir, prev.surah, prev.ayah, tafsirs) : '',
    prevTitle: prev ? `§${prev.surah}.${prev.ayah}` : '',
    next: next ? navigationTarget(tafsir, next.surah, next.ayah, tafsirs) : '',
    nextTitle: next ? `§${next.surah}.${next.ayah}` : ''
  };
}

function tafsirEditNavigation(tafsir, surah, ayah, tafsirs) {
  const prev = adjacentQuranAyah(tafsir, surah, ayah, -1);
  const next = adjacentQuranAyah(tafsir, surah, ayah, 1);
  return {
    prev: prev ? navigationTarget(tafsir, prev.surah, prev.ayah, tafsirs) : '',
    prevTitle: prev ? `§${prev.surah}.${prev.ayah}` : '',
    next: next ? navigationTarget(tafsir, next.surah, next.ayah, tafsirs) : '',
    nextTitle: next ? `§${next.surah}.${next.ayah}` : ''
  };
}

function adjacentQuranAyah(tafsir, surah, ayah, direction) {
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
  const nextSurahNum = surah + (direction * (Number(tafsir && tafsir.surah_dir) === 1 ? -1 : 1));
  const nextSurah = (global.surahs || []).find(item => Number(item.num) === nextSurahNum);
  if (!nextSurah)
    return null;
  return {
    surah: Number(nextSurah.num),
    ayah: direction > 0 ? 1 : Number(nextSurah.ayahs)
  };
}

function quranAdjacentRef(surah, ayah, direction) {
  surah = Number(surah);
  ayah = Number(ayah);
  direction = direction > 0 ? 1 : -1;
  const currentSurah = (global.surahs || []).find(item => Number(item.num) === surah);
  if (!currentSurah)
    return '';
  if (direction > 0 && ayah < Number(currentSurah.ayahs))
    return `quran:${surah}:${ayah + 1}`;
  if (direction < 0 && ayah > 1)
    return `quran:${surah}:${ayah - 1}`;
  const nextSurah = (global.surahs || []).find(item => Number(item.num) === surah + direction);
  if (!nextSurah)
    return '';
  return `quran:${Number(nextSurah.num)}:${direction > 0 ? 1 : Number(nextSurah.ayahs)}`;
}

function navigationTarget(tafsir, surah, ayah, tafsirs) {
  const url = Tafsir.browseUrl(tafsir, surah, ayah, tafsirs);
  return Utils.quranPath(url);
}

function sendCachedHtml(req, res, cachedFile) {
  Utils.sendCachedHtml(res, req, cachedFile, 'text/html; charset=UTF-8');
}

function cachedRenderLocals(res, locals) {
  return Object.assign(
    {},
    res.app ? res.app.locals : {},
    res.locals || {},
    locals || {}
  );
}

function cachedRequestFile(req) {
  return Utils.cacheFileFromFilename(Utils.cacheReqToFilename({
    ...req,
    url: req.originalUrl || req.url || ''
  }), 'html');
}

module.exports = router;
