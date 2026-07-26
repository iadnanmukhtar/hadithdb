/* jslint node:true, esversion:9 */
'use strict';

const debug = require('../lib/Debug')('hadithdb:Liked');
const express = require('express');
const { homedir } = require('os');
const ejs = require('ejs');
const { Item } = require('../lib/Model');
const Utils = require('../lib/Utils');

const router = express.Router();
const name = Utils.versionedCacheName('liked');

router.get('/', async function (req, res, next) {
  res.locals.req = req;
  res.locals.res = res;

  const admin = (req.admin);
  const editMode = (admin && req.editMode);
  const cachedFile = `${homedir}/.hadithdb/cache/${name}.html`;
  if (Utils.shouldFlushCache(req)) Utils.flushCachedFile(cachedFile);
  if (!Utils.shouldFlushCache(req) && !editMode && Utils.cachedTextPathForRead(cachedFile)) {
    Utils.sendCachedHtml(res, req, cachedFile, 'text/html; charset=UTF-8');
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
    Utils.writeCachedHtml(cachedFile, html);
  await Utils.indexCachedItem(refs, cachedFile);

    res.render('hadiths_list', {
      results,
      page: getPage()
    });
  } catch (err) {
    debug.error(`Error loading liked hadiths: ${err.message}\n${err.stack || ''}`);
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
  if (!Utils.shouldFlushCache(req) && !admin && !editMode && Utils.cachedTextPathForRead(cachedFile)) {
    Utils.sendCachedTextFile(res, req, cachedFile, 'application/atom+xml; charset=UTF-8');
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
    Utils.writeCachedTextFile(cachedFile, html);
  await Utils.indexCachedItem(refs, cachedFile);

    res.render('hadiths_list_feed', {
      results,
      page: getPage('/feed')
    });
  } catch (err) {
    debug.error(`Error loading liked hadiths feed: ${err.message}\n${err.stack || ''}`);
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
  if (!Utils.shouldFlushCache(req) && !admin && !editMode && Utils.cachedTextPathForRead(cachedFile)) {
    Utils.sendCachedTextFile(res, req, cachedFile, 'application/rss+xml; charset=UTF-8');
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
    Utils.writeCachedTextFile(cachedFile, html);
  await Utils.indexCachedItem(refs, cachedFile);

    res.render('hadiths_list_rss', {
      results,
      page: getPage('/rss')
    });
  } catch (err) {
    debug.error(`Error loading liked hadiths rss: ${err.message}\n${err.stack || ''}`);
    next(err);
  }
});

module.exports = router;

async function getList() {
  await ensureLikesTypeColumn();
  const limit = global.settings.search.itemsPerPage;
  const rows = await global.query(`
    SELECT vh.*, ll.latest_like AS sort_ts
    FROM (
      SELECT hadithId, MAX(createdAt) AS latest_like
      FROM hadiths_likes
      WHERE \`type\`='hadith'
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

let likesTypeColumnReady;

async function ensureLikesTypeColumn() {
  if (!likesTypeColumnReady) {
    likesTypeColumnReady = (async () => {
      const rows = await global.query(`
        SELECT 1
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'hadiths_likes'
          AND COLUMN_NAME = 'type'
        LIMIT 1
      `);
      if (rows && rows.length)
        return;
      await global.query(`
        ALTER TABLE hadiths_likes
        ADD COLUMN \`type\` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'hadith' AFTER hadithId
      `);
      await global.query(`
        CREATE INDEX ndx_hadiths_likes_type_target_user
        ON hadiths_likes (\`type\`, hadithId, user_uid)
      `);
    })();
  }
  return likesTypeColumnReady;
}

function getPage() {
  return {
    menu: 'Liked',
    title_en: `Recently Liked Hadiths`,
    subtitle_en: 'Aḥādīths with recent likes',
    subtitle: null,
    canonical: `/${name}`,
    alternate: `/${name}`,
    feed: `${global.settings.site.url}/${name}/feed`,
    rss: `${global.settings.site.url}/${name}/rss`,
    context: {}
  };
}
