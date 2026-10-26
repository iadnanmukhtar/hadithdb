'use strict';
const crypto = require('crypto');
const fs = require('fs');
const Utils = require('./Utils');
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Read committed metadata on every request. A changed revision/status/membership
// gives all workers a new key, including when an old render finishes after a purge.
async function revision() {
  const Community = require('./Community');
  await Community.ensure();
  return Community.sql(`SELECT p.id,p.version,p.status,p.kind,p.updated_at,p.published_at,
    a.handle,a.name,a.bio,l.slug,l.source_sha256,l.attributes_json,b.post_id AS featured
    FROM community_posts p JOIN community_authors a ON a.uid=p.author_uid
    LEFT JOIN community_blog_imports l ON l.post_id=p.id
    LEFT JOIN community_blog_posts b ON b.post_id=p.id
    WHERE l.post_id IS NOT NULL OR b.post_id IS NOT NULL ORDER BY p.id`);
}
function writeAtomically(file, html) {
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.html`;
  const compressed = Utils.cacheGzipFile(temporary);
  try {
    Utils.writeCachedHtml(temporary, html);
    if (fs.existsSync(compressed)) fs.renameSync(compressed, Utils.cacheGzipFile(file));
    else fs.renameSync(temporary, file);
  } finally {
    for (const candidate of [temporary, compressed]) {
      try { fs.unlinkSync(candidate); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
}
async function invalidate() {
  if (!Utils.diskCacheEnabled()) return;
  // The revision check remains authoritative if this local cleanup fails.
  try {
    await Promise.all([Utils.flushCacheContaining('blog:pages', { strict: true }), require('./CommunityMediaCache').invalidate()]);
  }
  catch (error) { require('./Debug')('hadithdb:BlogPageCache').error(`Blog cache cleanup failed: ${error.message}`); }
}
function middleware({ community = false } = {}) {
  return function (req, res, next) {
    prepare(req, res, community, next).then(hit => { if (!hit) next(); }).catch(next);
  };
}
async function prepare(req, res, community = false, next = error => { throw error; }) {
  const route = req.path || '/';
  if (req.admin || req.editMode || req.user || req.headers?.authorization) {
    res.setHeader('Cache-Control', 'private, no-store');
    return false;
  }
  if (!['GET', 'HEAD'].includes(req.method) || !Utils.diskCacheEnabled()
    || Object.keys(req.query || {}).some(key => !['o', 'flush'].includes(key))) return false;
  if (community ? !/^\/@[^/]+\/\d+$/.test(route) : !/^\/(?:[^/]+\/?)?$/.test(route) || /^\/(feed|rss|Attachments)\/?$/i.test(route)) {
    res.setHeader('Cache-Control', 'private, no-store');
    return false;
  }
  const rows = await revision();
  if (community && !rows.some(row => String(row.id) === route.split('/').pop() && row.featured && !row.slug && row.status === 'published' && row.kind === 'article')) return false;
  const key = hash({ revision: rows, route: (req.baseUrl || '') + route, query: { o: req.query?.o || '' },
    host: req.hostname || req.headers?.host, site: global.settings?.site, blog: global.settings?.blog,
    assets: Utils.assetVersionSuffix(), scripts: Utils.scriptAssetVersion() });
  const file = Utils.cacheFileFromFilename(key, 'html', 'pages', 'blog');
  const type = 'text/html; charset=UTF-8';
  // Always revalidate at the server, where the committed revision is checked.
  res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  res.setHeader('ETag', `"blog-${key}"`);
  const cacheRequest = Object.create(req);
  // HTTP dates have one-second precision; never let a date-only conditional
  // request hide a second publication within that second.
  if (!req.headers?.['if-none-match']) Object.defineProperty(cacheRequest, 'fresh', { value: false });
  const flush = Utils.shouldFlushCache(req);
  if (flush) await invalidate();
  if (!flush && Utils.cachedTextPathForRead(file) && Utils.sendCachedHtml(res, cacheRequest, file, type)) return true;
  const render = res.render.bind(res);
  res.render = function (view, locals, callback) {
    if (callback) return render(view, locals, callback);
    return render(view, locals, function (error, html) {
      if (error) return next(error);
      (async () => {
        if (res.statusCode === 200) {
          res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
          try {
            writeAtomically(file, html);
            await Utils.indexCachedItem(['blog:pages'], file);
            if (Utils.sendCachedHtml(res, cacheRequest, file, type)) return;
          } catch (cacheError) {
            require('./Debug')('hadithdb:BlogPageCache').error(`Unable to cache blog page: ${cacheError.message}`);
          }
        }
        if (res.statusCode !== 200) res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Type', type);
        res.send(html);
      })().catch(error => next(error));
    });
  };
  return false;
}
module.exports = { middleware, revision, invalidate, prepare };
