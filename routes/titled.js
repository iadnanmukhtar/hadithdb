/* jslint node:true, esversion:9 */
'use strict';

const debug = require('debug')('hadithdb:titled');
const express = require('express');
const asyncify = require('express-asyncify').default;
const { Item } = require('../lib/Model');


const router = asyncify(express.Router());

router.get('/', async function (req, res, next) {
  res.locals.req = req;
  res.locals.res = res;
  var results = await getList();
  res.render('hadiths_list', {
    results: results,
    page: getPage()

  });
});

router.get('/rss', async function (req, res, next) {
  res.locals.req = req;
  res.locals.res = res;
  var results = await getList();
  res.type('text/xml; charset=utf-8')
  res.render('hadiths_list_rss', {
    results: results,
    page: getPage('/rss')
  });
});

router.get('/feed', async function (req, res, next) {
  res.locals.req = req;
  res.locals.res = res;
  var results = await getList();
  res.type('text/xml; charset=utf-8')
  res.render('hadiths_list_feed', {
    results: results,
    page: getPage('/feed')
  });
});

module.exports = router;

async function getList() {
  var results = await global.query(`SELECT * FROM v_hadiths WHERE hId IN 
    (SELECT id FROM hadiths WHERE title_en IS NOT NULL OR title_en != '')
    ORDER BY lastmod DESC
    LIMIT ${global.settings.search.itemsPerPage}`);
  return results.map(item => new Item(item));
}

function getPage(route) {
  return {
    menu: 'Recently Titled',
    title_en: `${global.settings.site.shortName} | Recently Titled`,
    subtitle_en: 'Aḥādīth recently summarized by a title',
    subtitle: null,
    canonical: `/titled${route ? route : ''}`,
    alternate: '/titled',
    feed: `${global.settings.site.url}/titled/feed`,
    context: {},
  };
}