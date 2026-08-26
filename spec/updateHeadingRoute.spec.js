'use strict';

const updateRouter = require('../routes/update');
const Books = require('../lib/Books');
const QuranMushaf = require('../lib/QuranMushaf');
const Utils = require('../lib/Utils');
const VirtualHadithSnapshot = require('../lib/VirtualHadithSnapshot');
const { Library } = require('../lib/Model');
const MySQL = require('mysql');

function updateHandler() {
  const layer = updateRouter.stack.find(item => item.route && item.route.path === '/:id/:prop');
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

async function submitTitle(baseUrl) {
  const queries = [];
  global.query = jest.fn(async query => {
    queries.push(query);
    if (query.includes("WHERE book_alias='quran' AND level=2 AND h1=23 AND h2=1"))
      return [{ id: 999, tId: 999 }];
    if (/^UPDATE toc SET/.test(query))
      return { message: 'updated' };
    return [];
  });
  const req = {
    baseUrl: baseUrl,
    body: {
      value: 'Tafsir of al-Fatihah',
      quranSectionPath: '/hakim/23/1'
    },
    params: { id: '20477', prop: 'toc.title_en' },
    user: { uid: 'admin' }
  };
  const res = {
    status: jest.fn(),
    end: jest.fn()
  };

  await updateHandler()(req, res, jest.fn());
  return { queries, res };
}

describe('heading title update route', () => {
  beforeAll(() => {
    jest.spyOn(VirtualHadithSnapshot, 'queueHeading').mockImplementation(() => {});
  });

  afterAll(() => {
    VirtualHadithSnapshot.queueHeading.mockRestore();
  });

  afterEach(() => {
    delete global.query;
    delete global.library;
  });

  test('keeps a Hadith section update on its submitted heading id', async () => {
    const { queries, res } = await submitTitle('/api/update');

    expect(queries).toContainEqual(expect.stringMatching(/UPDATE toc SET[\s\S]*WHERE id=20477$/));
    expect(queries.some(query => query.includes("book_alias='quran' AND level=2"))).toBe(false);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('retains canonical Quran path remapping on the Quran update endpoint', async () => {
    const { queries, res } = await submitTitle('/quran/api/update');

    expect(queries).toContainEqual(expect.stringMatching(/UPDATE toc SET[\s\S]*WHERE id=999$/));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('preserves both escaped literal and formatting backticks when saving a heading introduction', async () => {
    const value = 'Ubayy bin Ka\\`b said, `اقْرَأْ`.';
    const queries = [];
    global.query = jest.fn(async query => {
      queries.push(query);
      if (/^UPDATE toc SET/.test(query))
        return { message: 'updated' };
      return [];
    });
    const req = {
      baseUrl: '/quran/api/update',
      body: { value },
      params: { id: '139789', prop: 'toc.intro_en' },
      user: { uid: 'admin' }
    };
    const res = { status: jest.fn(), end: jest.fn() };

    await updateHandler()(req, res, jest.fn());

    const updateQuery = queries.find(query => /^UPDATE toc SET/.test(query));
    expect(updateQuery).toContain(`intro_en=${MySQL.escape(value)}`);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('invalidates cross-route disk keys and Mushaf memory after a Quran heading edit', async () => {
    const heading = {
      id: 999,
      hId: 999,
      tId: 999,
      book_id: 0,
      book_alias: 'quran',
      level: 2,
      h1: 1,
      h2: 1,
      start: '1:1',
      end: '1:7',
      count: 7
    };
    global.surahs = [{ num: 1, ayahs: 7, ayat: 7 }];
    jest.spyOn(Library, 'instance', 'get').mockReturnValue({
      findBook: jest.fn().mockReturnValue({ chapters: [] })
    });
    global.query = jest.fn(async query => {
      if (/^UPDATE toc SET/.test(query.trim()))
        return { message: 'updated' };
      if (query.includes('FROM v_toc WHERE hId=999'))
        return [heading];
      return [];
    });
    jest.spyOn(Books, 'touchBookContentLastmodById').mockResolvedValue();
    jest.spyOn(Utils, 'flushCacheContaining').mockResolvedValue();
    jest.spyOn(Utils, 'cacheBookDirectory').mockReturnValue('/tmp/hadithdb-missing-quran-cache');
    jest.spyOn(QuranMushaf, 'pageForRef').mockResolvedValue(1);
    jest.spyOn(QuranMushaf, 'invalidatePage');
    jest.spyOn(QuranMushaf, 'invalidateMappings');
    const req = {
      baseUrl: '/quran/api/update',
      body: { value: 'The Opening' },
      params: { id: '999', prop: 'toc.title_en' },
      user: { uid: 'admin' }
    };
    const res = { status: jest.fn(), end: jest.fn() };

    await updateHandler()(req, res, jest.fn());

    expect(Utils.flushCacheContaining).toHaveBeenCalledWith('quran:surah:1');
    expect(Utils.flushCacheContaining).toHaveBeenCalledWith('quran:navigation-tocs');
    expect(QuranMushaf.invalidatePage).toHaveBeenCalledWith(1);
    expect(QuranMushaf.invalidateMappings).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
