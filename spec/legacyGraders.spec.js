'use strict';
const Graders = require('../lib/LegacyGraders');
const Refresh = require('../lib/HadithPairRefresh');
const router = require('../routes/update');
const UserSettings = require('../lib/UserSettings');
const GoogleAuth = require('../lib/GoogleAuth');
let connection, missing, duplicate, failWrite, calls;
const grader = { shortName: 'ابن حجر', shortName_en: 'Ibn Hajar', name: 'أحمد بن علي', name_en: 'Ahmad b. Ali' };
beforeEach(() => {
  missing = duplicate = failWrite = false; calls = [];
  connection = {
    beginTransaction: jest.fn(cb => cb()), commit: jest.fn(cb => cb()), rollback: jest.fn(cb => cb()), release: jest.fn(),
    query: jest.fn((sql, values, cb) => {
      calls.push([sql, values]);
      if (sql.startsWith('SELECT id,shortName,shortName_en FROM graders WHERE id=')) return cb(null, missing ? [] : [{ id: 7, ...grader }]);
      if (sql.startsWith('SELECT id FROM graders WHERE (')) return cb(null, duplicate ? [{ id: 8 }] : []);
      if (sql.includes('FROM hadiths h')) return cb(null, [{ hadith_id: 123, alias: 'bukhari' }]);
      if (failWrite) return cb(new Error('Database write failed'));
      cb(null, { insertId: 28, affectedRows: 1 });
    })
  };
  global.dbPool = { getConnection: cb => cb(null, connection) };
});
afterEach(() => { jest.restoreAllMocks(); delete global.dbPool; delete global.query; });

test('creates a real legacy grader with an automatically assigned ID and all four names', async () => {
  const result = await Graders.save('new', grader);
  expect(result).toMatchObject({ id: 28, ...grader, affected_hadith_ids: [] });
  expect(calls).toContainEqual(['INSERT INTO graders (shortName,shortName_en,name,name_en) VALUES (?,?,?,?)', Object.values(grader)]);
  expect(connection.commit).toHaveBeenCalled();
});
test('edits the existing ID and finds hadiths requiring cache and index refresh', async () => {
  const result = await Graders.save('7', grader);
  expect(result).toMatchObject({ id: 7, affected_hadith_ids: [123], affected_book_aliases: ['bukhari'] });
  expect(calls).toContainEqual(['UPDATE graders SET shortName=?,shortName_en=?,name=?,name_en=? WHERE id=?', [...Object.values(grader), 7]]);
  expect(calls.some(([sql]) => /UPDATE hadiths|INSERT INTO graders/.test(sql))).toBe(false);
});
test('allows optional full names to be cleared', async () => {
  await Graders.save('7', { ...grader, name: '', name_en: '' });
  expect(calls.at(-1)[1]).toEqual([grader.shortName, grader.shortName_en, null, null, 7]);
});
test.each([
  ['-1', grader], ['nope', grader], ['new', { ...grader, shortName: '' }],
  ['new', { ...grader, shortName_en: 'x'.repeat(46) }], ['new', { ...grader, name: 'ع'.repeat(128) }]
])('rejects invalid IDs and names before writing (%s)', async (id, values) => {
  await expect(Graders.save(id, values)).rejects.toMatchObject({ status: 400 });
  expect(connection.beginTransaction).not.toHaveBeenCalled();
});
test('rejects an absent ID rather than silently inserting a replacement', async () => {
  missing = true;
  await expect(Graders.save('7', grader)).rejects.toMatchObject({ status: 404 });
  expect(connection.rollback).toHaveBeenCalled();
});
test('rejects duplicate short names and rolls back failed writes', async () => {
  duplicate = true;
  await expect(Graders.save('new', grader)).rejects.toMatchObject({ status: 409 });
  duplicate = false; failWrite = true;
  await expect(Graders.save('new', grader)).rejects.toThrow('Database write failed');
  expect(connection.commit).not.toHaveBeenCalled();
  expect(connection.rollback).toHaveBeenCalledTimes(2);
  expect(connection.release).toHaveBeenCalledTimes(2);
});
test('the list uses real graders and usage counts, excluding the no-grader sentinel', async () => {
  global.query = jest.fn(async () => [{ id: 7, ...grader, usage_count: 1 }]);
  expect(await Graders.list()).toEqual([{ id: 7, ...grader, usage_count: 1 }]);
  expect(global.query).toHaveBeenCalledWith(expect.stringContaining('FROM graders g WHERE g.id>=0'));
});
test('saving waits for reader/index refresh before returning success', async () => {
  const layer = router.stack.find(layer => layer.route?.path === '/:id/:prop').route;
  jest.spyOn(Graders, 'save').mockResolvedValue({ id: 7, ...grader, affected_hadith_ids: [123] });
  jest.spyOn(Refresh, 'refresh').mockResolvedValue();
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  await layer.stack.at(-1).handle({ user: { uid: 'admin' }, params: { id: '7', prop: 'legacy_grader.save' }, body: { grader, value: '' } }, res, jest.fn());
  expect(Graders.save).toHaveBeenCalledWith('7', grader);
  expect(Refresh.refresh).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }));
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 200, message: 'Legacy grader saved' }));
});
test('legacy grader writes recheck current administrator membership', async () => {
  const authorize = router.stack.find(layer => layer.route?.path === '/:id/:prop').route.stack[0].handle;
  jest.spyOn(GoogleAuth, 'verifyRequest').mockResolvedValue({ uid: 'revoked', admin: true });
  jest.spyOn(UserSettings, 'isAdminUser').mockResolvedValue(false);
  const next = jest.fn();
  await authorize({ params: { prop: 'legacy_grader.save' } }, {}, next);
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 403 }));
});

test('existing merged labels do not prevent full-name edits', async () => {
  duplicate = true;
  await expect(Graders.save('7', { ...grader, name_en: 'Updated full name' })).resolves.toMatchObject({ id: 7 });
  expect(calls.some(([sql]) => sql.startsWith('SELECT id FROM graders WHERE ('))).toBe(false);
});
