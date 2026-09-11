'use strict';

const ejs = require('ejs');
const fs = require('fs');
const path = require('path');
const Index = require('../lib/Index');
const Tafsir = require('../lib/Tafsir');
const Utils = require('../lib/Utils');

function routeHandler() {
  const router = require('../routes/books');
  return router.stack.find(layer => layer.route && layer.route.path === '/').route.stack[0].handle;
}

function request(query = {}) {
  return {
    baseUrl: '/books',
    url: '/',
    query: query,
    admin: false,
    editMode: false
  };
}

function response() {
  return {
    app: { locals: {} },
    locals: {},
    setHeader: jest.fn(),
    render: jest.fn()
  };
}

describe('books catalog performance path', () => {
  let originalBooks;
  let originalQuery;

  beforeEach(() => {
    originalBooks = global.books;
    originalQuery = global.query;
    global.books = [{ id: 1, alias: 'bukhari', hidden: 0, type: 'hadith', lang: 'ar' }];
    global.query = jest.fn();
  });

  afterEach(() => {
    global.books = originalBooks;
    global.query = originalQuery;
    jest.restoreAllMocks();
  });

  test('serves a disk cache hit before Elasticsearch, SQL, or Tafsir lookups', async () => {
    const req = request();
    const res = response();
    jest.spyOn(Utils, 'cacheFileFromFilename').mockReturnValue('/cache/_books.html');
    jest.spyOn(Utils, 'shouldFlushCache').mockReturnValue(false);
    jest.spyOn(Utils, 'cachedTextPathForRead').mockReturnValue('/cache/_books.html.gz');
    jest.spyOn(Utils, 'sendCachedHtml').mockReturnValue(true);
    jest.spyOn(Index, 'distinctTermsFromQuery');
    jest.spyOn(Tafsir, 'visibleTafsirs');

    await routeHandler()(req, res, jest.fn());

    expect(Utils.sendCachedHtml).toHaveBeenCalledWith(res, req, '/cache/_books.html', 'text/html; charset=UTF-8');
    expect(Index.distinctTermsFromQuery).not.toHaveBeenCalled();
    expect(global.query).not.toHaveBeenCalled();
    expect(Tafsir.visibleTafsirs).not.toHaveBeenCalled();
  });

  test('uses the same versioned cache path for rendering and metadata invalidation', () => {
    const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'books.js'), 'utf8');
    const updates = fs.readFileSync(path.join(__dirname, '..', 'routes', 'update.js'), 'utf8');
    expect(route).toContain("Utils.cacheFileFromFilename('_books')");
    expect(updates).toContain("Utils.flushCachedFile(Utils.cacheFileFromFilename('_books'))");
  });

  test('uses Elasticsearch for badges and writes the rendered catalog to disk', async () => {
    const req = request();
    const res = response();
    jest.spyOn(Utils, 'cacheFileFromFilename').mockReturnValue('/cache/_books.html');
    jest.spyOn(Utils, 'shouldFlushCache').mockReturnValue(false);
    jest.spyOn(Utils, 'cachedTextPathForRead').mockReturnValue(null);
    jest.spyOn(Utils, 'diskCacheEnabled').mockReturnValue(true);
    jest.spyOn(Utils, 'writeCachedHtml').mockImplementation(() => {});
    jest.spyOn(Utils, 'indexCachedItem').mockResolvedValue(undefined);
    jest.spyOn(Utils, 'sendCachedHtml').mockReturnValue(true);
    jest.spyOn(ejs, 'renderFile').mockImplementation(async (_path, locals) => {
      expect(locals.books[0].catalog_language_badge).toBe('EN-AR');
      return '<html>books</html>';
    });
    jest.spyOn(Index, 'distinctTermsFromQuery').mockResolvedValue(['bukhari']);
    jest.spyOn(Tafsir, 'visibleTafsirs').mockResolvedValue([]);
    jest.spyOn(Tafsir, 'withFirstPassages').mockResolvedValue([]);
    jest.spyOn(Tafsir, 'visibleTranslations').mockResolvedValue([]);

    await routeHandler()(req, res, jest.fn());

    expect(Index.distinctTermsFromQuery).toHaveBeenCalledWith(
      'hadiths',
      expect.objectContaining({ bool: expect.any(Object) }),
      'book_alias',
      100
    );
    expect(global.query).not.toHaveBeenCalled();
    expect(Utils.writeCachedHtml).toHaveBeenCalledWith('/cache/_books.html', '<html>books</html>');
    expect(Utils.indexCachedItem).toHaveBeenCalledWith(expect.arrayContaining(['books', 'bukhari']), '/cache/_books.html');
  });

  test('falls back to SQL when the search backend is unavailable', async () => {
    const req = request({ tab: 'history' });
    const res = response();
    jest.spyOn(Utils, 'cacheFileFromFilename').mockReturnValue('/cache/_books.html');
    jest.spyOn(Utils, 'shouldFlushCache').mockReturnValue(false);
    jest.spyOn(Utils, 'cachedTextPathForRead').mockReturnValue('/cache/_books.html.gz');
    jest.spyOn(Index, 'distinctTermsFromQuery').mockRejectedValue(new Error('search unavailable'));
    global.query.mockResolvedValue([{ book_id: 1 }]);
    jest.spyOn(Tafsir, 'visibleTafsirs').mockResolvedValue([]);
    jest.spyOn(Tafsir, 'withFirstPassages').mockResolvedValue([]);
    jest.spyOn(Tafsir, 'visibleTranslations').mockResolvedValue([]);

    await routeHandler()(req, res, jest.fn());

    expect(global.query).toHaveBeenCalledTimes(1);
    expect(res.render.mock.calls[0][1].books[0].catalog_language_badge).toBe('EN-AR');
    expect(Utils.cachedTextPathForRead).not.toHaveBeenCalled();
  });
});
