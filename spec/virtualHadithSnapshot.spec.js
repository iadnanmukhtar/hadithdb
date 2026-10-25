'use strict';
const Snapshot = require('../lib/VirtualHadithSnapshot');
const Utils = require('../lib/Utils');
const originalQuery = global.query;
afterEach(() => { global.query = originalQuery; jest.restoreAllMocks(); });

test('invalidates pages created during refresh only after the new snapshot commits', async () => {
  let commit;
  global.query = jest.fn().mockReturnValueOnce(new Promise(resolve => { commit = resolve; }))
    .mockResolvedValueOnce([{ alias: 'riyad' }]);
  const flush = jest.spyOn(Utils, 'flushBookDiskCache').mockResolvedValue({ files: 1 });
  const refresh = Snapshot.refreshBook(61);
  expect(global.query).toHaveBeenCalledWith('CALL refresh_v_hadiths_virtual_snapshot(61)');
  expect(flush).not.toHaveBeenCalled();
  commit([]);
  await refresh;
  expect(flush).toHaveBeenCalledWith('riyad', { strict: true });
});

test('retains the prior cache if a snapshot refresh fails', async () => {
  global.query = jest.fn().mockRejectedValue(new Error('snapshot insert failed'));
  const flush = jest.spyOn(Utils, 'flushBookDiskCache').mockResolvedValue({});
  await expect(Snapshot.refreshBook(61)).rejects.toThrow('snapshot insert failed');
  expect(flush).not.toHaveBeenCalled();
});

test('reports failed post-refresh invalidation', async () => {
  global.query = jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ alias: 'riyad' }]);
  jest.spyOn(Utils, 'flushBookDiskCache').mockRejectedValue(new Error('cache write failed'));
  await expect(Snapshot.refreshBook(61)).rejects.toThrow('cache write failed');
});
