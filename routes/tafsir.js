'use strict';

const createError = require('http-errors');
const express = require('express');
const ejs = require('ejs');
const fs = require('fs');
const Index = require('../lib/Index');
const QuranHeadings = require('../lib/QuranHeadings');
const QuranHeadingOutlines = require('../lib/QuranHeadingOutlines');
const QuranMushaf = require('../lib/QuranMushaf');
const Tafsir = require('../lib/Tafsir');
const Utils = require('../lib/Utils');
const BookDownloads = require('../lib/BookDownloads');
const CommentaryHeadings = require('../lib/CommentaryHeadings');
const QuranTocSubdivisions = require('../lib/QuranTocSubdivisions');
const HttpRange = require('../lib/HttpRange');
const QuranAyahNavigation = require('../lib/QuranAyahNavigation');
const { invalidateQuranMemoryCaches } = require('../lib/QuranCacheInvalidation');
const { Item, Library } = require('../lib/Model');

const router = express.Router();

function gone(message) {
  return createError(410, message);
}

function quranSurahCount() {
  return Math.max(0, ...(global.surahs || []).map(item => Number(item.num)).filter(Number.isInteger));
}

function subdivisionRangeError(unit, rows, requested, label) {
  const number = Number(requested);
  if (!Number.isInteger(number))
    return null;
  const maximum = Math.max(0, ...(rows || []).map(row => Number(row.num)).filter(Number.isInteger));
  return number < 1 || number > maximum
    ? HttpRange.notSatisfiable(unit, maximum, `${label} '${requested}' is out of range`)
    : null;
}

router.use(function removeTafsirLanguageQuery(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD' || req.query.lang === undefined)
    return next();
  const query = new URLSearchParams(req.query);
  query.delete('lang');
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return res.redirect(301, `${Utils.quranPath(`${req.baseUrl}${req.path}`)}${suffix}`);
});

function originalQuery(req) {
  const originalUrl = (req.originalUrl || '').toString();
  const index = originalUrl.indexOf('?');
  return index >= 0 ? originalUrl.slice(index) : '';
}

router.get('/:tafsir/juz/:number', async function (req, res, next) {
  const tafsir = await Tafsir.resolveTafsir(req.params.tafsir);
  if (!tafsir)
    return next(gone(`Tafsīr '${req.params.tafsir}' not found`));
  const number = Number(req.params.number);
  const juzRows = await QuranTocSubdivisions.juzRows();
  const juz = Number.isInteger(number) && number > 0
    ? juzRows.find(row => Number(row.num) === number)
    : null;
  const juzRangeError = subdivisionRangeError('quran-juz', juzRows, req.params.number, 'Quran juz');
  if (juzRangeError)
    return next(juzRangeError);
  if (!juz)
    return next(createError(Number.isInteger(number) && number > 0 ? 410 : 404, `Quran juz '${req.params.number}' not found`));
  const start = (juz.start || '').toString().split(':');
  const surah = Number(start[0]);
  const ayah = Number(start[1]);
  const section = await QuranHeadings.sectionForAyah(surah, ayah);
  if (!section)
    return next(gone(`No Quran passage contains the start of juz ${number}`));
  const slug = tafsir.slug || Tafsir.tafsirSlug(tafsir.alias);
  return res.redirect(302, `${Utils.quranPath(`/quran/tafsir/${encodeURIComponent(slug)}/${surah}/${Number(section.h2)}`)}${originalQuery(req)}`);
});

router.get('/:tafsir/manzil/:number', async function (req, res, next) {
  const tafsir = await Tafsir.resolveTafsir(req.params.tafsir);
  if (!tafsir)
    return next(gone(`Tafsīr '${req.params.tafsir}' not found`));
  const number = Number(req.params.number);
  const manzilRows = await QuranTocSubdivisions.manzilRows();
  const manzil = Number.isInteger(number) && number > 0
    ? manzilRows.find(row => Number(row.num) === number)
    : null;
  const manzilRangeError = subdivisionRangeError('quran-manzils', manzilRows, req.params.number, 'Quran manzil');
  if (manzilRangeError)
    return next(manzilRangeError);
  if (!manzil)
    return next(createError(Number.isInteger(number) && number > 0 ? 410 : 404, `Quran manzil '${req.params.number}' not found`));
  const surah = Number((manzil.start || '').toString().split(':')[0]);
  const slug = tafsir.slug || Tafsir.tafsirSlug(tafsir.alias);
  return res.redirect(302, `${Utils.quranPath(`/quran/tafsir/${encodeURIComponent(slug)}/${surah}`)}${originalQuery(req)}`);
});

