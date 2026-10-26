'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const Utils = require('../lib/Utils');
const Community = require('../lib/Community');
const Cache = require('../lib/BlogPageCache');
let dir, rows, writes;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blog-cache-test-'));
  rows = [{ id: 1, version: 1, status: 'published', kind: 'article', featured: 1, slug: 'first' }];
  writes = [];
  global.settings = { site: { url: 'https://example.org' }, blog: { shortName: 'blog', itemsPerPage: 5 } };
  jest.spyOn(Community, 'ensure').mockResolvedValue();
  jest.spyOn(Community, 'sql').mockImplementation(async () => JSON.parse(JSON.stringify(rows)));
  jest.spyOn(Utils, 'diskCacheEnabled').mockReturnValue(true);
  jest.spyOn(Utils, 'assetVersionSuffix').mockReturnValue('styles');
  jest.spyOn(Utils, 'scriptAssetVersion').mockReturnValue('scripts');
  jest.spyOn(Utils, 'cacheBookDirectory').mockImplementation(() => path.join(dir, 'media'));
  jest.spyOn(Utils, 'cacheFileFromFilename').mockImplementation(key => path.join(dir, key + '.html'));
  jest.spyOn(Utils, 'cachedTextPathForRead').mockImplementation(file => fs.existsSync(file) ? file : null);
  jest.spyOn(Utils, 'writeCachedHtml').mockImplementation((file, html) => { writes.push(file); fs.writeFileSync(file, html); });
  jest.spyOn(Utils, 'indexCachedItem').mockResolvedValue();
  jest.spyOn(Utils, 'shouldFlushCache').mockImplementation(req => !!req.query.flush);
  jest.spyOn(Utils, 'flushCacheContaining').mockImplementation(async () => { for (const file of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, file)); });
  jest.spyOn(Utils, 'sendCachedHtml').mockImplementation((res, req, file, type) => {
    if (!fs.existsSync(file)) return false;
    res.setHeader('Content-Type', type);
    res.end(fs.readFileSync(file, 'utf8'));
    return true;
  });
});
afterEach(() => { jest.restoreAllMocks(); fs.rmSync(dir, { recursive: true, force: true }); });
function setup(overrides = {}, body = 'published HTML') {
  const req = { method: 'GET', path: '/', baseUrl: '/blog', headers: {}, query: {}, ...overrides };
  let finish;
  const done = new Promise(resolve => { finish = resolve; });
  const res = { statusCode: 200, headers: {}, setHeader(key, value) { this.headers[key] = value; }, end: jest.fn(value => finish(value)), send: jest.fn(value => finish(value)), render: jest.fn((view, locals, callback) => callback(null, body)) };
  return { req, res, done };
}
async function visit(overrides, body) {
  const ctx = setup(overrides, body);
  const hit = await Cache.prepare(ctx.req, ctx.res, false);
  if (!hit) ctx.res.render('blog', {});
  return { ...ctx, hit, body: await ctx.done };
}
test('first request writes to disk and a later request skips rendering', async () => {
  expect((await visit()).hit).toBe(false);
  const second = await visit();
  expect(second.hit).toBe(true);
  expect(second.res.render).not.toHaveBeenCalled();
  expect(second.body).toBe('published HTML');
  expect(fs.readdirSync(dir)).toHaveLength(1);
});
test('updates, publications, unpublishing and feature changes invalidate all listing pagination', async () => {
  for (const change of [() => rows[0].version++, () => rows.push({ id: 2, version: 1, status: 'published', featured: 1 }), () => rows[0].status = 'draft', () => rows[0].featured = null]) {
    const before = await visit({ path: '/', query: { o: '5' } });
    change();
    const after = await visit({ path: '/', query: { o: '5' } }, 'new content');
    expect(after.hit).toBe(false);
    expect(after.res.headers.ETag).not.toBe(before.res.headers.ETag);
    expect(after.res.headers['Content-Type']).toBe('text/html; charset=UTF-8');
  }
});
test('an old in-flight render cannot repopulate the current revision after invalidation', async () => {
  const old = setup({}, 'stale');
  await Cache.prepare(old.req, old.res);
  rows[0].version++;
  await Cache.invalidate();
  await visit({}, 'current');
  old.res.render('blog', {});
  await old.done;
  expect((await visit()).body).toBe('current');
});
test('page offsets and host variants do not share HTML', async () => {
  await visit({ query: { o: '5' } });
  expect((await visit({ query: { o: '10' } })).hit).toBe(false);
  expect((await visit({ query: { o: '5' }, hostname: 'other.example' })).hit).toBe(false);
});
test.each([{ admin: true }, { user: { uid: 'owner' } }, { editMode: true }, { headers: { authorization: 'private' } }, { query: { preview: '1' } }])('bypasses private and preview requests: %j', async options => {
  const { req, res } = setup(options);
  expect(await Cache.prepare(req, res)).toBe(false);
  expect(Community.sql).not.toHaveBeenCalled();
  expect(writes).toHaveLength(0);
});
test('date-only conditional requests cannot hide updates within one second', async () => {
  await visit({ headers: { 'if-modified-since': new Date().toUTCString() }, fresh: true });
  const request = Utils.sendCachedHtml.mock.calls[0][1];
  expect(request.fresh).toBe(false);
});
test('only published featured community articles may use the blog cache', async () => {
  const ctx = setup({ path: '/@author/1', baseUrl: '/community' });
  expect(await Cache.prepare(ctx.req, ctx.res, true)).toBe(false); // imported slug redirects
  rows[0].slug = null;
  await Cache.prepare(ctx.req, ctx.res, true);
  ctx.res.render('community', {}); await ctx.done;
  expect(writes).toHaveLength(1);
  rows[0].status = 'hidden';
  const next = setup({ path: '/@author/1', baseUrl: '/community' });
  expect(await Cache.prepare(next.req, next.res, true)).toBe(false);
  expect(next.res.end).not.toHaveBeenCalled();
});
test('render errors and non-200 responses never populate the cache', async () => {
  const ctx = setup(); const next = jest.fn();
  ctx.res.render.mockImplementation((_view, _locals, cb) => cb(new Error('render failed')));
  await Cache.prepare(ctx.req, ctx.res, false, next);
  ctx.res.render('blog', {});
  expect(next).toHaveBeenCalledWith(expect.any(Error));
  expect(writes).toHaveLength(0);
  const missing = setup(); missing.res.statusCode = 404;
  await Cache.prepare(missing.req, missing.res);
  missing.res.render('error', {}); await missing.done;
  expect(writes).toHaveLength(0);
});

