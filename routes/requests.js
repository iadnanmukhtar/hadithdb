/* jslint node:true, esversion:9 */
'use strict';

const debug = require('debug')('hadithdb:requests');
const express = require('express');
const { homedir } = require('os');
const fs = require('fs');
const ejs = require('ejs');
const { Item } = require('../lib/Model');
const Utils = require('../lib/Utils');

const router = express.Router();
const name = 'requests';

router.get('/', async function (req, res, next) {
  res.locals.req = req;
  res.locals.res = res;

  var admin = (req.cookies.admin == global.settings.admin.key);
  var editMode = (admin && req.cookies.editMode == 1);
  var cachedFile = `${homedir}/.hadithdb/cache/${name}.html`;
  if ('flush' in req.query)
    Utils.flushCachedFile(cachedFile);
  if (!('flush' in req.query) && !editMode && fs.existsSync(cachedFile)) {
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    res.end(fs.readFileSync(cachedFile));
    return;
  }

  var results = await getList();

  // cache response
  var refs = [];
  for (const item of results)
    refs.push(item.ref);
  Utils.indexCachedItem(refs, cachedFile);
  var html = await ejs.renderFile(`${__dirname}/../views/hadiths_list.ejs`, {
    noadmin: true,
    results: results,
    page: getPage(),
    req: req,
    res: res
  });
  fs.writeFileSync(cachedFile, html);
  
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

  var admin = (req.cookies.admin == global.settings.admin.key);
  var editMode = (admin && req.cookies.editMode == 1);
  var cachedFile = `${homedir}/.hadithdb/cache/${name}_feed.xml`;
  if ('flush' in req.query)
    Utils.flushCachedFile(cachedFile);
  if (!('flush' in req.query) && !editMode && fs.existsSync(cachedFile)) {
    res.end(fs.readFileSync(cachedFile));
    return;
  }

  var results = await getList();

  // cache response
  var refs = [];
  for (const item of results)
    refs.push(item.ref);
  Utils.indexCachedItem(refs, cachedFile);
  var html = await ejs.renderFile(`${__dirname}/../views/hadiths_list_feed.ejs`, {
    noadmin: true,
    results: results,
    page: getPage('/feed'),
    req: req,
    res: res
  });
  fs.writeFileSync(cachedFile, html);

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

  var admin = (req.cookies.admin == global.settings.admin.key);
  var editMode = (admin && req.cookies.editMode == 1);
  var cachedFile = `${homedir}/.hadithdb/cache/${name}_rss.xml`;
  if ('flush' in req.query)
    Utils.flushCachedFile(cachedFile);
  if (!('flush' in req.query) && !editMode && fs.existsSync(cachedFile)) {
    res.end(fs.readFileSync(cachedFile));
    return;
  }

  var results = await getList();

  // cache response
  var refs = [];
  for (const item of results)
    refs.push(item.ref);
  Utils.indexCachedItem(refs, cachedFile);
  var html = await ejs.renderFile(`${__dirname}/../views/hadiths_list_feed.ejs`, {
    noadmin: true,
    results: results,
    page: getPage('/rss'),
    req: req,
    res: res
  });
  fs.writeFileSync(cachedFile, html);

  res.render('hadiths_list_rss', {
    results: results,
    page: getPage('/rss')
  });
});

module.exports = router;

async function getList() {
  var results = await global.query(
    `SELECT vh.*, h.requested, h.lastmod FROM hadiths h, v_hadiths vh
    WHERE h.requested > 0
      AND h.id = vh.hId
    ORDER BY h.lastfixed DESC
    LIMIT ${global.settings.search.itemsPerPage}`);
  return results.map(item => new Item(item));
}

function getPage(route) {
  return {
    menu: 'Translation Requests',
    title_en: `${global.settings.site.shortName} | Translation Requests`,
    subtitle_en: 'Translations of aḥādīth requested to be translated',
    subtitle: null,
    canonical: `/${name}${route ? route : ''}`,
    alternate: `/${name}`,
    feed: `${global.settings.site.url}/${name}/feed`,
    rss: `${global.settings.site.url}/${name}/rss`,
    context: {},
  };
}
