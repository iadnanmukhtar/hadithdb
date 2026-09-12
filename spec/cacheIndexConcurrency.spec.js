const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const util = require('util');
const Utils = require('../lib/Utils');

const close = db => util.promisify(db.close.bind(db))();

describe('cache index concurrency', () => {
  let directory, connections;
  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hadith-cache-lock-'));
    connections = [];
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await Promise.all(connections.map(close));
    await fs.rm(directory, { recursive: true, force: true });
  });
  async function open() {
    const db = await Utils.openCacheIndex(path.join(directory, 'cache.db'));
    connections.push(db);
    return db;
  }

  test('workers can initialize a new database concurrently', async () => {
    const [first, second] = await Promise.all([open(), open()]);
    await first.runAsync("INSERT INTO cachendx VALUES ('new', 'new.html')");
    expect(await second.allAsync('SELECT id FROM cachendx')).toEqual([{ id: 'new' }]);
  });

  test('readers continue and competing writes wait for a writer to commit', async () => {
    const first = await open();
    const second = await open();
    await first.runAsync('BEGIN IMMEDIATE');
    let locked = true;
    try {
      await first.runAsync("INSERT INTO cachendx VALUES ('first', 'first.html')");
      expect(await second.allAsync('SELECT * FROM cachendx')).toEqual([]);
      const waiting = second.runAsync("INSERT INTO cachendx VALUES ('second', 'second.html')");
      const release = new Promise(resolve => setTimeout(resolve, 1250)).then(async () => {
        await first.runAsync('COMMIT');
        locked = false;
      });
      await Promise.all([waiting, release]);
      expect(await second.allAsync('SELECT id FROM cachendx ORDER BY id')).toEqual([
        { id: 'first' }, { id: 'second' }
      ]);
    } finally {
      if (locked) await first.runAsync('ROLLBACK');
    }
  });

  test('concurrent initializers migrate legacy rows without losing them', async () => {
    const seed = await open();
    await seed.runAsync('DROP TABLE cachendx');
    await seed.runAsync('CREATE TABLE cachendx (id TEXT PRIMARY KEY, filename TEXT NOT NULL)');
    await seed.runAsync("INSERT INTO cachendx VALUES ('quran:7:123', 'mawardi.html')");
    const [first, second] = await Promise.all([open(), open()]);
    await first.runAsync("INSERT INTO cachendx VALUES ('quran:7:123', 'another.html')");
    expect(await second.allAsync('SELECT filename FROM cachendx ORDER BY filename')).toEqual([
      { filename: 'another.html' }, { filename: 'mawardi.html' }
    ]);
  });

  test('requests share initialization and retry after failed initialization', async () => {
    const original = Utils.CACHENDX;
    const pending = Utils.CACHENDX_PENDING;
    Utils.CACHENDX = undefined;
    Utils.CACHENDX_PENDING = undefined;
    try {
      const openIndex = jest.spyOn(Utils, 'openCacheIndex').mockRejectedValueOnce(new Error('locked'));
      const failed = await Promise.allSettled([Utils.setupCacheIndex(), Utils.setupCacheIndex()]);
      expect(failed.map(result => result.status)).toEqual(['rejected', 'rejected']);
      expect(openIndex).toHaveBeenCalledTimes(1);
      expect(Utils.CACHENDX).toBeUndefined();
      const ready = {};
      openIndex.mockResolvedValueOnce(ready);
      expect(await Promise.all([Utils.setupCacheIndex(), Utils.setupCacheIndex()])).toEqual([ready, ready]);
      expect(openIndex).toHaveBeenCalledTimes(2);
    } finally {
      Utils.CACHENDX = original;
      Utils.CACHENDX_PENDING = pending;
    }
  });
});
