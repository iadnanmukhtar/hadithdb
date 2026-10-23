'use strict';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

describe('Quran TOC Juz loading', () => {
  let subdivisions;
  let originalQuery;

  beforeEach(() => {
    jest.resetModules();
    originalQuery = global.query;
    subdivisions = require('../lib/QuranTocSubdivisions');
  });

  afterEach(() => {
    global.query = originalQuery;
  });

  function mockQueries(corpusWords) {
    global.query = jest.fn(async sql => {
      if (sql.includes('SHOW COLUMNS'))
        return [{ Field: 'present' }];
      if (sql.includes('quran_corpus_words'))
        return corpusWords();
      return [{ id: 1, num: 1, title: 'الم', start: '1:1', count: 148 }];
    });
  }

  test('invalidation during title enrichment does not break the active load or cache stale rows', async () => {
    const words = deferred();
    const started = deferred();
    mockQueries(() => { started.resolve(); return words.promise; });
    const loading = subdivisions.juzRows();
    await started.promise;
    subdivisions.invalidateAll();
    words.resolve([{ surah: 2, ayah: 1, word: 1, text: 'الٓمٓ' }]);

    await expect(loading).resolves.toEqual([expect.objectContaining({ title: 'الٓمٓ' })]);
    const callsBeforeReload = global.query.mock.calls.length;
    await subdivisions.juzRows();
    expect(global.query.mock.calls.length).toBeGreaterThan(callsBeforeReload);
  });

  test('concurrent readers wait for enriched titles and reuse the completed cache', async () => {
    const words = deferred();
    const started = deferred();
    mockQueries(() => { started.resolve(); return words.promise; });
    const first = subdivisions.juzRows();
    await started.promise;
    const second = subdivisions.juzRows();
    let secondFinished = false;
    second.then(() => { secondFinished = true; });
    await Promise.resolve();
    expect(secondFinished).toBe(false);
    words.resolve([{ surah: 2, ayah: 1, word: 1, text: 'الٓمٓ' }]);
    const rows = await first;
    expect(await second).toBe(rows);
    const callCount = global.query.mock.calls.length;
    expect(await subdivisions.juzRows()).toBe(rows);
    expect(global.query).toHaveBeenCalledTimes(callCount);
  });

  test('an older load cannot replace the cache populated after invalidation', async () => {
    const oldWords = deferred();
    const started = deferred();
    let corpusCalls = 0;
    mockQueries(() => {
      if (++corpusCalls === 1) {
        started.resolve();
        return oldWords.promise;
      }
      return [];
    });
    const oldLoad = subdivisions.juzRows();
    await started.promise;
    subdivisions.invalidateAll();
    const freshRows = await subdivisions.juzRows();
    oldWords.resolve([{ surah: 2, ayah: 1, word: 1, text: 'الٓمٓ' }]);
    const oldRows = await oldLoad;
    expect(oldRows).not.toBe(freshRows);
    expect(await subdivisions.juzRows()).toBe(freshRows);
  });

  test('a failed query can be retried', async () => {
    mockQueries(() => []);
    global.query.mockRejectedValueOnce(new Error('query failed'));
    await expect(subdivisions.juzRows()).rejects.toThrow('query failed');
    await expect(subdivisions.juzRows()).resolves.toHaveLength(1);
  });
});