test('publication invalidation removes both cached pages and cached image bytes', async () => {
  await visit();
  const mediaDir = path.join(dir, 'media');
  fs.mkdirSync(mediaDir);
  fs.writeFileSync(path.join(mediaDir, 'cover.bin'), 'image bytes');
  // The page-index mock represents indexed HTML only; media has its own cache.
  Utils.flushCacheContaining.mockImplementation(async () => {
    for (const file of fs.readdirSync(dir)) if (file.endsWith('.html')) fs.unlinkSync(path.join(dir, file));
  });
  await Cache.invalidate();
  expect(fs.readdirSync(dir)).toEqual([]);
});

test.each(['/feed', '/rss', '/RSS/', '/Attachments/cover.png'])('blog non-page route bypasses disk caching: %s', async path => {
  const {req,res}=setup({path}); const render=res.render;
  expect(await Cache.prepare(req,res)).toBe(false);
  expect(res.render).toBe(render);
  expect(Community.sql).not.toHaveBeenCalled();
  expect(Utils.cachedTextPathForRead).not.toHaveBeenCalled();
});
test.each(['/', '/mine', '/following', '/@author'])('community feed/profile bypasses disk caching: %s', async path => {
  const {req,res}=setup({path,baseUrl:'/community'}); const render=res.render;
  expect(await Cache.prepare(req,res,true)).toBe(false);
  expect(res.render).toBe(render);
  expect(Community.sql).not.toHaveBeenCalled();
});
test.each([{kind:'note',featured:1},{kind:'article',featured:null}])('notes and ordinary articles bypass disk caching: %j', async properties => {
  Object.assign(rows[0],properties,{slug:null});
  const {req,res}=setup({path:'/@author/1',baseUrl:'/community'}); const render=res.render;
  expect(await Cache.prepare(req,res,true)).toBe(false);
  expect(res.render).toBe(render);
  expect(Utils.cachedTextPathForRead).not.toHaveBeenCalled();
});
