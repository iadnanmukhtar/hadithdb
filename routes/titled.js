/* jslint node:true, esversion:9 */
'use strict';

const debug = require('debug')('hadithdb:titled');
const express = require('express');
const asyncify = require('express-asyncify').default;
const { homedir } = require('os');
const fs = require('fs');
const ejs = require('ejs');
const { Item } = require('../lib/Model');
const Utils = require('../lib/Utils');

const router = asyncify(express.Router());
const name = 'titled';

router.get('/', async function (req, res, next) {
  res.locals.req = req;
  res.locals.res = res;


  var admin = (req.cookies.admin == global.settings.admin.key);
  var editMode = (admin && req.cookies.editMode == 1);
  var cachedFile = `${homedir}/.hadithdb/cache/titled.html`;
  if (!editMode && fs.existsSync(cachedFile)) {
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    res.end(fs.readFileSync(cachedFile));
    return;
  }

  var results = await getList();

  // cache response
  if (!editMode) {
    var html = await ejs.renderFile(`${__dirname}/../views/hadiths_list.ejs`, {
      results: results,
      page: getPage(),
      req: req,
      res: res
    });
    fs.writeFileSync(cachedFile, html);
  }
  
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
    (SELECT id FROM hadiths WHERE title_en IS NOT NULL OR title_en != '')
    ORDER BY lastfixed DESC
    LIMIT ${global.settings.search.itemsPerPage}`);
  return results.map(item => new Item(item));
}

function getPage(route) {
  return {
    menu: 'Recently Titled',
    title_en: `${global.settings.site.shortName} | Recently Titled`,
    subtitle_en: 'Aḥādīth recently summarized by a title',
    subtitle: null,
    canonical: `/${name}${route ? route : ''}`,
    alternate: `/${name}`,
    feed: `${global.settings.site.url}/${name}/feed`,
    rss: `${global.settings.site.url}/${name}/rss`,
    context: {},
  };
}