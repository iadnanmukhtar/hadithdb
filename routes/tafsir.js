'use strict';

const createError = require('http-errors');
const ejs = require('ejs');
const express = require('express');
const fs = require('fs');
const Index = require('../lib/Index');
const Tafsir = require('../lib/Tafsir');
const Utils = require('../lib/Utils');
const { Item } = require('../lib/Model');

const router = express.Router();

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
  const cachedFile = Utils.htmlCacheFile(req, { includeBaseUrl: true });
  const flushCache = Utils.shouldFlushCache(req);
  if (flushCache)
    await Utils.flushCachedFile(cachedFile);
  if (!flushCache && !editMode && fs.existsSync(cachedFile)) {
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
  const navigation = await tafsirNavigation(tafsir, entries, allTafsirs, surahNum, ayahNum);

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
    await Utils.indexCachedItem(tafsirCacheRefs(tafsir, entries, surahNum, ayahNum), cachedFile);
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

async function tafsirNavigation(tafsir, entries, tafsirs, surah, ayah) {
  if (tafsir.source === 'local') {
    const sectionNavigation = await tafsirSectionNavigation(tafsir, surah, ayah, tafsirs);
    if (sectionNavigation && (sectionNavigation.prev || sectionNavigation.next))
      return sectionNavigation;
  }
  const prev = await Tafsir.adjacentPassage(tafsir, entries, -1, { surah: surah, ayah: ayah });
  const next = await Tafsir.adjacentPassage(tafsir, entries, 1, { surah: surah, ayah: ayah });
  return {
    prev: prev ? navigationTarget(tafsir, prev.surah, prev.ayah, tafsirs) : '',
    prevTitle: prev ? `§${prev.surah}.${prev.ayah}` : '',
    next: next ? navigationTarget(tafsir, next.surah, next.ayah, tafsirs) : '',
    nextTitle: next ? `§${next.surah}.${next.ayah}` : ''
  };
}

async function tafsirSectionNavigation(tafsir, surah, ayah, tafsirs) {
  if (typeof global.query !== 'function')
    return null;

  const current = await currentQuranPassageHeading(surah, ayah);
  if (!current)
    return null;

  const prev = await adjacentQuranPassageHeading(current, -1);
  const next = await adjacentQuranPassageHeading(current, 1);
  return {
    prev: prev ? navigationTarget(tafsir, prev.surah, prev.ayah, tafsirs) : '',
    prevTitle: prev ? prev.label : '',
    next: next ? navigationTarget(tafsir, next.surah, next.ayah, tafsirs) : '',
    nextTitle: next ? next.label : ''
  };
}

async function currentQuranPassageHeading(surah, ayah) {
  const rows = await global.query(`
    SELECT h1, h2
    FROM v_hadiths
    WHERE book_alias='quran'
      AND h1=${Number(surah)}
      AND numInChapter=${Number(ayah)}
    LIMIT 1`);
  const row = rows[0];
  if (!row)
    return null;
  const h1 = Number(row.h1);
  const h2 = Number(row.h2);
  if (Number.isFinite(h2) && h2 > 0)
    return quranPassageHeadingByLevel(2, h1, h2);
  return quranPassageHeadingByLevel(1, h1);
}

async function quranPassageHeadingByLevel(level, h1, h2) {
  const h2Clause = Number(level) === 2 ? `AND h2=${Number(h2)}` : '';
  const rows = await global.query(`
    SELECT level, h1, h2, h1_start, h2_start, ordinal
    FROM v_toc
    WHERE book_alias='quran'
      AND level=${Number(level)}
      AND h1=${Number(h1)}
      ${h2Clause}
    ORDER BY ordinal ASC
    LIMIT 1`);
  return normalizeQuranPassageHeading(rows[0]);
}

async function adjacentQuranPassageHeading(current, direction) {
  const operator = direction > 0 ? '>' : '<';
  const order = direction > 0 ? 'ASC' : 'DESC';
  const rows = await global.query(`
    SELECT level, h1, h2, h1_start, h2_start, ordinal
    FROM v_toc
    WHERE book_alias='quran'
      AND level=${Number(current.level)}
      AND ordinal${operator}${Number(current.ordinal)}
    ORDER BY ordinal ${order}
    LIMIT 1`);
  return normalizeQuranPassageHeading(rows[0]);
}

function normalizeQuranPassageHeading(row) {
  if (!row)
    return null;
  const level = Number(row.level);
  const h1 = Number(row.h1);
  const h2 = Number(row.h2);
  const start = parseQuranHeadingStart(level === 2 ? row.h2_start : row.h1_start, h1);
  if (!start)
    return null;
  return {
    level: level,
    ordinal: Number(row.ordinal),
    surah: start.surah,
    ayah: start.ayah,
    label: level === 2 && Number.isFinite(h2) ? `§${h1}.${h2}` : `§${h1}`
  };
}

function parseQuranHeadingStart(ref, fallbackSurah) {
  const match = String(ref || '').match(/^(\d+):(\d+)$/);
  const surah = match ? Number(match[1]) : Number(fallbackSurah);
  const ayah = match ? Math.max(1, Number(match[2])) : 1;
  if (!Number.isInteger(surah) || surah < 1 || !Number.isInteger(ayah))
    return null;
  return { surah: surah, ayah: ayah };
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

function navigationTarget(tafsir, surah, ayah, tafsirs) {
  const url = Tafsir.browseUrl(tafsir, surah, ayah, tafsirs);
  return Utils.quranPath(url);
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
