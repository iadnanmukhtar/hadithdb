/* jslint node:true, esversion:9 */
'use strict';

const debug = require('../lib/Debug')('hadithdb:Bookmarks');
const express = require('express');
const ejs = require('ejs');
const { Heading, Item } = require('../lib/Model');
const Tafsir = require('../lib/Tafsir');
const QuranTocSubdivisions = require('../lib/QuranTocSubdivisions');

const router = express.Router();
const MAX_BOOKMARKS = 100;

router.get('/', async function (req, res, next) {
  try {
    res.locals.req = req;
    res.locals.res = res;
    res.setHeader('X-Robots-Tag', 'noindex, follow');
    res.render('bookmarks', {
      results: [],
      page: getPage()
    });
  } catch (err) {
    next(err);
  }
});

router.post('/list', async function (req, res, next) {
  try {
    const ids = Array.isArray(req.body && req.body.ids)
      ? req.body.ids.map(id => parseInt(id, 10)).filter(id => Number.isInteger(id) && id > 0)
      : [];
    const uniqueIds = Array.from(new Set(ids)).slice(0, MAX_BOOKMARKS);
    if (!uniqueIds.length) {
      res.json({ html: '', count: 0 });
      return;
    }
    const rows = await global.query(`
      SELECT *
      FROM v_hadiths
      WHERE hId IN (${uniqueIds.join(',')})
    `);
    const items = rows.map(r => new Item(r));
    const byId = new Map(items.map(item => [item.id, item]));
    const ordered = uniqueIds.map(id => byId.get(id)).filter(Boolean);
    const site = {
      ...global.settings.site,
      admin: req.admin,
      editMode: false
    };
    const quranItems = ordered.filter(isQuranItem);
    const hadithItems = ordered.filter(item => !isQuranItem(item));
    const [quranHtml, hadithHtml] = await Promise.all([
      renderHadithItems(req, res, site, quranItems),
      renderHadithItems(req, res, site, hadithItems)
    ]);
    res.json({
      html: quranHtml + hadithHtml,
      count: ordered.length,
      sections: {
        quran: { html: quranHtml, count: quranItems.length },
        hadiths: { html: hadithHtml, count: hadithItems.length }
      }
    });
  } catch (err) {
    debug.error(`Error loading bookmarked hadiths: ${err.message}\n${err.stack || ''}`);
    next(err);
  }
});

router.post('/list-headings', async function (req, res, next) {
  try {
    const ids = Array.isArray(req.body && req.body.ids)
      ? req.body.ids.map(id => parseInt(id, 10)).filter(id => Number.isInteger(id) && id > 0)
      : [];
    const uniqueIds = Array.from(new Set(ids)).slice(0, MAX_BOOKMARKS);
    if (!uniqueIds.length) {
      res.json({ html: '', count: 0 });
      return;
    }
    const rows = await global.query(`
      SELECT *
      FROM v_toc
      WHERE hId IN (${uniqueIds.join(',')})
    `);
    const headings = rows.map(row => Heading.toLevel(row));
    const byId = new Map(headings.map(heading => [heading.id, heading]));
    const ordered = uniqueIds.map(id => byId.get(id)).filter(Boolean);
    const headingHtml = await renderHeadingItems(ordered);
    res.json({
      html: headingHtml,
      count: ordered.length,
      sections: {
        headings: { html: headingHtml, count: ordered.length }
      }
    });
  } catch (err) {
    debug.error(`Error loading bookmarked headings: ${err.message}\n${err.stack || ''}`);
    next(err);
  }
});

router.post('/list-tafsirs', async function (req, res, next) {
  try {
    const refs = Array.isArray(req.body && req.body.refs)
      ? req.body.refs.map(ref => (ref || '').toString().trim()).filter(ref => /^[A-Za-z0-9_-]+:[0-9]{1,3}:[0-9]{1,3}$/.test(ref))
      : [];
    const uniqueRefs = Array.from(new Set(refs)).slice(0, MAX_BOOKMARKS);
    if (!uniqueRefs.length) {
      res.json({ html: '', count: 0 });
      return;
    }
    const tafsirBookmarks = (await Promise.all(uniqueRefs.map(resolveTafsirBookmark))).filter(Boolean);
    const html = await ejs.renderFile(`${__dirname}/../views/sub-views/tafsir_bookmark_items.ejs`, {
      tafsirs: tafsirBookmarks,
      Tafsir,
      arabic: global.arabic,
      utils: global.utils
    });
    res.json({ html, count: tafsirBookmarks.length });
  } catch (err) {
    debug.error(`Error loading bookmarked tafsirs: ${err.message}\n${err.stack || ''}`);
    next(err);
  }
});

