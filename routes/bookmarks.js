/* jslint node:true, esversion:9 */
'use strict';

const debug = require('../lib/Debug')('hadithdb:Bookmarks');
const express = require('express');
const ejs = require('ejs');
const { Heading, Item } = require('../lib/Model');
const Tafsir = require('../lib/Tafsir');

const router = express.Router();
const MAX_BOOKMARKS = 100;

router.get('/', async function (req, res, next) {
  try {
    res.locals.req = req;
    res.locals.res = res;
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

module.exports = router;

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
    url: Tafsir.browseUrl(tafsir, surahNum, ayahNum)
  };
}

function isQuranItem(item) {
  return item && (item.book_alias === 'quran' || item.remark == 2 || (item.actual && item.actual.book_alias === 'quran'));
}

function getPage() {
  return {
    menu: 'Bookmarks',
    title_en: `${global.settings.site.shortName} | Bookmarks`,
    subtitle_en: 'Saved to your account settings',
    subtitle: null,
    canonical: '/bookmarks',
    alternate: '/bookmarks',
    feed: null,
    context: {}
  };
}
