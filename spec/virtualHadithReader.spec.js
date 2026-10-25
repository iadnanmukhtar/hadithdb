'use strict';
const Reader = require('../lib/VirtualHadithReader');
const { Book, Chapter, Section, Subsection, Library } = require('../lib/Model');
const Translations = require('../lib/HadithTranslationIndexView');
jest.mock('../lib/Debug', () => () => ({ info: jest.fn(), error: jest.fn() }));

const chapter = { book: { id: 61 }, level: 1, h1: 0.32 };
const row = { id: 14692, hId: 14692, hId_ref: 100064, book_id: 61, book_alias: 'riyad', h1: 0.32, num: '255' };
const originalQuery = global.query;
afterEach(() => { global.query = originalQuery; jest.restoreAllMocks(); });

test('a complete snapshot uses only the fast snapshot query', async () => {
  global.query = jest.fn().mockResolvedValue([row]);
  expect(await Reader.getItems(chapter, 0, 51)).toEqual([row]);
  expect(global.query).toHaveBeenCalledTimes(1);
});

test.each([1, 2, 3])('recovers an empty level-%i snapshot from source data with the same scope and pagination', async level => {
  const heading = { ...chapter, level, h2: 2, h3: 3 };
  global.query = jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: row.id }]).mockResolvedValueOnce([row]);
  expect(await Reader.getItems(heading, 50, 51)).toEqual([row]);
  const [snapshot, existence, source] = global.query.mock.calls.map(([sql]) => sql);
  expect(source).toBe(snapshot.replace('v_hadiths_virtual_snapshot', 'v_hadiths_virtual'));
  expect(source).toContain('LIMIT 50,51');
  expect(existence).toContain('LIMIT 50,1');
  for (let i = 1; i <= level; i++) {
    expect(source).toContain(`h${i}=${heading[`h${i}`]}`);
    expect(existence).toContain(`t.h${i}=${heading[`h${i}`]}`);
  }
});

test('genuinely empty headings and exhausted pages remain valid empty results', async () => {
  global.query = jest.fn().mockResolvedValue([]);
  expect(await Reader.getItems(chapter, 100, 51)).toEqual([]);
  expect(global.query).toHaveBeenCalledTimes(2);
});

test.each(['missing', 'failed'])('does not return an empty success if linked source rows are %s', async state => {
  global.query = jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: row.id }]);
  if (state === 'failed') global.query.mockRejectedValueOnce(new Error('database unavailable'));
  else global.query.mockResolvedValueOnce([]);
  await expect(Reader.getItems(chapter, 0, 51)).rejects.toMatchObject({
    status: 503, code: 'VIRTUAL_SNAPSHOT_UNAVAILABLE', headers: { 'Cache-Control': 'no-store' }
  });
});

test.each([Chapter, Section, Subsection])('%p model cannot turn unavailable source data into empty reader items', async Heading => {
  const originalSettings = global.settings;
  const library = Library._singleton;
  const originalBooks = library._books, originalInitialized = library._initialized;
  try {
    global.settings = { search: { itemsPerPage: 50 } };
    library._initialized = true;
    library._books = [new Book({ id: 61, alias: 'riyad', virtual: 1 })];
    const level = Heading === Chapter ? 1 : Heading === Section ? 2 : 3;
    const heading = new Heading({ book_id: 61, book_alias: 'riyad', level, h1: 0.32, h2: 2, h3: 3 });
    global.query = jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: row.id }]).mockResolvedValueOnce([]);
    jest.spyOn(Translations, 'attachTranslations').mockImplementation(async rows => rows);
    await expect(heading.getItems()).rejects.toMatchObject({ status: 503 });
    expect(Translations.attachTranslations).not.toHaveBeenCalled();
  } finally {
    global.settings = originalSettings;
    library._books = originalBooks;
    library._initialized = originalInitialized;
  }
});

test.each([{}, { flush: '' }])('chapter requests %j never cache a blank page when source recovery fails', async query => {
  const Utils = require('../lib/Utils');
  const Outlines = require('../lib/HadithHeadingOutlines');
  const router = require('../routes/search');
  const originalSettings = global.settings, originalBooks = global.books;
  const library = Library._singleton;
  const previousBooks = library._books, previousInitialized = library._initialized;
  try {
    const book = new Book({ id: 61, alias: 'riyad', virtual: 1, type: 'hadith', hidden: 0 });
    global.books = [book];
    global.settings = { search: { itemsPerPage: 50 } };
    library._initialized = true;
    library._books = [book];
    const heading = new Chapter({ book_id: 61, book_alias: 'riyad', level: 1, h1: 0.32, h1_count: 9 });
    jest.spyOn(Chapter, 'chapterFromRef').mockResolvedValue(heading);
    jest.spyOn(heading, 'getFirstSection').mockResolvedValue(null);
    jest.spyOn(heading, 'getSections').mockResolvedValue([]);
    jest.spyOn(Outlines, 'forChapter').mockResolvedValue({});
    jest.spyOn(Utils, 'htmlCacheFile').mockReturnValue('/cache/riyad-032.html');
    jest.spyOn(Utils, 'cachedTextPathForRead').mockReturnValue(null);
    jest.spyOn(Utils, 'flushCachedFile').mockResolvedValue();
    const write = jest.spyOn(Utils, 'writeCachedHtml').mockImplementation(() => {});
    const index = jest.spyOn(Utils, 'indexCachedItem').mockResolvedValue();
    global.query = jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: row.id }]).mockRejectedValueOnce(new Error('source unavailable'));
    const req = { params: { bookAlias: 'riyad', chapterNum: '0.32' }, query, originalUrl: '/riyad/0.32', admin: false };
    const res = { locals: {}, render: jest.fn(), setHeader: jest.fn() }, next = jest.fn();
    const route = router.stack.find(layer => layer.route?.path === '/:bookAlias/:chapterNum').route;
    await route.stack.at(-1).handle(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 503 }));
    expect(write).not.toHaveBeenCalled();
    expect(index).not.toHaveBeenCalled();
    expect(res.render).not.toHaveBeenCalled();
  } finally {
    global.settings = originalSettings;
    global.books = originalBooks;
    library._books = previousBooks;
    library._initialized = previousInitialized;
  }
});
