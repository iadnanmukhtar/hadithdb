/* jslint node:true, esversion:9 */
'use strict';

const debug = require('debug')('hadithdb:commented');
const express = require('express');
const { homedir } = require('os');
const fs = require('fs');
const ejs = require('ejs');
const { Item } = require('../lib/Model');
const Utils = require('../lib/Utils');

const router = express.Router();
const name = Utils.versionedCacheName('commented');
const latestCommentedLimit = 20;

router.get('/', async function (req, res, next) {
  res.locals.req = req;
  res.locals.res = res;

  var admin = (req.admin);
  var editMode = (admin && req.editMode);
  var cachedFile = `${homedir}/.hadithdb/cache/${name}.html`;
  if (Utils.shouldFlushCache(req))
    Utils.flushCachedFile(cachedFile);
  if (!Utils.shouldFlushCache(req) && !admin && !editMode && fs.existsSync(cachedFile)) {
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    res.end(fs.readFileSync(cachedFile));
    return;
  }

  var results = await getList();

  // cache response
  var refs = [];
  for (const item of results)
    refs.push(item.ref);
  var html = await ejs.renderFile(`${__dirname}/../views/hadiths_list.ejs`, {
    noadmin: true,
    results: results,
    page: getPage(),
    req: req,
    res: res
  });
  fs.writeFileSync(cachedFile, html);
  await Utils.indexCachedItem(refs, cachedFile);

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

  var admin = (req.admin);
  var editMode = (admin && req.editMode);
  var cachedFile = `${homedir}/.hadithdb/cache/${name}_feed.xml`;
  if (Utils.shouldFlushCache(req))
    Utils.flushCachedFile(cachedFile);
  if (!Utils.shouldFlushCache(req) && !admin && !editMode && fs.existsSync(cachedFile)) {
    res.end(fs.readFileSync(cachedFile));
    return;
  }

  var results = await getList();

  // cache response
  var refs = [];
  for (const item of results)
    refs.push(item.ref);
  var html = await ejs.renderFile(`${__dirname}/../views/hadiths_list_feed.ejs`, {
    noadmin: true,
    results: results,
    page: getPage('/feed'),
    req: req,
    res: res
  });
  fs.writeFileSync(cachedFile, html);
  await Utils.indexCachedItem(refs, cachedFile);

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

  var admin = (req.admin);
  var editMode = (admin && req.editMode);
  var cachedFile = `${homedir}/.hadithdb/cache/${name}_rss.xml`;
  if (Utils.shouldFlushCache(req))
    Utils.flushCachedFile(cachedFile);
  if (!Utils.shouldFlushCache(req) && !admin && !editMode && fs.existsSync(cachedFile)) {
    res.end(fs.readFileSync(cachedFile));
    return;
  }

  var results = await getList();

  // cache response
  var refs = [];
  for (const item of results)
    refs.push(item.ref);
  var html = await ejs.renderFile(`${__dirname}/../views/hadiths_list_rss.ejs`, {
    noadmin: true,
    results: results,
    page: getPage('/rss'),
    req: req,
    res: res
  });
  fs.writeFileSync(cachedFile, html);
  await Utils.indexCachedItem(refs, cachedFile);

  res.render('hadiths_list_rss', {
    results: results,
    page: getPage('/rss')
  });
});

module.exports = router;

async function getList() {
  var results = await global.query(`
    SELECT vh.*, h.commented AS comment_count, comments.latest_comment_at
    FROM hadiths h
    JOIN v_hadiths vh ON vh.hId=h.id
    JOIN (
      SELECT hadithId, MAX(createdAt) AS latest_comment_at
      FROM hadiths_comments
      WHERE deleted IS NULL OR deleted=0
      GROUP BY hadithId
    ) comments ON comments.hadithId=h.id
    WHERE h.commented > 0
    ORDER BY comments.latest_comment_at DESC
    LIMIT ${latestCommentedLimit}`);
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
