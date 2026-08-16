'use strict';

const updateRouter = require('../routes/update');
const VirtualHadithSnapshot = require('../lib/VirtualHadithSnapshot');

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
});
