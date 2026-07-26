/* jslint node:true, esversion:9 */
'use strict';

const debug = require('../lib/Debug')('hadithdb:Commented');
const express = require('express');
const { Item } = require('../lib/Model');
const Utils = require('../lib/Utils');

const router = express.Router();
const name = 'commented';
const latestCommentedLimit = 20;

router.use(function noStoreCommentedResponses(req, res, next) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

router.get('/', async function (req, res, next) {
  res.locals.req = req;
  res.locals.res = res;

  var results = await getList();

  res.render('hadiths_list', {
    results: results,
    page: getPage()
  });
});

router.get('/feed', async function (req, res, next) {
  res.setHeader('Content-Type', 'application/atom+xml; charset=UTF-8');
  res.setHeader('Content-Disposition', `inline; filename="hadithunlocked_${name}_atom.xml"`);
  res.locals.req = req;
  res.locals.res = res;

  var results = await getList();

  res.render('hadiths_list_feed', {
    results: results,
    page: getPage('/feed')
  });
});

router.get('/rss', async function (req, res, next) {
  res.setHeader('Content-Type', 'application/rss+xml; charset=UTF-8');
  res.setHeader('Content-Disposition', `inline; filename="hadithunlocked_${name}_rss.xml"`);
  res.locals.req = req;
  res.locals.res = res;

  var results = await getList();

  res.render('hadiths_list_rss', {
    results: results,
    page: getPage('/rss')
  });
});

module.exports = router;

async function getList() {
  var results = await global.query(`
    SELECT vh.*, h.commented AS comment_count
    FROM hadiths h
    JOIN v_hadiths vh ON vh.hId=h.id
    WHERE h.commented > 0
    ORDER BY h.commented DESC, h.lastfixed DESC, h.id DESC
    LIMIT ${latestCommentedLimit}`);
  return results.map(item => new Item(item));
}

function getPage(route) {
  return {
    menu: 'Recently Commented',
    title_en: `Recently Commented Hadiths`,
    subtitle_en: 'Aḥādīth that have been recently commented on',
    subtitle: null,
    canonical: `/${name}${route ? route : ''}`,
    alternate: `/${name}`,
    feed: `${global.settings.site.url}/${name}/feed`,
    rss: `${global.settings.site.url}/${name}/rss`,
    context: {},
  };
}
