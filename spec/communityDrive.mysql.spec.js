'use strict';
// All tables are disposable and prefixed; Google requests are mocked.
jest.mock('../lib/NotebookDrive', () => ({ ensureTable: jest.fn(), connectionStatus: jest.fn(async () => ({ connected: true })), shadowClient: jest.fn() }));
const { promisify } = require('util');
const mysql = require('mysql');
const Shadow = require('../lib/CommunityDrive');
const Notebook = require('../lib/NotebookDrive');
const suite = process.env.HADITHDB_MYSQL_INTEGRATION === '1' ? describe : describe.skip;
suite('durable Drive shadow queue', () => {
  const prefix = `shadow_test_${process.pid}_${Date.now()}_`;
  const tables = ['community_drive_settings', 'community_drive_files', 'user_notebook_drive', 'community_posts'];
  const rewrite = s => s.replace(/\b(community_drive_settings|community_drive_files|user_notebook_drive|community_posts)\b/g, name => prefix + name).replace(/community-drive-worker/g, prefix + 'worker');
  let pool, q, previous;
  beforeAll(async () => {
    pool = mysql.createPool({ host: '127.0.0.1', port: Number(process.env.MYSQL_TEST_PORT || 3306), user: process.env.MYSQL_TEST_USER || 'root', password: process.env.MYSQL_TEST_PASSWORD || '', database: process.env.MYSQL_TEST_DATABASE || 'hadithdb_test', connectionLimit: 5 });
    q = (s, v = []) => promisify(pool.query).call(pool, rewrite(s), v);
    previous = global.dbPool;
    global.dbPool = {
      query: (s, v, cb) => pool.query(rewrite(s), v, cb),
      getConnection: cb => pool.getConnection((err, c) => cb(err, c && {
        query: (s, v, callback) => typeof v === 'function' ? c.query(rewrite(s), v) : c.query(rewrite(s), v, callback),
        release: () => c.release(), destroy: () => c.destroy()
      }))
    };
    await q('CREATE TABLE user_notebook_drive (user_uid VARCHAR(128) COLLATE utf8mb4_bin PRIMARY KEY, token_cipher TEXT) DEFAULT CHARSET=utf8mb4');
    await q('CREATE TABLE community_posts (id BIGINT PRIMARY KEY, author_uid VARCHAR(128) COLLATE utf8mb4_bin, title TEXT, markdown TEXT, kind VARCHAR(20),status VARCHAR(20)) DEFAULT CHARSET=utf8mb4');
    await Shadow.ensure();
  });
  afterAll(async () => {
    global.dbPool = previous;
    if (pool) {
      for (const table of tables) await q(`DROP TABLE IF EXISTS ${table}`);
      await promisify(pool.end).call(pool);
    }
  });
  test('opt-in never backfills; writes queue only opted-in authors', async () => {
    await q("INSERT INTO user_notebook_drive VALUES ('owner','encrypted'),('other','encrypted')");
    await q("INSERT INTO community_posts VALUES (1,'owner','Title','Body','article','draft'),(2,'owner','Old','Untouched','article','draft')");
    await Shadow.configure('owner', true);
    expect(await q('SELECT * FROM community_drive_files')).toEqual([]);
    await Shadow.enqueue(q, 'other', 3);
    expect(await q('SELECT * FROM community_drive_files')).toEqual([]);
    await Shadow.enqueue(q, 'owner', 1);
    expect((await q('SELECT post_id FROM community_drive_files')).map(x => x.post_id)).toEqual([1]);
  });
  test('failed upload is retried with the same ID; a newer edit cannot be acknowledged by an older upload', async () => {
    let fail = true, newer = false;
    const files = new Set();
    let next = 0;
    const store = { generateId: async () => 'drive-' + ++next, request: jest.fn(async (path, options = {}) => {
      if (!options.method) {
        const id = path.split('/').pop();
        if (!files.has(id)) throw { status: 404 };
        return { data: { id } };
      }
      if (path === 'drive/v3/files') { files.add(options.data.id); return {}; }
      if (fail) throw { status: 503 };
      if (newer) { await Shadow.enqueue(q, 'owner', 1); newer = false; }
      files.add('drive-2');
      return {};
    }) };
    Notebook.shadowClient.mockResolvedValue(store);
    await Shadow.deliverBatch();
    let row = (await q('SELECT * FROM community_drive_files'))[0];
    expect(row.pending).toBe(1);
    expect(row.file_id).toBe('drive-2');
    fail = false; newer = true;
    await q('UPDATE community_drive_files SET available_at=CURRENT_TIMESTAMP(3)');
    await Shadow.deliverBatch();
    expect((await q('SELECT pending FROM community_drive_files'))[0].pending).toBe(1);
    await Shadow.deliverBatch();
    expect((await q('SELECT pending FROM community_drive_files'))[0].pending).toBe(0);
    expect(next).toBe(2);
  });
  test('disconnect pauses work; delete is retained and delivered after reconnect', async () => {
    await q("UPDATE user_notebook_drive SET token_cipher=NULL WHERE user_uid='owner'");
    await q("UPDATE community_posts SET status='deleted' WHERE id=1");
    await Shadow.enqueue(q, 'owner', 1);
    Notebook.shadowClient.mockClear();
    await Shadow.deliverBatch();
    expect(Notebook.shadowClient).not.toHaveBeenCalled();
    const store = { request: jest.fn().mockResolvedValue({}) };
    Notebook.shadowClient.mockResolvedValue(store);
    await q("UPDATE user_notebook_drive SET token_cipher='encrypted' WHERE user_uid='owner'");
    await Shadow.deliverBatch();
    expect(store.request).toHaveBeenCalledWith('drive/v3/files/drive-2', { method: 'PATCH', data: { trashed: true } });
    expect((await q('SELECT pending FROM community_drive_files'))[0].pending).toBe(0);
  });
});
