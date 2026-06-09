'use strict';

const createError = require('http-errors');
const express = require('express');
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

router.get('/:tafsir/:surah/:ayah', async function (req, res, next) {
  res.locals.req = req;
  res.locals.res = res;

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
      editMode: req.admin && req.editMode
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
  const sectionMenu = await Tafsir.sectionMenu(tafsir);

  res.render('tafsir_passage', {
    Tafsir: Tafsir,
    ayah: ayahNum,
    ayahs: ayahs,
    entries: entries,
    navigation: navigation,
    sectionMenu: sectionMenu,
    surah: surah,
    tafsir: tafsir
  });
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

module.exports = router;
