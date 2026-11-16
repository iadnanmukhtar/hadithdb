'use strict';

const updateRouter = require('../routes/update');
const debugFactory = require('debug');
const Books = require('../lib/Books');
const Index = require('../lib/Index');
const Utils = require('../lib/Utils');
const VirtualHadithSnapshot = require('../lib/VirtualHadithSnapshot');

function updateHandler() {
  const layer = updateRouter.stack.find(item => item.route && item.route.path === '/:id/:prop');
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function request() {
  return {
    body: { value: 'Updated text' },
    params: { id: '123', prop: 'hadith.body_en' },
    user: { uid: 'admin' }
  };
}

function response() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

describe('admin content cache invalidation', () => {
  const item = {
    id: 123,
    hId: 123,
    book_id: 1,
    book_alias: 'bukhari',
    h1: 1,
    h2: 1,
    num: '1',
    ref: 'bukhari:1',
    body_en: 'Updated text'
  };

  beforeEach(() => {
    global.query = jest.fn(async query => {
      if (/^UPDATE hadiths SET/.test(query.trim()))
        return { affectedRows: 1, message: 'updated' };
      if (query === 'SELECT id,tocId FROM hadiths WHERE id=123 LIMIT 1')
        return [{ id: 123, tocId: 456 }];
      if (query.includes('FROM hadiths h') && query.includes('WHERE h.id=123 LIMIT 1'))
        return [item];
      return [];
    });
    jest.spyOn(Books, 'touchBookContentLastmodById').mockResolvedValue();
    jest.spyOn(Index, 'update').mockResolvedValue();
    jest.spyOn(require('../lib/RuntimeRefresh'), 'publish').mockResolvedValue();
    jest.spyOn(VirtualHadithSnapshot, 'refreshHadith').mockResolvedValue();
    jest.spyOn(VirtualHadithSnapshot, 'queueHadith').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete global.query;
  });

  test('finishes indexed disk-cache invalidation before returning success', async () => {
    jest.spyOn(Utils, 'flushCacheContaining').mockResolvedValue();
    const res = response();

    await updateHandler()(request(), res, jest.fn());

    expect(Books.touchBookContentLastmodById).toHaveBeenCalledWith(1);
    expect(Index.update).toHaveBeenCalledWith('hadiths', item, { force: true, refresh: true });
    const reads = global.query.mock.calls.map(([sql]) => sql);
    expect(reads.some(sql => /FROM v_hadiths\s/.test(sql))).toBe(false);
    expect(reads.filter(sql => sql.includes('WHERE h.id=123 LIMIT 1'))).toHaveLength(2);
    expect(Utils.flushCacheContaining).toHaveBeenCalledWith('bukhari:1');
    expect(Utils.flushCacheContaining.mock.invocationCallOrder[0]).toBeLessThan(res.json.mock.invocationCallOrder[0]);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('reports a pending refresh when cache invalidation fails after saving', async () => {
    jest.spyOn(debugFactory, 'log').mockImplementation(() => {});
    jest.spyOn(Utils, 'flushCacheContaining').mockRejectedValue(new Error('cache index unavailable'));
    const res = response();

    await updateHandler()(request(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].refreshPending).toBe(true);
    expect(res.json.mock.calls[0][0].warning).toBe(true);
  });
});
