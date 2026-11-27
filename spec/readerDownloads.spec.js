'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ReaderDownloads } = require('../lib/ReaderDownloads');

describe('shared reader downloads', () => {
  let dir, workers, catalog, loadCatalog;
  function worker() {
    const cache = new ReaderDownloads(path.join(dir, 'cache.sqlite'), loadCatalog);
    workers.push(cache);
    return cache;
  }
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'reader-downloads-'));
    workers = [];
    catalog = { edition: 1, translation: 5 };
    loadCatalog = jest.fn(async () => ({ ...catalog }));
  });
  afterEach(async () => {
    await Promise.all(workers.map(async cache => (await cache.connection()).close()));
    await fs.rm(dir, { recursive: true, force: true });
  });

  test('concurrent workers build once, reuse on restart and delete only the superseded edition', async () => {
    const a = worker(), b = worker();
    const build = jest.fn(async () => ({ revision: catalog.edition }));
    const read = cache => cache.json('edition', 'text/1', build);
    const responses = await Promise.all(Array.from({ length: 30 }, (_, n) => read(n % 2 ? a : b)));
    expect(new Set(responses)).toEqual(new Set(['{"revision":1}']));
    expect(await read(worker())).toBe(responses[0]);
    expect(build).toHaveBeenCalledTimes(1);
    expect(loadCatalog).toHaveBeenCalledTimes(1);
    await a.json('translation', '1', () => 'translated');
    catalog.edition++;
    await b.catalogChanged();
    const rows = await (await a.connection()).get("SELECT COUNT(*) AS n FROM downloads WHERE book='edition'");
    expect(rows.n).toBe(0);
    expect(await read(a)).toBe('{"revision":2}');
    expect(build).toHaveBeenCalledTimes(2);
    expect(await b.json('translation', '1', () => { throw Error('unexpected rebuild'); })).toBe('"translated"');
  });

  test('a late builder cannot publish an old edition and a failed build can be retried', async () => {
    const a = worker(), b = worker();
    let started, resume;
    const ready = new Promise(resolve => { started = resolve; });
    const gate = new Promise(resolve => { resume = resolve; });
    const first = a.json('edition', '1', async () => { const revision = catalog.edition; started(); await gate; return revision; });
    await ready;
    catalog.edition++;
    await b.catalogChanged();
    expect(await b.json('edition', '1', () => 2)).toBe('2');
    resume();
    expect(await first).toBe('2');
    await expect(a.json('edition', '2', () => { throw Error('build failed'); })).rejects.toThrow('build failed');
    expect(await b.json('edition', '2', () => 2)).toBe('2');
  });
});
