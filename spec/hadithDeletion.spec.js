'use strict';
const HadithDeletion = require('../lib/HadithDeletion');
const GoogleAuth = require('../lib/GoogleAuth');
const UserSettings = require('../lib/UserSettings');
const router = require('../routes/update');
let connection;
const originalPool = global.dbPool;
beforeEach(() => {
  connection = {
    beginTransaction: jest.fn(cb => cb(null)), commit: jest.fn(cb => cb(null)),
    rollback: jest.fn(cb => cb(null)), release: jest.fn(),
    query: jest.fn((sql, args, cb) => cb(null, sql.startsWith('SELECT h.')
      ? [{ id: 91, bookId: 5, alias: 'adab', type: 'hadith', virtual: 0 }] : []))
  };
  global.dbPool = { getConnection: jest.fn(cb => cb(null, connection)) };
});
afterEach(() => { global.dbPool = originalPool; jest.restoreAllMocks(); });
test.each(['91,92', '91 OR 1=1', 0, -1, '1.5'])('rejects invalid ID %s before opening a connection', async id => {
  await expect(HadithDeletion.remove(id)).rejects.toThrow('Invalid hadith ID');
  expect(global.dbPool.getConnection).not.toHaveBeenCalled();
});
test('deletes one record and incoming similarities in a single transaction', async () => {
  await expect(HadithDeletion.remove('91')).resolves.toMatchObject({ id: 91 });
  expect(connection.query.mock.calls.filter(([sql]) => sql.startsWith('DELETE')).map(([sql, args]) => [sql, args])).toEqual([
    ['DELETE FROM hadiths_sim WHERE hadithId2=?', [91]],
    ['DELETE FROM hadiths_sim_candidates WHERE hadithId2=?', [91]],
    ['DELETE FROM hadiths WHERE id=?', [91]]
  ]);
  expect(connection.commit).toHaveBeenCalledTimes(1);
  expect(connection.release).toHaveBeenCalledTimes(1);
});
test.each([
  [[], 'not found'],
  [[{ id: 91, bookId: 0, alias: 'quran' }], 'Only original'],
  [[{ id: 91, bookId: 7, alias: 'tafsir', type: 'tafsir' }], 'Only original']
])('rejects missing or non-hadith targets', async (rows, message) => {
  connection.query.mockImplementationOnce((sql, args, cb) => cb(null, rows));
  await expect(HadithDeletion.remove(91)).rejects.toThrow(message);
  expect(connection.commit).not.toHaveBeenCalled();
  expect(connection.rollback).toHaveBeenCalled();
  expect(connection.release).toHaveBeenCalled();
});
test('preserves records still referenced by virtual books', async () => {
  connection.query.mockImplementation((sql, args, cb) => cb(null, sql.startsWith('SELECT h.')
    ? [{ id: 91, bookId: 5, alias: 'adab' }] : [{ id: 42 }]));
  await expect(HadithDeletion.remove(91)).rejects.toThrow('virtual-book entries');
  expect(connection.query.mock.calls.some(([sql]) => sql.startsWith('DELETE'))).toBe(false);
});
test('rolls back all SQL changes if deletion fails', async () => {
  const normal = connection.query.getMockImplementation();
  connection.query.mockImplementation((sql, args, cb) => sql.startsWith('DELETE FROM hadiths WHERE')
    ? cb(new Error('database failure')) : normal(sql, args, cb));
  await expect(HadithDeletion.remove(91)).rejects.toThrow('database failure');
  expect(connection.rollback).toHaveBeenCalled();
  expect(connection.commit).not.toHaveBeenCalled();
  expect(connection.release).toHaveBeenCalled();
});
test.each([[null, 401], [{ uid: 'reader', admin: false }, 403]])('requires administrator authentication', async (user, status) => {
  jest.spyOn(GoogleAuth, 'verifyRequest').mockResolvedValue(user);
  jest.spyOn(UserSettings, 'isAdminUser').mockResolvedValue(false);
  const guard = router.stack.find(layer => layer.route?.path === '/:id/:prop').route.stack[0].handle;
  const next = jest.fn();
  await guard({}, {}, next);
  expect(next.mock.calls[0][0].status).toBe(status);
  expect(global.dbPool.getConnection).not.toHaveBeenCalled();
});
test('delete endpoint removes search documents, clears caches, and redirects to the book', async () => {
  const Index = require('../lib/Index');
  const Utils = require('../lib/Utils');
  const Books = require('../lib/Books');
  const { Library } = require('../lib/Model');
  const SharhIndex = require('../lib/HadithSharhIndex');
  jest.spyOn(HadithDeletion, 'remove').mockResolvedValue({ id: 91, bookId: 5, alias: 'adab', num: '24' });
  jest.spyOn(Index, 'delete').mockResolvedValue();
  jest.spyOn(Index, 'refresh').mockResolvedValue();
  jest.spyOn(SharhIndex, 'syncHadiths').mockResolvedValue();
  jest.spyOn(Utils, 'flushCacheContaining').mockResolvedValue();
  jest.spyOn(Utils, 'flushCachedFile').mockResolvedValue();
  jest.spyOn(Books, 'touchBookContentLastmodById').mockResolvedValue();
  jest.spyOn(Library, 'reloadBooks').mockResolvedValue();
  jest.spyOn(Library, 'instance', 'get').mockReturnValue({ findBook: () => ({}) });
  const oldQuery = global.query;
  global.query = jest.fn().mockResolvedValue([]);
  const handler = router.stack.find(layer => layer.route?.path === '/:id/:prop').route.stack.at(-1).handle;
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  try {
    await handler({ params: { id: '91', prop: 'hadith.delete' }, body: {}, user: { uid: 'admin' } }, res, jest.fn());
    expect(Index.delete).toHaveBeenCalledWith('hadiths', 91);
    expect(SharhIndex.syncHadiths).toHaveBeenCalledWith([{ hId: 91, book_alias: 'adab' }]);
    expect(Utils.flushCacheContaining).toHaveBeenCalledWith('adab:24');
    expect(Utils.flushCacheContaining).toHaveBeenCalledWith('book:adab');
    expect(res.json).toHaveBeenCalledWith({ code: 200, message: 'Hadith deleted', redirect: '/adab' });
  } finally { global.query = oldQuery; }
});
