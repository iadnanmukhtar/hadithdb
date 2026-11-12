'use strict';
const Freshness = require('../lib/PageFreshness');
const Sitemap = require('../lib/FreshnessSitemap');
const Community = require('../lib/Community');
const ejs = require('ejs');
const fs = require('fs');
const Utils = require('../lib/Utils');
const old = '2025-01-01T10:00:00.000Z';
const updated = '2025-02-02T11:30:00.000Z';
afterEach(() => jest.restoreAllMocks());
test('unknown, invalid and future dates are omitted; render time never becomes a revision', () => {
  expect(Freshness.latest([null, undefined, '', 'bad', '2999-01-01'])).toBeUndefined();
  expect(Freshness.readers([{ lastfixed: old, lastmod: updated }, { lastfixed: updated }])).toBe(updated);
  expect(Freshness.readers([{ lastmod: updated }])).toBeUndefined();
});
test('public feed freshness ignores private drafts and owner-only update dates', () => {
  expect(Freshness.community({ items: [
    { publishedAt: old, publicUpdatedAt: updated, updatedAt: '2025-03-01' },
    { status: 'draft', activityAt: '2025-04-01' }
  ] })).toBe(updated);
  const post = Community.postView({ id: 1, kind: 'note', public_markdown: 'Visible', public_updated_at: old, updated_at: updated });
  expect(post.publicUpdatedAt).toBe(old);
  expect(post.updatedAt).toBeUndefined();
});
test('visible UTC time and WebPage structured data carry the same revision', () => {
  const page = { title_en: 'Example', canonical: '/bukhari:1', dateModified: updated };
  const locals = { page, utils: Utils, site: { name: 'Hadith Unlocked', url: 'https://example.com' }, req: { originalUrl: page.canonical, query: {} }, arabic: {} };
  const head = ejs.render(fs.readFileSync('views/sub-views/head.ejs', 'utf8'), locals);
  expect(head).toContain('"dateModified": "' + updated + '"');
  const visible = ejs.render(fs.readFileSync('views/sub-views/page_updated.ejs', 'utf8'), locals);
  expect(visible).toContain(`datetime="${updated}"`);
  expect(visible).toContain('Feb 2, 2025');
  expect(visible).toContain('UTC');
});
test('fresh sitemap separates domains, emits real revisions and keeps only public post URLs', async () => {
  const saved = global.query;
  global.query = jest.fn().mockResolvedValue([{ alias: 'quran', num: '1:1', lastfixed: updated }]);
  jest.spyOn(require('../lib/CommunitySitemap'), 'entries').mockResolvedValue([]);
  jest.spyOn(require('../lib/Sharh'), 'recentUpdatedPassages').mockResolvedValue([]);
  const feed = jest.spyOn(Community, 'feed').mockResolvedValue({ items: [
    { activity: 'post', url: '/community/p/public', publicUpdatedAt: updated },
    { activity: 'post', url: '/community/p/private', status: 'draft', publishedAt: old },
    { activity: 'like', url: '/community/p/liked', activityAt: old }
  ] });
  try {
    const quran = await Sitemap.entries({ quranOnly: true, base: 'https://quran.example' });
    expect(feed).not.toHaveBeenCalled();
    expect(quran).toEqual([{ url: 'https://quran.example/quran:1:1', modified: updated }]);
    global.query.mockResolvedValue([{ alias: 'bukhari', num: '1', lastfixed: old }]);
    const hadith = await Sitemap.entries({ quranOnly: false, base: 'https://hadith.example' });
    expect(hadith.map(entry => entry.url)).toEqual(['https://hadith.example/bukhari:1', 'https://hadith.example/community', 'https://hadith.example/community/p/public']);
    expect(Sitemap.xml(hadith)).toContain(`<lastmod>${updated}</lastmod>`);
    expect(Sitemap.xml([{ url: 'https://example.com/?a=1&b=2' }])).toContain('a=1&amp;b=2</loc></url>');
  } finally { global.query = saved; }
});