router.get('/:tafsir', async function (req, res, next) {
  res.locals.req = req;
  res.locals.res = res;

  const tafsir = await Tafsir.resolveTafsir(req.params.tafsir);
  if (!tafsir)
    return next(gone(`Tafsīr '${req.params.tafsir}' not found`));

  await renderTafsirBookToc(req, res, tafsir);
});

router.get('/:tafsir/introduction', async function (req, res, next) {
  res.locals.req = req;
  res.locals.res = res;
  const tafsir = await Tafsir.resolveTafsir(req.params.tafsir);
  if (!tafsir)
    return next(gone(`Tafsīr '${req.params.tafsir}' not found`));
  const commentaryIntroductionArticles = await CommentaryHeadings.introductionArticles(tafsir.id);
  if (!CommentaryHeadings.hasIntroduction(commentaryIntroductionArticles) && !(req.admin && req.editMode))
    return next(createError(404, `No authored introduction is available for ${tafsir.shortName_en || tafsir.alias}`));
  const commentaryIntroductionNextH1 = await introductionNextH1(tafsir);
  const commentaryIntroductionPreviousPassage = await introductionPreviousPassage(tafsir);
  const quranHeadingOutlines = await QuranHeadingOutlines.forSurahs([1]);
  res.render('quran_commentary_introduction', {
    Tafsir: Tafsir,
    commentaryIntroductionArticles: commentaryIntroductionArticles,
    commentaryIntroductionNextH1: commentaryIntroductionNextH1,
    commentaryIntroductionPreviousPassage: commentaryIntroductionPreviousPassage,
    quranHeadingOutlines: quranHeadingOutlines,
    quranCommentaryBook: tafsir,
    quranCommentaryBooks: await Tafsir.visibleTafsirs()
  });
});

async function introductionNextH1(book) {
  const passage = { surah: 1, ayah: 0, endAyah: 0 };
  const surah = passage && (global.surahs || []).find(item => Number(item.num) === Number(passage.surah));
  if (!passage)
    return null;
  return {
    number: Number(passage.surah),
    title: surah && surah.name_en || '',
    href: book.type === 'trans'
      ? `/quran/${encodeURIComponent(book.quranBookSlug || book.alias)}/${Number(passage.surah)}`
      : Tafsir.passageUrl(book, passage.surah, passage.ayah, passage.endAyah)
  };
}

async function introductionPreviousPassage(book) {
  if (!book || book.type !== 'tafsir')
    return null;
  const passages = book.source === 'local'
    ? await Tafsir.sitemapPassages(book, { source: 'db' })
    : [];
  const passage = passages[passages.length - 1] || { surah: 114, ayah: 6, endAyah: 6 };
  const href = Tafsir.passageUrl(book, passage.surah, passage.ayah, passage.endAyah);
  const range = Number(passage.endAyah) > Number(passage.ayah)
    ? `${passage.ayah}-${passage.endAyah}`
    : `${passage.ayah}`;
  return { href, title: `§${passage.surah}.${range}` };
}

router.get('/:tafsir/quran\::surah\::start-:end', renderTafsirPassage);
router.get('/:tafsir/quran\::surah\::start', renderTafsirPassage);

router.get('/:tafsir/:surah', async function (req, res, next) {
  res.locals.req = req;
  res.locals.res = res;

  const tafsir = await Tafsir.resolveTafsir(req.params.tafsir);
  if (!tafsir)
    return next(gone(`Tafsīr '${req.params.tafsir}' not found`));

  const surahNum = Number(req.params.surah);
  const surah = (global.surahs || []).find(item => Number(item.num) === surahNum);
  if (Number.isInteger(surahNum) && (surahNum < 1 || surahNum > quranSurahCount()))
    return next(HttpRange.notSatisfiable('quran-surahs', quranSurahCount(), `Quran surah ${req.params.surah} is out of range`));
  if (!surah)
    return next(createError(Number.isInteger(surahNum) && surahNum > 0 ? 410 : 404, `Quran surah ${req.params.surah} not found`));

  const passage = await Tafsir.firstPassageInSurah(tafsir, surahNum, { includeZero: true });
  if (!passage)
    return next(gone(`${tafsir.shortName_en || tafsir.alias} has no passages for Surah ${surahNum}`));

  const allTafsirs = await Tafsir.visibleTafsirs();
  res.redirect(302, Utils.quranPath(Tafsir.passageUrl(tafsir, passage.surah, passage.ayah, passage.endAyah, allTafsirs)));
});

router.get('/:tafsir/:surah/:section', renderTafsirPassage);

