/* jslint node:true, esversion:9 */
'use strict';

const debug = require('debug')('hadithdb:liked');
const express = require('express');
const { homedir } = require('os');
const fs = require('fs');
const ejs = require('ejs');
const { Item } = require('../lib/Model');
const Utils = require('../lib/Utils');

const router = express.Router();
const name = 'liked-v6-accent-active-nav';

router.get('/', async function (req, res, next) {
  res.locals.req = req;
  res.locals.res = res;

  const admin = (req.admin);
  const editMode = (admin && req.editMode);
  const cachedFile = `${homedir}/.hadithdb/cache/${name}.html`;
  if (Utils.shouldFlushCache(req)) Utils.flushCachedFile(cachedFile);
  if (!Utils.shouldFlushCache(req) && !admin && !editMode && fs.existsSync(cachedFile)) {
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    res.end(fs.readFileSync(cachedFile));
    return;
  }

  try {
    const results = await getList();
    const refs = results.map(item => item.ref);
    const html = await ejs.renderFile(`${__dirname}/../views/hadiths_list.ejs`, {
      noadmin: true,
      results,
      page: getPage(),
      req,
      res
    });
    fs.writeFileSync(cachedFile, html);
  await Utils.indexCachedItem(refs, cachedFile);

    res.render('hadiths_list', {
      results,
      page: getPage()
    });
  } catch (err) {
    debug(`Error loading liked hadiths: ${err.message}`);
    next(err);
  }
});

router.get('/feed', async function (req, res, next) {
  res.setHeader('Content-Type', 'application/atom+xml; charset=UTF-8');
  res.setHeader('Content-Disposition', `inline; filename="hadithunlocked_${name}_atom.xml"`);
  res.locals.req = req;
  res.locals.res = res;

  const admin = (req.admin);
  const editMode = (admin && req.editMode);
  const cachedFile = `${homedir}/.hadithdb/cache/${name}_feed.xml`;
  if (Utils.shouldFlushCache(req)) Utils.flushCachedFile(cachedFile);
  if (!Utils.shouldFlushCache(req) && !admin && !editMode && fs.existsSync(cachedFile)) {
    res.end(fs.readFileSync(cachedFile));
    return;
  }

  try {
    const results = await getList();
    const refs = results.map(item => item.ref);
    const html = await ejs.renderFile(`${__dirname}/../views/hadiths_list_feed.ejs`, {
      noadmin: true,
      results,
      page: getPage('/feed'),
      req,
      res
    });
    fs.writeFileSync(cachedFile, html);
  await Utils.indexCachedItem(refs, cachedFile);

    res.render('hadiths_list_feed', {
      results,
      page: getPage('/feed')
    });
  } catch (err) {
    debug(`Error loading liked hadiths feed: ${err.message}`);
    next(err);
  }
});

router.get('/rss', async function (req, res, next) {
  res.setHeader('Content-Type', 'application/rss+xml; charset=UTF-8');
  res.setHeader('Content-Disposition', `inline; filename="hadithunlocked_${name}_rss.xml"`);
  res.locals.req = req;
  res.locals.res = res;

  const admin = (req.admin);
  const editMode = (admin && req.editMode);
  const cachedFile = `${homedir}/.hadithdb/cache/${name}_rss.xml`;
  if (Utils.shouldFlushCache(req)) Utils.flushCachedFile(cachedFile);
  if (!Utils.shouldFlushCache(req) && !admin && !editMode && fs.existsSync(cachedFile)) {
    res.end(fs.readFileSync(cachedFile));
    return;
  }

  try {
    const results = await getList();
    const refs = results.map(item => item.ref);
    const html = await ejs.renderFile(`${__dirname}/../views/hadiths_list_feed.ejs`, {
      noadmin: true,
      results,
      page: getPage('/rss'),
      req,
      res
    });
    fs.writeFileSync(cachedFile, html);
  await Utils.indexCachedItem(refs, cachedFile);

    res.render('hadiths_list_rss', {
      results,
      page: getPage('/rss')
    });
  } catch (err) {
    debug(`Error loading liked hadiths rss: ${err.message}`);
    next(err);
  }
});

module.exports = router;

async function getList() {
  const limit = global.settings.search.itemsPerPage;
  const rows = await global.query(`
    SELECT vh.*, ll.latest_like AS sort_ts
    FROM (
      SELECT hadithId, MAX(createdAt) AS latest_like
      FROM hadiths_likes
      GROUP BY hadithId
      ORDER BY latest_like DESC
      LIMIT ${limit}
    ) ll
    JOIN hadiths h ON h.id = ll.hadithId
    JOIN v_hadiths vh ON h.id = vh.hId
    ORDER BY ll.latest_like DESC
  `);
  return rows.map(r => new Item(r));
}

function getPage() {
  return {
    menu: 'Liked',
    title_en: `${global.settings.site.shortName} | Recently Liked Aḥādīths`,
    subtitle_en: 'Aḥādīths with recent likes',
    subtitle: null,
    canonical: `/${name}`,
    alternate: `/${name}`,
    feed: `${global.settings.site.url}/${name}/feed`,
    rss: `${global.settings.site.url}/${name}/rss`,
    context: {}
  };
}
