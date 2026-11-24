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


test('refreshes all virtual books containing an edited physical hadith before resolving', async () => {
  global.query = jest.fn(async sql => {
    if (sql.includes('FROM hadiths_virtual')) return [{ bookId: 61 }, { bookId: 62 }];
    if (sql.includes('SELECT alias')) return [{ alias: sql.includes('61') ? 'riyad' : 'mishkat' }];
    return [];
  });
  const flush = jest.spyOn(Utils, 'flushBookDiskCache').mockResolvedValue({});
  await Snapshot.refreshHadith(123);
  expect(global.query).toHaveBeenCalledWith('SELECT DISTINCT bookId FROM hadiths_virtual WHERE hadithId IN (123)');
  expect(global.query).toHaveBeenCalledWith('CALL refresh_v_hadiths_virtual_snapshot(61)');
  expect(global.query).toHaveBeenCalledWith('CALL refresh_v_hadiths_virtual_snapshot(62)');
  expect(flush).toHaveBeenCalledTimes(2);
});

test('retries the contended queued book and finishes the rest of the batch', async () => {
  const contention = Object.assign(new Error('lock busy'), {
    code: 'ER_SIGNAL_EXCEPTION',
    sqlMessage: 'Unable to acquire v_hadiths_virtual_snapshot refresh lock'
  });
  const calls = [];
  global.query = jest.fn(async sql => {
    if (sql.startsWith('CALL')) {
      calls.push(sql);
      if (calls.length === 2) throw contention;
    }
    return [{ alias: 'book' }];
  });
  jest.spyOn(Utils, 'flushBookDiskCache').mockResolvedValue({});
  jest.useFakeTimers();
  try {
    [61, 62, 63].forEach(Snapshot.queueBook);
    await jest.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(2);
    await jest.advanceTimersByTimeAsync(5000);
    expect(calls).toEqual([61, 62, 62, 63].map(id => `CALL refresh_v_hadiths_virtual_snapshot(${id})`));
  } finally {
    jest.useRealTimers();
  }
});