router.post('/metadata', async function (req, res, next) {
  try {
    const hadithIds = uniquePositiveIds(req.body && req.body.hadithIds);
    const headingIds = uniquePositiveIds(req.body && req.body.headingIds);
    const tafsirRefs = uniqueTafsirRefs(req.body && req.body.tafsirRefs);
    const [hadiths, headings, tafsirs] = await Promise.all([
      metadataForHadiths(hadithIds),
      metadataForHeadings(headingIds),
      metadataForTafsirs(tafsirRefs)
    ]);
    res.json({ hadiths, headings, tafsirs });
  } catch (err) {
    debug.error(`Error loading bookmark metadata: ${err.message}\n${err.stack || ''}`);
    next(err);
  }
});

module.exports = router;

function uniquePositiveIds(values) {
  const ids = Array.isArray(values)
    ? values.map(id => parseInt(id, 10)).filter(id => Number.isInteger(id) && id > 0)
    : [];
  return Array.from(new Set(ids)).slice(0, MAX_BOOKMARKS);
}

function uniqueTafsirRefs(values) {
  const refs = Array.isArray(values)
    ? values.map(ref => (ref || '').toString().trim()).filter(ref => /^[A-Za-z0-9_-]+:[0-9]{1,3}:[0-9]{1,3}$/.test(ref))
    : [];
  return Array.from(new Set(refs)).slice(0, MAX_BOOKMARKS);
}

function clean(value) {
  return (value || '').toString().replace(/\s+/g, ' ').trim();
}

async function metadataForHadiths(ids) {
  if (!ids.length) return {};
  const rows = await global.query(`
    SELECT hId, book_alias, book_shortName_en, num, ref, title_en, title, body_en, body
    FROM v_hadiths
    WHERE hId IN (${ids.join(',')})
  `);
  return rows.reduce((acc, row) => {
    const isQuran = row.book_alias === 'quran' || clean(row.ref).startsWith('quran:');
    const ref = isQuran ? clean(row.ref || row.num) : `${row.book_alias}:${clean(row.num)}`;
    const entry = {
      type: isQuran ? 'quran' : 'hadith',
      ref,
      title: clean(row.title_en) || ref,
      url: isQuran ? `/${ref}` : `/${row.book_alias}:${clean(row.num)}`
    };
    if (isQuran) {
      entry.body = clean(row.body_en);
      entry.bodyAr = clean(row.body);
    }
    acc[String(row.hId)] = entry;
    return acc;
  }, {});
}

async function metadataForHeadings(ids) {
  if (!ids.length) return {};
  const [rows, quranSubdivisions, manzilRows] = await Promise.all([
    global.query(`
      SELECT id, hId, tId, book_alias, ref, path, h1, h1_title_en, h1_title, h2, h2_title_en, h2_title, h3, h3_title_en, h3_title, level
      FROM v_toc
      WHERE id IN (${ids.join(',')})
         OR hId IN (${ids.join(',')})
         OR tId IN (${ids.join(',')})
    `),
    global.query(`
      SELECT id, quran_subdivision, h1 AS num, title_en, title, start
      FROM toc
      WHERE bookId=(SELECT id FROM books WHERE alias='quran' LIMIT 1)
        AND quran_subdivision IN ('juz', 'manzil')
        AND id IN (${ids.join(',')})
    `),
    QuranTocSubdivisions.manzilRows()
  ]);
  const metadata = quranSubdivisions.reduce((acc, row) => {
    addQuranDivisionMetadata(acc, row, clean(row.quran_subdivision));
    return acc;
  }, {});
  (manzilRows || [])
    .filter(row => ids.includes(Number(row.id)))
    .forEach(row => addQuranDivisionMetadata(metadata, row, 'manzil'));
  return rows.reduce((acc, row) => {
    if (metadata[String(row.id)]) return acc;
    const level = Number(row.level);
    const isSurah = row.book_alias === 'quran' && level === 1;
    const title = level >= 3
      ? clean(row.h3_title_en)
      : (level >= 2 ? clean(row.h2_title_en) : clean(row.h1_title_en));
    const titleAr = level >= 3
      ? clean(row.h3_title)
      : (level >= 2 ? clean(row.h2_title) : clean(row.h1_title));
    const ref = isSurah
      ? `quran:${clean(row.h1)}`
      : (clean(row.ref) || `${row.book_alias}:${clean(row.h1)}${row.h2 ? `.${clean(row.h2)}` : ''}${row.h3 ? `.${clean(row.h3)}` : ''}`);
    const entry = {
      type: isSurah ? 'surah' : (level === 1 ? 'chapter' : (level === 2 ? 'section' : 'subsection')),
      ref,
      title: title || ref,
      titleAr,
      url: row.path ? `/${row.path}` : ''
    };
    [row.id, row.hId, row.tId].forEach((key) => {
      if (Number.isInteger(Number(key)) && Number(key) > 0) acc[String(key)] = entry;
    });
    return acc;
  }, metadata);
}