async function renderTafsirPassage(req, res, next) {
  res.locals.req = req;
  res.locals.res = res;
  const editMode = req.admin && req.editMode;

  const surahNum = Number(req.params.surah);
  const ayahNum = Number(req.params.start || req.params.section);
  const requestedEnd = req.params.end === undefined ? ayahNum : Number(req.params.end);
  const surah = (global.surahs || []).find(item => Number(item.num) === surahNum);
  const minimumAyah = surahNum === 1 ? 0 : 1;
  const validPassageFormat = Number.isInteger(surahNum) && surahNum > 0
    && Number.isInteger(ayahNum) && ayahNum >= minimumAyah
    && Number.isInteger(requestedEnd) && requestedEnd >= ayahNum;
  if (Number.isInteger(surahNum) && (surahNum < 1 || surahNum > quranSurahCount()))
    return next(HttpRange.notSatisfiable('quran-surahs', quranSurahCount(), `Quran surah ${req.params.surah} is out of range`));
  if (surah && Number.isInteger(ayahNum) && Number.isInteger(requestedEnd)
    && (ayahNum < minimumAyah || requestedEnd < ayahNum || requestedEnd > Number(surah.ayahs)))
    return next(HttpRange.notSatisfiable('quran-ayahs', Number(surah.ayahs), `Quran passage ${req.params.surah}:${req.params.start || req.params.section}${req.params.end ? `-${req.params.end}` : ''} is out of range`));
  if (!surah || !validPassageFormat)
    return next(createError(validPassageFormat ? 410 : 404, `Quran passage ${req.params.surah}:${req.params.start || req.params.section}${req.params.end ? `-${req.params.end}` : ''} not found`));

  const tafsir = await Tafsir.resolveTafsir(req.params.tafsir);
  if (!tafsir)
    return next(gone(`Tafsīr '${req.params.tafsir}' not found`));

  // Canonical passage URLs encode the complete tafsir entry range. Check their
  // disk cache before loading the tafsir entry merely to rediscover that range.
  // Legacy /:surah/:section URLs still need the lookup below so they can be
  // redirected to the correct canonical passage.
  const cachedFile = cachedRequestFile(req);
  const flushCache = Utils.shouldFlushCache(req);
  if (flushCache) {
    invalidateQuranMemoryCaches({ commentaryAlias: tafsir.alias });
    await Utils.flushCachedFile(cachedFile, { strict: true });
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  if (req.params.start !== undefined && !flushCache && !editMode && Utils.cachedTextPathForRead(cachedFile)) {
    sendCachedHtml(req, res, cachedFile);
    return;
  }

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
  const allTafsirs = await Tafsir.visibleTafsirs();
  const canonicalPath = Tafsir.passageUrl(tafsir, surahNum, entryStart, entryEnd, allTafsirs);
  const canonicalUrl = new URL(canonicalPath, 'https://quran.islamunlocked.com');
  const canonicalPathname = canonicalUrl.pathname;
  const requestPathname = new URL(req.originalUrl || req.url, 'https://quran.islamunlocked.com').pathname;
  if (requestPathname !== canonicalPathname) {
    const query = new URLSearchParams(req.query);
    if (canonicalUrl.searchParams.has('lang'))
      query.set('lang', canonicalUrl.searchParams.get('lang'));
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return res.redirect(301, `${Utils.quranPath(canonicalPathname)}${suffix}`);
  }

  if (!flushCache && !editMode && Utils.cachedTextPathForRead(cachedFile)) {
    sendCachedHtml(req, res, cachedFile);
    return;
  }
  const ayahs = await quranAyahs(surahNum, entryStart, entryEnd);
  const section = await QuranHeadings.sectionForAyah(surahNum, ayahNum);
  const chapter = section
    ? await section.getChapter()
    : await QuranHeadings.chapter(surahNum);
  if (chapter && typeof chapter.getSections === 'function')
    await chapter.getSections();
  if (section)
    section.mushafPage = await QuranMushaf.pageForRef(surahNum, entryStart);
  const navigationEntries = entries.length || tafsir.source !== 'local'
    ? entries
    : await Tafsir.tafsirEntries(tafsir, surahNum, ayahNum, {
      editMode: editMode,
      includeEmpty: true
    });
  const commentaryIntroductionArticles = await CommentaryHeadings.introductionArticles(tafsir.id);
  const commentaryIntroductionHref = CommentaryHeadings.hasIntroduction(commentaryIntroductionArticles)
    ? `/quran/tafsir/${encodeURIComponent(tafsir.slug || Tafsir.tafsirSlug(tafsir.alias))}/introduction`
    : '';
  const navigation = await tafsirNavigation(tafsir, navigationEntries, allTafsirs, surahNum, ayahNum, commentaryIntroductionHref);
	const quranHeadingOutlines = await QuranHeadingOutlines.forSurahs([surahNum]);
  const firstSurahPassage = await Tafsir.firstPassageInSurah(tafsir, surahNum, { includeZero: true });
  let commentarySurahHeading = null;
  if (firstSurahPassage && Number(firstSurahPassage.ayah) === Number(entryStart)) {
    commentarySurahHeading = await CommentaryHeadings.chapter(tafsir.id, surahNum);
    if (!commentarySurahHeading && editMode)
      commentarySurahHeading = await CommentaryHeadings.ensureChapter(tafsir.id, surahNum, '');
  }
  const renderLocals = {
    BookDownloads: BookDownloads,
    Tafsir: Tafsir,
    ayah: ayahNum,
    ayahs: ayahs,
    chapter: chapter,
    commentarySurahHeading: commentarySurahHeading,
    commentaryIntroductionArticles: commentaryIntroductionArticles,
    entries: entries,
    navigation: navigation,
	quranHeadingOutlines: quranHeadingOutlines,
    tafsirBooks: allTafsirs,
    section: section,
    surah: surah,
    tafsir: tafsir
  };

  if (!editMode) {
    const refs = [
      `quran:${surahNum}:${ayahNum}`,
      `quran:surah:${surahNum}`,
      `tafsir:${tafsir.alias}`,
      `tafsir:${tafsir.slug || Tafsir.tafsirSlug(tafsir.alias)}`,
      `tafsir:${tafsir.alias}:quran:${surahNum}:${ayahNum}`
    ];
    const html = await ejs.renderFile(`${__dirname}/../views/tafsir_passage.ejs`, cachedRenderLocals(res, {
      noadmin: true,
      ...renderLocals
    }));
    Utils.writeCachedHtml(cachedFile, html);
    await Utils.indexCachedItem(refs, cachedFile);
  }

  res.render('tafsir_passage', renderLocals);
}

async function renderTafsirBookToc(req, res, tafsir) {
  const quranBook = (global.books || []).find(book => book && book.alias === 'quran' && Number(book.hidden) === 0);
  if (!quranBook)
    throw createError(404, `Book 'quran' does not exist`);

  const editMode = req.admin && req.editMode;
  const quranTocDefaultView = normalizedQuranTocView(req);
  const cachedFile = cachedTafsirTocFile(req, tafsir, quranTocDefaultView);
  const flushCache = Utils.shouldFlushCache(req);
  if (flushCache) {
    invalidateQuranMemoryCaches({ commentaryAlias: tafsir.alias });
    await flushTafsirTocCacheVariants(req, tafsir);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  if (!flushCache && !editMode && Utils.cachedTextPathForRead(cachedFile)) {
    if (sendCachedHtml(req, res, cachedFile))
      return;
    await Utils.flushCachedFile(cachedFile);
  }

  const toc = await Library.instance.findBook('quran').getChapters();
  const tafsirs = await Tafsir.visibleTafsirs();
  const quranJuzRows = await QuranTocSubdivisions.juzRows();
  const quranManzilRows = await QuranTocSubdivisions.manzilRows();
  const quranSectionRangesBySurah = await QuranTocSubdivisions.quranSectionRangesBySurah();
  const quranTafsirPassages = await Tafsir.sitemapPassages(tafsir, { source: 'db' });
  const quranCommentaryAvailableSurahs = tafsir.source === 'local'
    ? Array.from(new Set(quranTafsirPassages.map(passage => Number(passage.surah)).filter(Number.isInteger)))
    : null;
  const commentaryIntroductionArticles = await CommentaryHeadings.introductionArticles(tafsir.id);
  const renderLocals = {
    book: quranBook,
    surahs: global.surahs || [],
    quranJuzRows: quranJuzRows,
    quranManzilRows: quranManzilRows,
    quranSectionRangesBySurah: quranSectionRangesBySurah,
    quranTafsirPassages: quranTafsirPassages,
    quranCommentaryAvailableSurahs: quranCommentaryAvailableSurahs,
    quranTocDefaultView: quranTocDefaultView,
    BookDownloads: BookDownloads,
    commentaryIntroductionArticles: commentaryIntroductionArticles,
    prevBook: null,
    nextBook: null,
    toc: toc,
    random: undefined,
    Tafsir: Tafsir,
    tafsirs: tafsirs,
    quranCommentaryBooks: tafsirs,
    quranCommentaryBook: tafsir
  };

  if (!editMode && Utils.diskCacheEnabled()) {
    const html = await ejs.renderFile(`${__dirname}/../views/toc.ejs`, cachedRenderLocals(res, {
      noadmin: true,
      ...renderLocals
    }));
    Utils.writeCachedHtml(cachedFile, html);
    await Utils.indexCachedItem([
      'quran',
      'book:quran',
      'quran:navigation-tocs',
      `tafsir:${tafsir.alias}:toc`,
      `tafsir:${tafsir.slug || Tafsir.tafsirSlug(tafsir.alias)}:toc`
    ], cachedFile);
    if (sendCachedHtml(req, res, cachedFile))
      return;
  }

  res.render('toc', renderLocals);
}

function normalizedQuranTocView(req) {
  const view = (req.query.toc || req.query.view || req.query.tab || 'juz').toString();
  return ['surahs', 'juz', 'manzils'].includes(view) ? view : 'juz';
}

function cachedTafsirTocFile(req, tafsir, view) {
  const filename = Utils.cacheReqToFilename({
    ...req,
    url: req.originalUrl || req.url || ''
  });
  const variant = view === 'juz' ? '' : `__toc-${Utils.safeFilename(view)}`;
  return Utils.cacheFileFromFilename(
    `${filename}${variant}`,
    'html',
    tafsir.alias,
    'tafsir'
  );
}

async function flushTafsirTocCacheVariants(req, tafsir) {
  await Promise.all(['juz', 'surahs', 'manzils'].map(view =>
    Utils.flushCachedFile(cachedTafsirTocFile(req, tafsir, view), { strict: true })));
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

async function tafsirNavigation(tafsir, entries, tafsirs, surah, ayah, introductionHref) {
  const currentRef = { surah: surah, ayah: ayah };
  const prev = Tafsir.invocationBoundary(entries, surah, ayah, -1, introductionHref)
    || await Tafsir.adjacentPassage(tafsir, entries, -1, currentRef);
  const next = Tafsir.invocationBoundary(entries, surah, ayah, 1, introductionHref)
    || await Tafsir.adjacentPassage(tafsir, entries, 1, currentRef);
  return {
    prev: prev ? prev.href || navigationTarget(tafsir, prev.surah, prev.ayah, prev.endAyah, tafsirs) : '',
    prevTitle: prev ? prev.title || tafsirNavigationTitle(prev) : '',
    next: next ? next.href || navigationTarget(tafsir, next.surah, next.ayah, next.endAyah, tafsirs) : '',
    nextTitle: next ? next.title || tafsirNavigationTitle(next) : ''
  };
}

function tafsirNavigationTitle(target) {
  const endAyah = Number(target.endAyah);
  const range = Number.isInteger(endAyah) && endAyah > Number(target.ayah)
    ? `${target.ayah}-${endAyah}`
    : target.ayah;
  return `§${target.surah}.${range}`;
}

function tafsirEditNavigation(tafsir, surah, ayah, tafsirs) {
  const prev = adjacentQuranAyah(tafsir, surah, ayah, -1);
  const next = adjacentQuranAyah(tafsir, surah, ayah, 1);
  return {
    prev: prev ? navigationTarget(tafsir, prev.surah, prev.ayah, prev.ayah, tafsirs) : '',
    prevTitle: prev ? `§${prev.surah}.${prev.ayah}` : '',
    next: next ? navigationTarget(tafsir, next.surah, next.ayah, next.ayah, tafsirs) : '',
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
  const boundary = QuranAyahNavigation.boundaryAdjacent(surah, ayah, direction);
  if (boundary)
    return boundary;
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
	const adjacent = QuranAyahNavigation.adjacent(surah, ayah, direction);
	return adjacent ? `quran:${adjacent.surah}:${adjacent.ayah}` : '';
}

function navigationTarget(tafsir, surah, ayah, endAyah, tafsirs) {
  const url = Tafsir.passageUrl(tafsir, surah, ayah, endAyah, tafsirs);
  return Utils.quranPath(url);
}

function sendCachedHtml(req, res, cachedFile) {
  return Utils.sendCachedHtml(res, req, cachedFile, 'text/html; charset=UTF-8');
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
  const filename = Utils.cacheReqToFilename({
    ...req,
    url: req.originalUrl || req.url || ''
  });
  const tafsir = (global.commentaries || []).find(book => book
    && book.type === 'tafsir'
    && (book.alias === req.params.tafsir || book.slug === req.params.tafsir));
  return Utils.cacheFileFromFilename(
    filename,
    'html',
    tafsir && tafsir.alias || req.params.tafsir,
    'tafsir'
  );
}

module.exports = router;
