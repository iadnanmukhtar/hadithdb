'use strict';

const Utils = require('../lib/Utils');

describe('indexed cache invalidation failures', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('propagates a disk deletion failure to required callers', async () => {
    const cachedb = {
      allAsync: jest.fn().mockResolvedValue([{ filename: '/cache/page.html' }]),
      runAsync: jest.fn().mockResolvedValue()
    };
    jest.spyOn(Utils, 'setupCacheIndex').mockResolvedValue(cachedb);
    jest.spyOn(Utils, 'flushCachedFile').mockRejectedValue(new Error('disk cache is read-only'));

    await expect(Utils.flushCacheContaining('quran:page:1')).rejects.toThrow('disk cache is read-only');
    expect(Utils.flushCachedFile).toHaveBeenCalledWith('/cache/page.html', { strict: true });
    expect(cachedb.runAsync).not.toHaveBeenCalledWith('DELETE FROM cachendx WHERE id=?;', ['quran:page:1']);
  });

  test('retains an explicit best-effort option for non-critical maintenance', async () => {
    const cachedb = {
      allAsync: jest.fn().mockRejectedValue(new Error('cache index unavailable')),
      runAsync: jest.fn()
    };
    jest.spyOn(Utils, 'setupCacheIndex').mockResolvedValue(cachedb);

    await expect(Utils.flushCacheContaining('maintenance', { strict: false })).resolves.toBeUndefined();
  });
});
