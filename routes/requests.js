/* jslint node:true, esversion:9 */
'use strict';

const debug = require('debug')('hadithdb:requests');
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
  var results = await global.query(
    `SELECT vh.*, h.requested, h.lastmod FROM hadiths h, v_hadiths vh
    WHERE h.requested > 0
      AND h.id = vh.hId
    ORDER BY h.lastmod DESC
    LIMIT ${global.settings.search.itemsPerPage}`);
  return results.map(item => new Item(item));
}

function getPage(route) {
  return {
    menu: 'Translation Requests',
    title_en: `${global.settings.site.shortName} | 'Translation Requests'`,
    subtitle_en: 'Translations of aḥādīth requested to be translated',
    subtitle: null,
    canonical: `/requests${route ? route : ''}`,
    alternate: '/requests',
    context: {},
  };
}
