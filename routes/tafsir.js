'use strict';

const createError = require('http-errors');
const ejs = require('ejs');
const express = require('express');
const fs = require('fs');
const { homedir } = require('os');
const Arabic = require('../lib/Arabic');
const Index = require('../lib/Index');
const Tafsir = require('../lib/Tafsir');
const Utils = require('../lib/Utils');
const { Item } = require('../lib/Model');

const router = express.Router();
const TAFSIR_PASSAGE_CACHE_SUFFIX = '.tafsir-v7-first-ayah-ref-only';

router.get('/:tafsir/sections', async function (req, res, next) {
  res.locals.req = req;
  res.locals.res = res;

  const tafsir = await Tafsir.resolveTafsir(req.params.tafsir, req.query.lang);
  if (!tafsir)
    return next(createError(404, `Tafsīr '${req.params.tafsir}' not found`));

  const surahNum = req.query.surah ? Number(req.query.surah) : null;
  if (req.query.surah && (!Number.isInteger(surahNum) || surahNum < 1 || surahNum > 114))
    return next(createError(404, `Quran surah ${req.query.surah} not found`));

  const tafsirPath = `/quran/tafsir/${encodeURIComponent(tafsir.slug || tafsir.alias)}`;
  const sections = (await Tafsir.sectionMenu(tafsir)).filter(function (section) {
    return !surahNum || Number(section.surah) === surahNum;
  }).map(function (section) {
    const rangeLabel = tafsirRangeLabel(section);
    return {
      index: section.index,
      url: `${tafsirPath}/${section.surah}/${section.ayahFrom}`,
      rangeLabel: rangeLabel,
      rangeLabelAr: Arabic.toArabicDigits(rangeLabel),
      ayahRangeLabel: section.ayahTo > section.ayahFrom ? 'Ayat' : 'Ayah',
      title_en: Utils.truncate(tafsirSectionTitle(section, 'en'), 75, true),
      title: Utils.truncate(tafsirSectionTitle(section, 'ar'), 150, true)
    };
  });

  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.json({ sections: sections });
});

router.get('/:tafsir', async function (req, res, next) {
  res.locals.req = req;
  res.locals.res = res;

  const tafsir = await Tafsir.resolveTafsir(req.params.tafsir, req.query.lang);
  if (!tafsir)
    return next(createError(404, `Tafsīr '${req.params.tafsir}' not found`));

  const passage = await Tafsir.firstPassage(tafsir);
  if (!passage)
    return next(createError(404, `Tafsīr '${req.params.tafsir}' has no passages`));

  const allTafsirs = await Tafsir.visibleTafsirs();
  res.redirect(302, Utils.quranPath(Tafsir.browseUrl(tafsir, passage.surah, passage.ayah, allTafsirs)));
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

router.get('/:tafsir/:surah/:ayah', async function (req, res, next) {
  res.locals.req = req;
  res.locals.res = res;
  const editMode = req.admin && req.editMode;
  const cachedFile = `${homedir}/.hadithdb/cache/${tafsirReqToFilename(req)}${TAFSIR_PASSAGE_CACHE_SUFFIX}.html`;
  if ('flush' in req.query)
    await Utils.flushCachedFile(cachedFile);
  if (!('flush' in req.query) && !editMode && fs.existsSync(cachedFile)) {
    sendCachedHtml(req, res, cachedFile);
    return;
  }

  const surahNum = Number(req.params.surah);
  const ayahNum = Number(req.params.ayah);
  const surah = (global.surahs || []).find(item => Number(item.num) === surahNum);
  if (!surah || !Number.isInteger(ayahNum) || ayahNum < 1 || ayahNum > Number(surah.ayahs))
    return next(createError(404, `Quran ayah ${req.params.surah}:${req.params.ayah} not found`));

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
  const navigation = await tafsirNavigation(tafsir, entries, allTafsirs);

  const renderLocals = {
    Tafsir: Tafsir,
    ayah: ayahNum,
    ayahs: ayahs,
    entries: entries,
    navigation: navigation,
    surah: surah,
    tafsir: tafsir
  };

  if (!editMode) {
    const cachedHtml = await ejs.renderFile(`${__dirname}/../views/tafsir_passage.ejs`, {
      ...renderLocals,
      noadmin: true,
      req: req,
      res: res
    });
    fs.writeFileSync(cachedFile, cachedHtml);
    Utils.indexCachedItem(tafsirCacheRefs(tafsir, entries, surahNum, ayahNum), cachedFile);
  }

  res.render('tafsir_passage', renderLocals);
});

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
  return rows.map(row => new Item(row)).map(row => ({
    num: row.num,
    ayah: Number(row.numInChapter),
    body: row.ar?.body || row.body || '',
    body_en: row.en?.body || row.body_en || ''
  }));
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

function sendCachedHtml(req, res, cachedFile) {
  res.setHeader('Content-Type', 'text/html; charset=UTF-8');
  res.end(Utils.injectCachedAdminControls(fs.readFileSync(cachedFile), req));
}

function tafsirReqToFilename(req) {
  var name = `${req.baseUrl || ''}${req.url}`.replace(/\//g, '_');
  name = name.replace(/\?o=0/g, '');
  return name;
}

async function tafsirNavigation(tafsir, entries, tafsirs) {
  const prev = await Tafsir.adjacentPassage(tafsir, entries, -1);
  const next = await Tafsir.adjacentPassage(tafsir, entries, 1);
  return {
    prev: prev ? navigationTarget(tafsir, prev.surah, prev.ayah, tafsirs) : '',
    prevTitle: prev ? `${prev.surah}:${prev.ayah}` : '',
    next: next ? navigationTarget(tafsir, next.surah, next.ayah, tafsirs) : '',
    nextTitle: next ? `${next.surah}:${next.ayah}` : ''
  };
}

function navigationTarget(tafsir, surah, ayah, tafsirs) {
  const url = Tafsir.browseUrl(tafsir, surah, ayah, tafsirs);
  return Utils.quranPath(url);
}

function tafsirRangeLabel(section) {
  return `${section.surah}:${section.ayahFrom}${section.ayahTo > section.ayahFrom ? `-${section.ayahTo}` : ''}`;
}

function tafsirSectionTitle(section, lang) {
  const sectionSurah = (global.surahs || []).find(function (item) {
    return Number(item.num) === Number(section.surah);
  });
  if (lang === 'ar')
    return section.title || (sectionSurah ? `سورة ${sectionSurah.name_ar}` : '');
  return section.title_en || (sectionSurah ? `Surat ${sectionSurah.name_en}` : '');
}

function tafsirCacheRefs(tafsir, entries, surah, ayah) {
  const refs = new Set([
    `tafsir:${tafsir.alias}`,
    `tafsir:${tafsir.slug || Tafsir.tafsirSlug(tafsir.alias)}`,
    `quran:${surah}:${ayah}`
  ]);
  (entries || []).forEach(function (entry) {
    const startAyah = Number(entry.startAyah);
    const endAyah = Number(entry.endAyah);
    if (!Number.isInteger(startAyah) || !Number.isInteger(endAyah))
      return;
    refs.add(`quran:${entry.surah}:${startAyah}${endAyah > startAyah ? `-${endAyah}` : ''}`);
    for (let entryAyah = startAyah; entryAyah <= endAyah; entryAyah++)
      refs.add(`quran:${entry.surah}:${entryAyah}`);
  });
  return Array.from(refs);
}

module.exports = router;
