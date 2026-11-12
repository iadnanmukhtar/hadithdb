'use strict';
const Tafsir = require('../lib/Tafsir');
const Index = require('../lib/Index');
const Books = require('../lib/Books');
const Sitemap = require('../lib/FreshnessSitemap');
const stamp = '2025-02-02T11:30:00.000Z';
const saved = { query: global.query, dbPool: global.dbPool, tafsirCarouselBooks: global.tafsirCarouselBooks };
afterEach(() => { jest.restoreAllMocks(); Object.assign(global, saved); });
test('local commentary entries retain revision dates from the index and SQL fallback', async () => {
  const book = { alias: 'test', source: 'local', lang: 'en', format: 'txt' };
  const row = { id: 1, surah: 2, ayahFrom: 1, ayahTo: 3, text_en: 'Commentary', lastmod: stamp };
  const index = jest.spyOn(Index, 'docsFromQuery').mockResolvedValue([row]);
  expect((await Tafsir.tafsirEntries(book, 2, 1))[0].lastmod).toBe(stamp);
  index.mockRejectedValue(Object.assign(new Error('Unavailable'), { status: 503 }));
  jest.spyOn(Books, 'commentaryJoin').mockResolvedValue({ from: 'commentaries hc', join: 'JOIN books bc ON bc.id=hc.bookId', typePredicate: "bc.type='tafsir'" });
  global.dbPool = { escape: require('mysql').escape };
  global.query = jest.fn().mockResolvedValue([row]);
  expect((await Tafsir.tafsirEntries(book, 2, 1))[0].lastmod).toBe(stamp);
  expect(global.query.mock.calls[0][0]).toContain('hc.lastmod');
});
test('updates sitemap uses canonical tafsir ranges and only visible local catalog aliases', async () => {
  global.tafsirCarouselBooks = [
    { alias: 'test', slug: 'test-tafsir', source: 'local' },
    { alias: 'remote', source: 'remote' }
  ];
  global.dbPool = { escape: require('mysql').escape };
  jest.spyOn(Books, 'commentaryJoin').mockResolvedValue({ from: 'commentaries hc', join: 'JOIN books bc ON bc.id=hc.bookId', typePredicate: "bc.type='tafsir'" });
  global.query = jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([
    { alias: 'test', surah: 2, ayahFrom: 1, ayahTo: 3, lastmod: stamp },
    { alias: 'hidden', surah: 2, ayahFrom: 1, ayahTo: 3, lastmod: stamp }
  ]);
  const entries = await Sitemap.entries({ quranOnly: true, base: 'https://quran.example' });
  expect(entries).toEqual([{ url: 'https://quran.example/quran/tafsir/test-tafsir/quran:2:1-3', modified: stamp }]);
  const sql = global.query.mock.calls[1][0];
  expect(sql).toContain('bc.hidden=0');
  expect(sql).toContain("bc.alias IN ('test')");
  expect(sql).toContain('LIMIT 1000');
  expect(Sitemap.xml(entries)).toContain(`<lastmod>${stamp}</lastmod>`);
});
