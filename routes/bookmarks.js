/* jslint node:true, esversion:9 */
'use strict';

const debug = require('debug')('hadithdb:bookmarks');
const express = require('express');
const ejs = require('ejs');
const { Heading, Item } = require('../lib/Model');

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
      admin: req.cookies.admin == global.settings.admin.key,
      editMode: false
    };
    const html = await ejs.renderFile(`${__dirname}/../views/sub-views/hadith_list_items.ejs`, {
      req,
      res,
      site,
      page: getPage(),
      results: ordered
    });
    res.json({ html, count: ordered.length });
  } catch (err) {
    debug(`Error loading bookmarked hadiths: ${err.message}`);
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
    const html = await ejs.renderFile(`${__dirname}/../views/sub-views/heading_bookmark_items.ejs`, {
      headings: ordered,
      utils: global.utils
    });
    res.json({ html, count: ordered.length });
  } catch (err) {
    debug(`Error loading bookmarked headings: ${err.message}`);
    next(err);
  }
});

module.exports = router;

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
