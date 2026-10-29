'use strict';

const router = require('../routes/update');
const Index = require('../lib/Index');
const Books = require('../lib/Books');
const Utils = require('../lib/Utils');
const VirtualHadithSnapshot = require('../lib/VirtualHadithSnapshot');
const { Library } = require('../lib/Model');

const handler = router.stack.find(layer => layer.route?.path === '/:id/:prop').route.stack.slice(-1)[0].handle;

describe('saved heading visibility', () => {
  beforeEach(() => {
    jest.spyOn(require('debug'), 'log').mockImplementation(() => {});
    const heading = { hId: 2172, book_id: 2, book_alias: 'muslim', level: 2, h1: 26, h2: 2 };
    global.query = jest.fn(async sql => {
      if (sql.startsWith('UPDATE toc')) return { message: 'updated' };
      if (sql.includes('FROM v_toc')) return [heading];
      if (sql.includes('FROM v_hadiths')) return [{ hId: 123, h2_title_en: 'The Prohibition' }];
      return [];
    });
    jest.spyOn(Index, 'updateBulk').mockResolvedValue();
    jest.spyOn(Index, 'refresh').mockResolvedValue();
    jest.spyOn(Books, 'touchBookContentLastmodById').mockResolvedValue();
    jest.spyOn(Utils, 'cacheBookDirectory').mockReturnValue('/tmp/nonexistent-heading-visibility-cache');
    jest.spyOn(Library, 'instance', 'get').mockReturnValue({ findBook: () => ({ chapters: [] }) });
    jest.spyOn(VirtualHadithSnapshot, 'queueHeading').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete global.query;
  });

  async function submit() {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await handler({ body: { value: 'The Prohibition' }, params: { id: '2172', prop: 'toc.title_en' }, user: { uid: 'admin' } }, res, jest.fn());
    return res;
  }

  test('makes headings and embedded titles searchable before invalidating caches or returning success', async () => {
    const res = await submit();
    expect(Index.updateBulk).toHaveBeenCalledTimes(2);
    expect(Index.refresh.mock.calls).toEqual([['toc'], ['hadiths']]);
    const refreshOrder = Index.refresh.mock.invocationCallOrder;
    expect(refreshOrder[0]).toBeGreaterThan(Index.updateBulk.mock.invocationCallOrder[1]);
    expect(refreshOrder[1]).toBeLessThan(Utils.cacheBookDirectory.mock.invocationCallOrder[0]);
    expect(refreshOrder[1]).toBeLessThan(res.json.mock.invocationCallOrder[0]);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test.each(['heading bulk', 'item bulk', 'refresh'])('reports %s failure instead of success', async failure => {
    if (failure === 'heading bulk') Index.updateBulk.mockRejectedValueOnce(new Error('index unavailable'));
    if (failure === 'item bulk') Index.updateBulk.mockResolvedValueOnce().mockRejectedValueOnce(new Error('index unavailable'));
    if (failure === 'refresh') Index.refresh.mockRejectedValueOnce(new Error('index unavailable'));
    const res = await submit();
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].message).toContain('index unavailable');
    expect(Utils.cacheBookDirectory).not.toHaveBeenCalled();
  });
});
