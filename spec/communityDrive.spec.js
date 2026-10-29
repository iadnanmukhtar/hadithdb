'use strict';
jest.mock('../lib/NotebookDrive', () => ({ ensureTable: jest.fn() }));
const Drive = require('../lib/CommunityDrive');
const yaml = require('front-matter');
const post = { id: 7, guid: 'stable-id', kind: 'article', title: 'العربية: title', markdown: '# Original\n\nExact body', status: 'draft', tags: '["one"]' };
test('portable Markdown preserves the complete draft and metadata', () => {
  const parsed = yaml(Drive.encode(post));
  expect(parsed.attributes.title).toBe(post.title);
  expect(parsed.attributes.status).toBe('draft');
  expect(parsed.body.trim()).toBe(post.markdown);
});
test('new copy reserves a durable ID before upload and never uses notebook metadata', async () => {
  const order = [];
  const store = { generateId: async () => 'file-7', request: jest.fn(async (path, options) => {
    if (path === 'drive/v3/files/file-7') throw { status: 404 };
    order.push('upload');
    expect(options.method).toBe('POST');
    expect(options.data).toContain('"id":"file-7"');
    expect(options.data).toContain('hadithunlocked-community');
    expect(options.data).not.toContain('source_hash');
    expect(options.data).toContain(post.markdown);
  }) };
  await Drive.sync(store, {}, post, async id => { expect(id).toBe('file-7'); order.push('reserve'); });
  expect(order).toEqual(['reserve', 'upload']);
});
test('retry updates the reserved file rather than making duplicates', async () => {
  const store = { request: jest.fn().mockResolvedValue({ data: { id: 'file-7' } }) };
  const reserve = jest.fn();
  await Drive.sync(store, { file_id: 'file-7' }, post, reserve);
  expect(reserve).not.toHaveBeenCalled();
  expect(store.request.mock.calls[1][0]).toBe('upload/drive/v3/files/file-7');
  expect(store.request.mock.calls[1][1].method).toBe('PATCH');
});
test('deletion trashes only the mapped copy and missing copies succeed', async () => {
  const store = { request: jest.fn().mockRejectedValue({ status: 404 }) };
  await Drive.sync(store, { file_id: 'file-7' }, { status: 'deleted' });
  expect(store.request).toHaveBeenCalledWith('drive/v3/files/file-7', { method: 'PATCH', data: { trashed: true } });
  store.request.mockClear();
  await Drive.sync(store, {}, { status: 'deleted' });
  expect(store.request).not.toHaveBeenCalled();
});
test('Drive failures propagate for durable retry', async () => {
  const store = { request: jest.fn().mockRejectedValue({ status: 503 }) };
  await expect(Drive.sync(store, { file_id: 'file-7' }, post)).rejects.toEqual({ status: 503 });
});
test('queue admission is scoped to opt-in owners; existing copies remain pending offline', async () => {
  const q = jest.fn().mockResolvedValue([]);
  await Drive.enqueue(q, 'owner', 7);
  expect(q.mock.calls[0][0]).toContain('s.user_uid=? AND s.enabled=1');
  expect(q.mock.calls[0][1]).toEqual([7, 'owner']);
  expect(q.mock.calls[1][1]).toEqual([7, 'owner']);
});
test('worker acknowledges only its captured generation and leaves failures pending', async () => {
  const notebook = require('../lib/NotebookDrive');
  let failure = false;
  const queries = [];
  const store = { request: jest.fn(async () => { if (failure) throw { status: 503 }; return {}; }) };
  notebook.shadowClient = jest.fn(async () => store);
  const connection = {
    query: (s, cb) => cb(null, [{ acquired: 1 }]), release: jest.fn(), destroy: jest.fn()
  };
  const oldPool = global.dbPool;
  global.dbPool = {
    getConnection: cb => cb(null, connection),
    query: (s, v, cb) => {
      queries.push([s, v]);
      if (s.startsWith('SELECT f.*')) return cb(null, [{ post_id: 7, user_uid: 'owner', file_id: 'file-7', generation: 3 }]);
      if (s.startsWith('SELECT * FROM community_posts')) return cb(null, [{ ...post, status: 'deleted' }]);
      cb(null, []);
    }
  };
  try {
    await Drive.deliverBatch();
    expect(queries.find(([s]) => s.includes('SET pending=0'))).toEqual([expect.stringContaining('AND generation=?'), [7, 3]]);
    queries.length = 0; failure = true;
    await Drive.deliverBatch();
    expect(queries.some(([s]) => s.includes('SET pending=0'))).toBe(false);
    expect(queries.find(([s]) => s.includes('INTERVAL 1 MINUTE'))).toEqual([expect.stringContaining('AND generation=?'), [7, 3]]);
    expect(connection.release).toHaveBeenCalledTimes(2);
  } finally { global.dbPool = oldPool; }
});