function addQuranDivisionMetadata(acc, row, subdivision) {
  const num = clean(row.num);
  const isJuz = subdivision === 'juz';
  const ref = `${subdivision}:${num}`;
  const startParts = clean(row.start).split(':');
  const startRef = startParts.length >= 2 ? `quran:${startParts[0]}:${startParts[1]}` : '';
  const startUrl = startParts.length >= 2 ? `/quran:${startParts[0]}:${startParts[1]}` : '';
  acc[String(row.id)] = {
    type: 'quran-range',
    ref,
    startRef,
    title: isJuz ? `Juz ${num}` : `Manzil ${num}`,
    titleAr: clean(row.title),
    url: startUrl
  };
}

async function metadataForTafsirs(refs) {
  if (!refs.length) return {};
  const entries = await Promise.all(refs.map(resolveTafsirBookmark));
  return entries.filter(Boolean).reduce((acc, item) => {
    const alias = item.tafsir.slug || item.tafsir.alias;
    const range = `${item.surah.num}:${item.startAyah}${item.endAyah > item.startAyah ? `-${item.endAyah}` : ''}`;
    acc[item.key] = {
      type: 'tafsir',
      ref: `quran:${range}`,
      range,
      title: Tafsir.displayShortName(item.tafsir, 'en'),
      titleAr: Tafsir.displayShortName(item.tafsir, 'ar'),
      url: Tafsir.passageUrl(item.tafsir, item.surah.num, item.startAyah, item.endAyah) || `/quran/tafsir/${alias}/quran:${range}`
    };
    return acc;
  }, {});
}

function renderHadithItems(req, res, site, results) {
  if (!results.length) return '';
  return ejs.renderFile(`${__dirname}/../views/sub-views/hadith_list_items.ejs`, {
      req,
      res,
      site,
      page: getPage(),
      results
  });
}

function renderHeadingItems(headings) {
  if (!headings.length) return '';
  return ejs.renderFile(`${__dirname}/../views/sub-views/heading_bookmark_items.ejs`, {
    headings,
    utils: global.utils
  });
}

async function resolveTafsirBookmark(ref) {
  const [tafsirRef, surahPart, ayahPart] = ref.split(':');
  const surahNum = Number(surahPart);
  const ayahNum = Number(ayahPart);
  const tafsir = await Tafsir.resolveTafsir(tafsirRef);
  const surah = (global.surahs || []).find(item => Number(item.num) === surahNum);
  if (!tafsir || !surah || !Number.isInteger(ayahNum) || ayahNum < 1)
    return null;
  let entries = [];
  if (tafsir.source === 'local') {
    try {
      entries = await Tafsir.tafsirEntries(tafsir, surahNum, ayahNum);
    } catch (err) {
      entries = [];
    }
  }
  const startAyah = entries.length ? Math.min(...entries.map(entry => Number(entry.startAyah))) : ayahNum;
  const endAyah = entries.length ? Math.max(...entries.map(entry => Number(entry.endAyah))) : ayahNum;
  return {
    key: ref,
    tafsir,
    surah,
    ayah: ayahNum,
    startAyah,
    endAyah,
    url: Tafsir.passageUrl(tafsir, surahNum, startAyah, endAyah)
  };
}

function isQuranItem(item) {
  return item && (item.book_alias === 'quran' || item.remark == 2 || (item.actual && item.actual.book_alias === 'quran'));
}

function getPage() {
  return {
    menu: 'Bookmarks',
    title_en: `Bookmarks`,
    description_en: 'View and manage your saved Quran passages, tafsir passages, hadith, and reading locations.',
    subtitle_en: 'Saved to your account settings',
    subtitle: null,
    canonical: '/bookmarks',
    alternate: '/bookmarks',
    feed: null,
    noindex: true,
    context: {}
  };
}
