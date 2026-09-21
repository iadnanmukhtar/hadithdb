'use strict';
const Utils = require('../lib/Utils');
const Tafsir = require('../lib/Tafsir');
const QuranMushaf = require('../lib/QuranMushaf');
const router = require('../routes/search');
const base = 'https://quran.islamunlocked.com';
const handler = path => router.stack.find(layer => layer.route && layer.route.path === path).route.stack[0].handle;
const response = () => ({ setHeader: jest.fn(), end: jest.fn(), redirect: jest.fn(), status: jest.fn().mockReturnThis() });

describe('sitemap delivery', () => {
  const saved = { settings: global.settings, surahs: global.surahs, query: global.query };
  beforeEach(() => {
    global.settings = { site: { quranUrl: base, url: 'https://hadithunlocked.com' } };
    global.surahs = [];
    jest.spyOn(Utils, 'cachedTextPathForRead').mockReturnValue('/cache/quran.txt');
    jest.spyOn(Utils, 'shouldFlushCache').mockReturnValue(false);
    jest.spyOn(Utils, 'cacheFileFromFilename').mockReturnValue('/cache/quran.txt');
  });
  afterEach(() => { jest.restoreAllMocks(); Object.assign(global, saved); });
  function cachedUrls(count) {
    const urls = [`${base}/quran/review`, `${base}/quran/review?help`];
    for (let i = urls.length; i < count; i++) urls.push(`${base}/quran:test:${i}`);
    jest.spyOn(Utils, 'readCachedTextFile').mockReturnValue(urls.join('\n'));
    return urls;
  }
  const req = () => ({ hostname: 'quran.islamunlocked.com', query: {}, params: {} });

  test.each([[50000, 1], [50001, 2], [200411, 5]])('indexes %i URLs using %i bounded children', async (count, pages) => {
    cachedUrls(count);
    const res = response();
    await handler('/sitemap.xml')(req(), res, jest.fn());
    const xml = res.end.mock.calls[0][0];
    expect(xml).toContain('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect((xml.match(/<sitemap>/g) || []).length).toBe(pages);
    expect(xml).toContain(`${base}/sitemap-${pages}.txt`);
    expect(xml).not.toContain('/quran:test:');
  });
  test('child boundaries cover every URL once and nonexistent pages return a direct 404', async () => {
    const urls = cachedUrls(50001);
    const route = router.stack.find(layer => layer.route && String(layer.route.path).startsWith('/sitemap-:page')).route.stack[0].handle;
    const bodies = [];
    for (const page of [1, 2, 3, 0]) {
      const res = response();
      await route({ ...req(), params: { page: String(page) } }, res, jest.fn());
      if (page === 1 || page === 2) bodies.push(...res.end.mock.calls[0][0].trim().split('\n'));
      else { expect(res.status).toHaveBeenCalledWith(404); expect(res.redirect).not.toHaveBeenCalled(); }
    }
    expect(bodies).toEqual(urls);
  });
  test('legacy full text sitemap redirects to the index', () => {
    const res = response();
    handler('/sitemap.txt')(req(), res);
    expect(res.redirect).toHaveBeenCalledWith(301, '/sitemap.xml');
    handler('/quran/sitemap.txt')(req(), res);
    expect(res.redirect).toHaveBeenLastCalledWith(301, `${base}/sitemap.xml`);
  });
  test('keeps the Hadith sitemap index on its own hostname', async () => {
    const domain = global.settings.site.url;
    jest.spyOn(Utils, 'readCachedTextFile').mockReturnValue([
      '', '/books', '/highlights', '/titled', '/commented', '/requests', '/blog', '/mcp-server'
    ].map(path => domain + path).join('\n'));
    const res = response();
    await handler('/sitemap.xml')({ hostname: 'hadithunlocked.com', query: {} }, res, jest.fn());
    expect(res.end.mock.calls[0][0]).toContain(`${domain}/sitemap-1.txt`);
    expect(res.end.mock.calls[0][0]).not.toContain(base);
  });
  test('rebuilds stale caches missing untitled core verses, without duplicating translations', async () => {
    global.surahs = [{ num: 1, ayahs: 2 }];
    jest.spyOn(Utils, 'readCachedTextFile').mockReturnValue([
      `${base}/quran/review`, `${base}/quran/review?help`,
      `${base}/quran/translations/quran:1:1`, `${base}/quran/translations/quran:1:2`
    ].join('\n'));
    global.query = jest.fn().mockResolvedValue([
      { alias: 'quran', h1: null, h2: null },
      { alias: 'quran', h1: 1, h2: null },
      { alias: 'quran', h1: 1, h2: 1 }
    ]);
    jest.spyOn(Utils, 'diskCacheEnabled').mockReturnValue(false);
    jest.spyOn(Utils, 'writeCachedTextFile').mockImplementation(() => {});
    jest.spyOn(QuranMushaf, 'info').mockResolvedValue({ number_of_pages: 1 });
    jest.spyOn(Tafsir, 'visibleTranslations').mockResolvedValue([]);
    jest.spyOn(Tafsir, 'visibleTafsirs').mockResolvedValue([]);
    const route = router.stack.find(layer => layer.route && String(layer.route.path).startsWith('/sitemap-:page')).route.stack[0].handle;
    const res = response();
    await route({ ...req(), params: { page: '1' } }, res, jest.fn());
    const urls = res.end.mock.calls[0][0].trim().split('\n');
    expect(urls).toContain(`${base}/quran:1:1`);
    expect(urls).toContain(`${base}/quran:1:2`);
    expect(urls).not.toContain(`${base}/quran/1`);
    expect(urls).toContain(`${base}/quran/1/1`);
    expect(urls.filter(url => url === `${base}/quran/translations/quran:1:1`)).toHaveLength(1);
    expect(global.query).toHaveBeenCalledTimes(1);
  });
});
