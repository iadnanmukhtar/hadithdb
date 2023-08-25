/* jslint node:true, esversion:9 */
'use strict';

const debug = require('debug')('hadithdb:commented');
const express = require('express');
const asyncify = require('express-asyncify').default;
const { Item } = require('../lib/Model');

const router = asyncify(express.Router());
const name = 'commented';

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
  var results = await global.query(`SELECT * FROM v_hadiths WHERE hId IN 
    (SELECT id FROM hadiths WHERE commented > 0)
    ORDER BY lastmod DESC
    LIMIT ${global.settings.search.itemsPerPage}`);
  return results.map(item => new Item(item));
}

function getPage(route) {
  return {
    menu: 'Recently Commented',
    title_en: `${global.settings.site.shortName} | Recently Commented`,
    subtitle_en: 'Aḥādīth that have been recently commented on',
    subtitle: null,
    canonical: `/${name}${route ? route : ''}`,
    alternate: `/${name}`,
    feed: `${global.settings.site.url}/${name}/feed`,
    rss: `${global.settings.site.url}/${name}/rss`,
    context: {},
  };
}