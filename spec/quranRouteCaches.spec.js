'use strict';

const ejs = require('ejs');
const CommentaryHeadings = require('../lib/CommentaryHeadings');
const Index = require('../lib/Index');
const QuranHeadingOutlines = require('../lib/QuranHeadingOutlines');
const QuranHeadings = require('../lib/QuranHeadings');
const QuranMushaf = require('../lib/QuranMushaf');
const QuranTocSubdivisions = require('../lib/QuranTocSubdivisions');
const Tafsir = require('../lib/Tafsir');
const Utils = require('../lib/Utils');
const { Library, Section } = require('../lib/Model');

function routeHandler(router, routePath) {
  return router.stack.find(layer => layer.route && layer.route.path === routePath).route.stack[0].handle;
}

function response() {
  return {
    app: { locals: {} },
    locals: {},
    setHeader: jest.fn(),
    render: jest.fn()
  };
}

describe('restored Quran public route caches', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('serves the Tafsir catalog cache before resolving first passages', async () => {
    const router = require('../routes/tafsirs');
    const req = {
      baseUrl: '/quran/tafsir',
      url: '/',
      query: {},
      admin: false,
      editMode: false
    };
    const res = response();
    jest.spyOn(Utils, 'htmlCacheFile').mockReturnValue('/cache/_quran_tafsir.html');
    jest.spyOn(Utils, 'shouldFlushCache').mockReturnValue(false);
    jest.spyOn(Utils, 'cachedTextPathForRead').mockReturnValue('/cache/_quran_tafsir.html.gz');
    jest.spyOn(Utils, 'sendCachedHtml').mockReturnValue(true);
    jest.spyOn(Tafsir, 'visibleTafsirs');
    jest.spyOn(Tafsir, 'withFirstPassages');

    await routeHandler(router, '/')(req, res, jest.fn());

    expect(Utils.sendCachedHtml).toHaveBeenCalledWith(
      res,
      req,
      '/cache/_quran_tafsir.html',
      'text/html; charset=UTF-8'
    );
    expect(Tafsir.visibleTafsirs).not.toHaveBeenCalled();
    expect(Tafsir.withFirstPassages).not.toHaveBeenCalled();
  });

  test('flushes the Tafsir catalog disk file and its Quran memory caches', async () => {
    const router = require('../routes/tafsirs');
    const req = { baseUrl: '/quran/tafsir', url: '/?flush=1', query: { flush: '1' }, admin: false, editMode: false };
    const res = response();
    jest.spyOn(Utils, 'htmlCacheFile').mockReturnValue('/cache/_quran_tafsir.html');
    jest.spyOn(Utils, 'shouldFlushCache').mockReturnValue(true);
    jest.spyOn(Utils, 'flushCachedFile').mockResolvedValue(true);
    jest.spyOn(Utils, 'cachedTextPathForRead');
    jest.spyOn(Utils, 'diskCacheEnabled').mockReturnValue(false);
    jest.spyOn(Tafsir, 'invalidateMemoryCaches');
    jest.spyOn(Tafsir, 'visibleTafsirs').mockResolvedValue([]);
    jest.spyOn(Tafsir, 'withFirstPassages').mockResolvedValue([]);
    jest.spyOn(QuranTocSubdivisions, 'invalidateAll');
    jest.spyOn(QuranMushaf, 'invalidateAll');

    await routeHandler(router, '/')(req, res, jest.fn());

    expect(Utils.flushCachedFile).toHaveBeenCalledWith('/cache/_quran_tafsir.html', { strict: true });
    expect(Tafsir.invalidateMemoryCaches).toHaveBeenCalled();
    expect(QuranTocSubdivisions.invalidateAll).toHaveBeenCalled();
    expect(QuranMushaf.invalidateAll).toHaveBeenCalled();
    expect(Utils.cachedTextPathForRead).not.toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store, no-cache, must-revalidate');
  });

  test('writes and indexes a Tafsir catalog cache miss', async () => {
    const tafsir = { alias: 'mokhtasar', slug: 'mokhtasar' };
    const router = require('../routes/tafsirs');
    const req = { baseUrl: '/quran/tafsir', url: '/', query: {}, admin: false, editMode: false };
    const res = response();
    jest.spyOn(Utils, 'htmlCacheFile').mockReturnValue('/cache/_quran_tafsir.html');
    jest.spyOn(Utils, 'shouldFlushCache').mockReturnValue(false);
    jest.spyOn(Utils, 'cachedTextPathForRead').mockReturnValue(null);
    jest.spyOn(Utils, 'diskCacheEnabled').mockReturnValue(true);
    jest.spyOn(Utils, 'writeCachedHtml').mockImplementation(() => {});
    jest.spyOn(Utils, 'indexCachedItem').mockResolvedValue(undefined);
    jest.spyOn(Utils, 'sendCachedHtml').mockReturnValue(true);
    jest.spyOn(ejs, 'renderFile').mockResolvedValue('<html>tafsir catalog</html>');
    jest.spyOn(Tafsir, 'visibleTafsirs').mockResolvedValue([tafsir]);
    jest.spyOn(Tafsir, 'withFirstPassages').mockResolvedValue([tafsir]);

    await routeHandler(router, '/')(req, res, jest.fn());

    expect(Utils.writeCachedHtml).toHaveBeenCalledWith('/cache/_quran_tafsir.html', '<html>tafsir catalog</html>');
    expect(Utils.indexCachedItem).toHaveBeenCalledWith(
      expect.arrayContaining(['tafsirs', 'tafsir:books', 'tafsir:mokhtasar:catalog']),
      '/cache/_quran_tafsir.html'
    );
  });

  test('serves a translation TOC cache before loading Quran headings or coverage', async () => {
    const translation = { id: 73, alias: 'en-hilali-khan', source: 'local', type: 'trans', hidden: 0 };
    global.books = [{ id: 1, alias: 'quran', hidden: 0 }];
    global.commentaries = [translation];
    const router = require('../routes/search');
    const req = {
      params: { commentaryAlias: translation.alias },
      query: {},
      originalUrl: `/quran/${translation.alias}`,
      admin: false,
      editMode: false
    };
    const res = response();
    jest.spyOn(Utils, 'cacheReqToFilename').mockReturnValue(`_quran_${translation.alias}`);
    jest.spyOn(Utils, 'cacheFileFromFilename').mockReturnValue(`/cache/_quran_${translation.alias}.html`);
    jest.spyOn(Utils, 'shouldFlushCache').mockReturnValue(false);
    jest.spyOn(Utils, 'cachedTextPathForRead').mockReturnValue(`/cache/_quran_${translation.alias}.html.gz`);
    jest.spyOn(Utils, 'sendCachedHtml').mockReturnValue(true);
    jest.spyOn(Tafsir, 'sitemapPassages');

    await routeHandler(router, '/quran/:commentaryAlias')(req, res, jest.fn());

    expect(Utils.sendCachedHtml).toHaveBeenCalledWith(
      res,
      req,
      `/cache/_quran_${translation.alias}.html`,
      'text/html; charset=UTF-8'
    );
    expect(Tafsir.sitemapPassages).not.toHaveBeenCalled();
  });

  test('writes and indexes a translation TOC cache miss', async () => {
    const translation = { id: 73, alias: 'en-hilali-khan', source: 'local', type: 'trans', hidden: 0 };
    global.books = [{ id: 1, alias: 'quran', hidden: 0 }];
    global.commentaries = [translation];
    global.surahs = [];
    const router = require('../routes/search');
    const req = { params: { commentaryAlias: translation.alias }, query: {}, originalUrl: `/quran/${translation.alias}`, admin: false, editMode: false };
    const res = response();
    jest.spyOn(Utils, 'cacheReqToFilename').mockReturnValue(`_quran_${translation.alias}`);
    jest.spyOn(Utils, 'cacheFileFromFilename').mockReturnValue(`/cache/_quran_${translation.alias}.html`);
    jest.spyOn(Utils, 'shouldFlushCache').mockReturnValue(false);
    jest.spyOn(Utils, 'cachedTextPathForRead').mockReturnValue(null);
    jest.spyOn(Utils, 'diskCacheEnabled').mockReturnValue(true);
    jest.spyOn(Utils, 'writeCachedHtml').mockImplementation(() => {});
    jest.spyOn(Utils, 'indexCachedItem').mockResolvedValue(undefined);
    jest.spyOn(Utils, 'sendCachedHtml').mockReturnValue(true);
    jest.spyOn(ejs, 'renderFile').mockResolvedValue('<html>translation toc</html>');
    jest.spyOn(Library, 'instance', 'get').mockReturnValue({ findBook: jest.fn().mockReturnValue({ getChapters: jest.fn().mockResolvedValue([]) }) });
    jest.spyOn(Tafsir, 'visibleTranslations').mockResolvedValue([translation]);
    jest.spyOn(Tafsir, 'sitemapPassages').mockResolvedValue([]);
    jest.spyOn(QuranTocSubdivisions, 'juzRows').mockResolvedValue([]);
    jest.spyOn(QuranTocSubdivisions, 'manzilRows').mockResolvedValue([]);
    jest.spyOn(QuranTocSubdivisions, 'quranSectionRangesBySurah').mockResolvedValue({});
    jest.spyOn(CommentaryHeadings, 'introductionArticles').mockResolvedValue([]);

    await routeHandler(router, '/quran/:commentaryAlias')(req, res, jest.fn());

    expect(Utils.writeCachedHtml).toHaveBeenCalledWith(`/cache/_quran_${translation.alias}.html`, '<html>translation toc</html>');
    expect(Utils.indexCachedItem).toHaveBeenCalledWith(
      expect.arrayContaining([`translation:${translation.alias}`, `translation:${translation.alias}:toc`]),
      `/cache/_quran_${translation.alias}.html`
    );
  });

  test('serves an all-translations passage cache before querying the Quran index', async () => {
    global.surahs = [{ num: 1, ayahs: 7, name_en: 'al-Fatihah', name_ar: 'الفاتحة' }];
    const router = require('../routes/translations');
    const req = {
      baseUrl: '/quran/translations',
      url: '/quran:1:1',
      params: { ref: 'quran:1:1' },
      query: {},
      admin: false,
      editMode: false
    };
    const res = response();
    jest.spyOn(Utils, 'htmlCacheFile').mockReturnValue('/cache/_quran_translations_quran:1:1.html');
    jest.spyOn(Utils, 'shouldFlushCache').mockReturnValue(false);
    jest.spyOn(Utils, 'cachedTextPathForRead').mockReturnValue('/cache/_quran_translations_quran:1:1.html.gz');
    jest.spyOn(Utils, 'sendCachedHtml').mockReturnValue(true);
    jest.spyOn(Index, 'docsFromQueryString');

    await routeHandler(router, '/:ref')(req, res, jest.fn());

    expect(Utils.sendCachedHtml).toHaveBeenCalledWith(
      res,
      req,
      '/cache/_quran_translations_quran:1:1.html',
      'text/html; charset=UTF-8'
    );
    expect(Index.docsFromQueryString).not.toHaveBeenCalled();
  });

  test('writes and indexes an all-translations passage cache miss', async () => {
    global.surahs = [{ num: 1, ayahs: 7, name_en: 'al-Fatihah', name_ar: 'الفاتحة' }];
    const router = require('../routes/translations');
    const req = { baseUrl: '/quran/translations', url: '/quran:1:1', params: { ref: 'quran:1:1' }, query: {}, admin: false, editMode: false };
    const res = response();
    const chapter = { getSections: jest.fn().mockResolvedValue([]) };
    const section = { getChapter: jest.fn().mockResolvedValue(chapter) };
    jest.spyOn(Utils, 'htmlCacheFile').mockReturnValue('/cache/_quran_translations_quran:1:1.html');
    jest.spyOn(Utils, 'shouldFlushCache').mockReturnValue(false);
    jest.spyOn(Utils, 'cachedTextPathForRead').mockReturnValue(null);
    jest.spyOn(Utils, 'diskCacheEnabled').mockReturnValue(true);
    jest.spyOn(Utils, 'writeCachedHtml').mockImplementation(() => {});
    jest.spyOn(Utils, 'indexCachedItem').mockResolvedValue(undefined);
    jest.spyOn(Utils, 'sendCachedHtml').mockReturnValue(true);
    jest.spyOn(ejs, 'renderFile').mockResolvedValue('<html>all translations</html>');
    jest.spyOn(Index, 'docsFromQueryString').mockResolvedValue([{
      hId: 10,
      ref: 'quran:1:1',
      book_alias: 'quran',
      h1: 1,
      num: '1',
      numInChapter: 1,
      body: 'Arabic',
      body_en: 'English'
    }]);
    jest.spyOn(QuranHeadings, 'sectionForAyah').mockResolvedValue(section);
    jest.spyOn(QuranMushaf, 'pageForRef').mockResolvedValue(1);

    await routeHandler(router, '/:ref')(req, res, jest.fn());

    expect(Utils.writeCachedHtml).toHaveBeenCalledWith('/cache/_quran_translations_quran:1:1.html', '<html>all translations</html>');
    expect(Utils.indexCachedItem).toHaveBeenCalledWith(
      expect.arrayContaining(['quran:1:1', 'quran:surah:1', 'translations:quran:1:1']),
      '/cache/_quran_translations_quran:1:1.html'
    );
  });

  test('serves a warm Mushaf page before resolving its section', async () => {
    global.books = [{ id: 1, alias: 'quran', hidden: 0 }];
    const router = require('../routes/search');
    const req = {
      url: '/quran/page/1',
      params: { page: '1' },
      query: {},
      admin: false,
      editMode: false
    };
    const res = response();
    jest.spyOn(QuranMushaf, 'info').mockResolvedValue({ number_of_pages: 604 });
    jest.spyOn(Utils, 'cacheReqToFilename').mockReturnValue('_quran_page_1');
    jest.spyOn(Utils, 'cacheFileFromFilename').mockImplementation(filename => `/cache/${filename}.html`);
    jest.spyOn(Utils, 'shouldFlushCache').mockReturnValue(false);
    jest.spyOn(Utils, 'cachedTextPathForRead').mockReturnValue('/cache/_quran_page_1__script-uthmani.html.gz');
    jest.spyOn(Utils, 'sendCachedHtml').mockReturnValue(true);
    jest.spyOn(QuranMushaf, 'sectionForPage');

    await routeHandler(router, '/quran/page/:page')(req, res, jest.fn());

    expect(Utils.sendCachedHtml).toHaveBeenCalledWith(
      res,
      req,
      '/cache/_quran_page_1__script-uthmani.html',
      'text/html; charset=UTF-8'
    );
    expect(QuranMushaf.sectionForPage).not.toHaveBeenCalled();
  });

  test('flushes every disk variant and the in-memory source for a Mushaf page', async () => {
    global.books = [{ id: 1, alias: 'quran', hidden: 0 }];
    const router = require('../routes/search');
    const req = {
      url: '/quran/page/1?flush=1',
      params: { page: '1' },
      query: { flush: '1' },
      cookies: { quranScript: 'warsh' },
      admin: false,
      editMode: false
    };
    const res = response();
    const next = jest.fn();
    jest.spyOn(QuranMushaf, 'info').mockResolvedValue({ number_of_pages: 604 });
    jest.spyOn(QuranMushaf, 'invalidatePage');
    jest.spyOn(QuranMushaf, 'invalidateMappings');
    jest.spyOn(QuranMushaf, 'sectionForPage').mockResolvedValue(null);
    jest.spyOn(QuranTocSubdivisions, 'invalidateAll');
    jest.spyOn(Utils, 'cacheReqToFilename').mockReturnValue('_quran_page_1');
    jest.spyOn(Utils, 'cacheFileFromFilename').mockImplementation(filename => `/cache/${filename}.html`);
    jest.spyOn(Utils, 'shouldFlushCache').mockReturnValue(true);
    jest.spyOn(Utils, 'flushCacheContaining').mockResolvedValue();
    jest.spyOn(Utils, 'flushCachedFile').mockResolvedValue(true);
    jest.spyOn(Utils, 'cachedTextPathForRead');

    await routeHandler(router, '/quran/page/:page')(req, res, next);

    expect(Utils.flushCacheContaining).toHaveBeenCalledWith('quran:page:1');
    expect(Utils.flushCachedFile).toHaveBeenCalledWith('/cache/_quran_page_1__script-warsh.html', { strict: true });
    expect(QuranMushaf.invalidatePage).toHaveBeenCalledWith(1);
    expect(QuranMushaf.invalidateMappings).toHaveBeenCalled();
    expect(QuranTocSubdivisions.invalidateAll).toHaveBeenCalled();
    expect(Utils.cachedTextPathForRead).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  test.each(['uthmani', 'indo-pak', 'warsh'])('uses a separate Mushaf cache key for the %s script', async script => {
    global.books = [{ id: 1, alias: 'quran', hidden: 0 }];
    const router = require('../routes/search');
    const req = {
      url: '/quran/page/1',
      params: { page: '1' },
      query: {},
      cookies: { quranScript: script },
      admin: false,
      editMode: false
    };
    const res = response();
    const expectedFile = `/cache/_quran_page_1__script-${script}.html`;
    jest.spyOn(QuranMushaf, 'info').mockResolvedValue({ number_of_pages: 604 });
    jest.spyOn(Utils, 'cacheReqToFilename').mockReturnValue('_quran_page_1');
    jest.spyOn(Utils, 'cacheFileFromFilename').mockImplementation(filename => `/cache/${filename}.html`);
    jest.spyOn(Utils, 'shouldFlushCache').mockReturnValue(false);
    jest.spyOn(Utils, 'cachedTextPathForRead').mockReturnValue(`${expectedFile}.gz`);
    jest.spyOn(Utils, 'sendCachedHtml').mockReturnValue(true);
    jest.spyOn(QuranMushaf, 'sectionForPage');

    await routeHandler(router, '/quran/page/:page')(req, res, jest.fn());

    expect(Utils.cacheFileFromFilename).toHaveBeenCalledWith(`_quran_page_1__script-${script}`, 'html');
    expect(Utils.sendCachedHtml).toHaveBeenCalledWith(res, req, expectedFile, 'text/html; charset=UTF-8');
    expect(QuranMushaf.sectionForPage).not.toHaveBeenCalled();
  });

  test('writes and indexes a script-and-ayah-specific Mushaf page cache miss', async () => {
    global.books = [{ id: 1, alias: 'quran', hidden: 0 }];
    global.surahs = [{ num: 1, ayahs: 7, name_en: 'al-Fatihah', name_ar: 'الفاتحة' }];
    const router = require('../routes/search');
    const req = {
      url: '/quran/page/1?ayah=1:1',
      params: { page: '1' },
      query: { ayah: '1:1' },
      cookies: { quranScript: 'warsh' },
      admin: false,
      editMode: false
    };
    const res = response();
    const chapter = {
      getPrev: jest.fn().mockResolvedValue(null),
      getNext: jest.fn().mockResolvedValue(null),
      getSections: jest.fn().mockResolvedValue([])
    };
    const section = {
      getPrev: jest.fn().mockResolvedValue(null),
      getNext: jest.fn().mockResolvedValue(null),
      getChapter: jest.fn().mockResolvedValue(chapter)
    };
    const mushaf = {
      number: 1,
      info: { number_of_pages: 604 },
      basmallahWords: [],
      lines: [{
        line_type: 'ayah',
        words: [{ surah: 1, ayah: 1, word: 1, text: 'بسم', is_ayah_marker: 0 }]
      }]
    };
    jest.spyOn(QuranMushaf, 'info').mockResolvedValue(mushaf.info);
    jest.spyOn(QuranMushaf, 'sectionForPage').mockResolvedValue({ surah: 1, h2: 1 });
    jest.spyOn(QuranMushaf, 'page').mockResolvedValue(mushaf);
    jest.spyOn(Section, 'sectionFromRef').mockResolvedValue(section);
    jest.spyOn(QuranTocSubdivisions, 'juzRows').mockResolvedValue([]);
    jest.spyOn(QuranTocSubdivisions, 'quranSectionRangesBySurah').mockResolvedValue({});
    jest.spyOn(QuranTocSubdivisions, 'quranSubsectionRangesBySurah').mockResolvedValue({});
    jest.spyOn(QuranHeadingOutlines, 'forSurahs').mockResolvedValue({});
    jest.spyOn(Utils, 'cacheReqToFilename').mockReturnValue('_quran_page_1');
    jest.spyOn(Utils, 'cacheFileFromFilename').mockImplementation(filename => `/cache/${filename}.html`);
    jest.spyOn(Utils, 'shouldFlushCache').mockReturnValue(false);
    jest.spyOn(Utils, 'cachedTextPathForRead').mockReturnValue(null);
    jest.spyOn(Utils, 'diskCacheEnabled').mockReturnValue(true);
    jest.spyOn(Utils, 'writeCachedHtml').mockImplementation(() => {});
    jest.spyOn(Utils, 'indexCachedItem').mockResolvedValue(undefined);
    jest.spyOn(Utils, 'sendCachedHtml').mockReturnValue(true);
    jest.spyOn(ejs, 'renderFile').mockResolvedValue('<html>mushaf page</html>');

    await routeHandler(router, '/quran/page/:page')(req, res, jest.fn());

    expect(ejs.renderFile).toHaveBeenCalledWith(
      expect.stringContaining('/views/quran_mushaf.ejs'),
      expect.objectContaining({ selectedAyahRef: '1:1', memorize: false, review: false })
    );
    expect(Utils.writeCachedHtml).toHaveBeenCalledWith('/cache/_quran_page_1__script-warsh__ayah-1-1.html', '<html>mushaf page</html>');
    expect(Utils.indexCachedItem).toHaveBeenCalledWith(
      expect.arrayContaining(['quran', 'book:quran', 'quran:page:1', 'quran:surah:1']),
      '/cache/_quran_page_1__script-warsh__ayah-1-1.html'
    );
  });

  test.each([
    ['Memorize', { memorize: '' }],
    ['Mudhakkir review', { review: '1:1' }],
    ['Mudhakkir review state', { reviewRetry: '1' }]
  ])('does not read or write the disk cache for %s requests', async (label, query) => {
    global.books = [{ id: 1, alias: 'quran', hidden: 0 }];
    const router = require('../routes/search');
    const req = {
      url: `/quran/page/1?${new URLSearchParams(query)}`,
      params: { page: '1' },
      query: query,
      admin: false,
      editMode: false
    };
    const res = response();
    const next = jest.fn();
    jest.spyOn(QuranMushaf, 'info').mockResolvedValue({ number_of_pages: 604 });
    jest.spyOn(QuranMushaf, 'sectionForPage').mockResolvedValue(null);
    jest.spyOn(Utils, 'cachedTextPathForRead');
    jest.spyOn(Utils, 'writeCachedHtml');

    await routeHandler(router, '/quran/page/:page')(req, res, next);

    expect(QuranMushaf.sectionForPage).toHaveBeenCalledWith(1);
    expect(Utils.cachedTextPathForRead).not.toHaveBeenCalled();
    expect(Utils.writeCachedHtml).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });
});
