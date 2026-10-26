'use strict';
jest.mock('../lib/BlogPageCache', () => ({ invalidate: jest.fn().mockResolvedValue() }));
jest.mock('../lib/CommunitySubtitle', () => ({ migrate: jest.fn().mockResolvedValue() }));
jest.mock('../lib/CommunityCover', () => ({ migrate: jest.fn().mockResolvedValue(), validate: jest.fn().mockResolvedValue(''), url: value => value || '' }));
jest.mock('../lib/UserAvatar', () => ({ decorateAuthors: jest.fn().mockResolvedValue() }));
jest.mock('../lib/CommunityMedia', () => ({ ...jest.requireActual('../lib/CommunityMedia'), prepare: jest.fn().mockResolvedValue() }));
jest.mock('../lib/CommunityBlogImport', () => ({ decorate: jest.fn().mockResolvedValue() }));
jest.mock('../lib/CommunityAlerts', () => ({ migrate: jest.fn().mockResolvedValue() }));
const Community = require('../lib/Community');
const Cache = require('../lib/BlogPageCache');
let events, conn;
beforeEach(() => {
  events = []; Cache.invalidate.mockClear();
  Cache.invalidate.mockImplementation(async () => { events.push('invalidate'); });
  conn = {
    query: jest.fn((sql, args, callback) => {
      if (typeof args === 'function') callback = args;
      callback(null, sql.startsWith('SELECT') ? [{ kind: 'article', status: 'published' }] : {});
    }),
    beginTransaction: jest.fn(cb => cb()), commit: jest.fn(cb => { events.push('commit'); cb(); }),
    rollback: jest.fn(cb => { events.push('rollback'); cb(); }), release: jest.fn()
  };
  global.dbPool = { query: (_sql, _args, cb) => (typeof _args === 'function' ? _args : cb)(null, []), getConnection: cb => cb(null, conn) };
});
afterEach(() => { delete global.dbPool; });
test('featuring or removing an article invalidates blog pages only after commit', async () => {
  await Community.markBlog({ uid: 'admin', admin: true }, 1, true);
  expect(events).toEqual(['commit', 'invalidate']);
  events.length = 0;
  await Community.markBlog({ uid: 'admin', admin: true }, 1, false);
  expect(events).toEqual(['commit', 'invalidate']);
});
test('failed mutations roll back without invalidating blog pages', async () => {
  conn.query.mockImplementation((_sql, _args, cb) => cb(new Error('write failed')));
  await expect(Community.markBlog({ uid: 'admin', admin: true }, 1, true)).rejects.toThrow('write failed');
  expect(events).toEqual(['rollback']);
  expect(Cache.invalidate).not.toHaveBeenCalled();
});

test.each([null, 1])('publishing a new article or updating an existing one invalidates after commit: %s', async postId => {
  const row = { id: 1, kind: 'article', author_uid: 'admin', status: 'published', version: 1, title: 'Old', markdown: 'Old', public_title: 'Old', public_markdown: 'Old', handle: 'author', name: 'Author' };
  global.dbPool.query = (sql, args, cb) => {
    if (typeof args === 'function') cb = args;
    cb(null, sql.includes('SELECT * FROM community_authors') ? [{ uid: 'admin', handle: 'author', name: 'Author', trusted: 1 }] : sql.startsWith('SELECT p.*') ? [row] : []);
  };
  conn.query.mockImplementation((sql, args, cb) => {
    if (typeof args === 'function') cb = args;
    cb(null, sql.startsWith('SELECT * FROM community_posts') ? [row] : sql.startsWith('INSERT INTO community_posts') ? { insertId: 1 } : []);
  });
  await Community.savePost({ uid: 'admin', admin: true, name: 'Author' }, { kind: 'article', title: 'New', markdown: 'New content', action: 'publish', version: 1 }, postId);
  expect(events).toEqual(['commit', 'invalidate']);
});
