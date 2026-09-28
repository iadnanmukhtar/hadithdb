'use strict';
const Pairs = require('../lib/HadithBilingualPairs');
const Refresh = require('../lib/HadithPairRefresh');
const updateRouter = require('../routes/update');
const oldName = 'ابن عباس', targetName = 'عبد الله بن عباس';
const keys = [Pairs.normalize(oldName), Pairs.normalize(targetName)];
let connection, statements, failWrite, managedRows;

beforeEach(() => {
  Pairs.resetSchemaForTests();
  statements = []; failWrite = false; managedRows = [];
  global.query = jest.fn(async () => []);
  connection = {
    beginTransaction: jest.fn(cb => cb()), commit: jest.fn(cb => cb()), rollback: jest.fn(cb => cb()), release: jest.fn(),
    query: jest.fn((sql, values, cb) => {
      if (typeof values === 'function') { cb = values; values = undefined; }
      statements.push([sql, values]);
      if (failWrite && sql.startsWith('UPDATE')) return cb(new Error('write failed'));
      if (sql.includes('FROM hdith_bilingual_pairs')) return cb(null, managedRows);
      if (sql.includes('SELECT m.hadith_id,m.chain_type')) return cb(null, [
        { hadith_id: 7, chain_type: `${oldName}، ${targetName} · مستقل`, alias: 'shuab' },
        { hadith_id: 8, chain_type: 'مستقل', alias: 'shuab' }
      ]);
      if (sql.includes('SELECT chain_type')) return cb(null, [{ chain_type: `${oldName} · ${targetName}`, usage_count: 2 }]);
      if (sql.includes('SELECT DISTINCT')) return cb(null, [{ hadith_id: 7, alias: 'shuab' }]);
      if (sql.startsWith('SELECT')) return cb(null, [
        { value_ar: oldName, value_en: 'Ibn Abbas' },
        { value_ar: targetName, value_en: 'Abdullah b. Abbas' },
        { value_ar: 'ابْن عَبَّاس', value_en: 'Ibn ʿAbbās' },
        { value_ar: 'مستقل', value_en: 'Unrelated' }
      ]);
      cb(null, { affectedRows: 1 });
    })
  };
  global.dbPool = { getConnection: cb => cb(null, connection) };
});
afterEach(() => { jest.restoreAllMocks(); delete global.query; delete global.dbPool; });

test.each(Pairs.TYPES)('merges %s references transactionally and retains resolving aliases', async type => {
  const result = await Pairs.merge(type, keys, keys[1], targetName, 'Abdullah b. Abbas');
  expect(result).toMatchObject({ merged_count: 2, affected_hadith_ids: [7], affected_book_aliases: ['shuab'] });
  expect(connection.beginTransaction).toHaveBeenCalledTimes(1);
  expect(connection.commit).toHaveBeenCalledTimes(1);
  expect(connection.rollback).not.toHaveBeenCalled();
  expect(connection.release).toHaveBeenCalled();
  const aliases = statements.filter(([sql]) => sql.startsWith('INSERT INTO hdith_bilingual_pairs')).map(([, values]) => values);
  expect(aliases).toEqual(expect.arrayContaining(keys.map(key => [type, key, targetName, 'Abdullah b. Abbas'])));
  expect(statements.some(([sql]) => sql.includes("WHERE narrator='مستقل'"))).toBe(false);
});

test('replaces normalized narrator variants without changing quoted hadith bodies', async () => {
  await Pairs.merge('narrator', keys, keys[1], targetName, 'Abdullah b. Abbas');
  const writes = statements.filter(([sql]) => sql.startsWith('UPDATE')).map(([sql]) => sql).join('\n');
  expect(writes).toContain("WHERE narrator='ابْن عَبَّاس'");
  expect(writes).toContain('UPDATE hdith_narrators');
  expect(writes).not.toMatch(/SET (?:body|chain)=/);
});

test('merges classification tokens and removes duplicates while retaining unrelated tokens', async () => {
  await Pairs.merge('chain_classification', keys, keys[1], targetName, 'Abdullah b. Abbas');
  const writes = statements.filter(([sql]) => sql.startsWith('UPDATE hdith_hadith_metadata SET chain_type'));
  expect(writes).toEqual([['UPDATE hdith_hadith_metadata SET chain_type=? WHERE hadith_id=?', [`${targetName} · مستقل`, 7]]]);
});

test('rolls back the entire merge on propagation failure', async () => {
  failWrite = true;
  await expect(Pairs.merge('narrator', keys, keys[1], targetName, 'Abdullah')).rejects.toThrow('write failed');
  expect(connection.commit).not.toHaveBeenCalled();
  expect(connection.rollback).toHaveBeenCalledTimes(1);
  expect(connection.release).toHaveBeenCalled();
});

test.each([
  [keys.slice(0, 1), keys[0], targetName, 'Abdullah'],
  [keys, 'unknown', targetName, 'Abdullah'],
  [keys, keys[1], '', 'Abdullah'],
  [keys, keys[1], targetName, '']
])('rejects invalid selections before acquiring a transaction', async (selection, target, ar, en) => {
  await expect(Pairs.merge('narrator', selection, target, ar, en)).rejects.toMatchObject({ status: 400 });
  expect(connection.beginTransaction).not.toHaveBeenCalled();
});

test('rejects stale selections and collisions with unselected pairs', async () => {
  await expect(Pairs.merge('narrator', [...keys, 'gone'], keys[1], targetName, 'Abdullah')).rejects.toMatchObject({ status: 409 });
  await expect(Pairs.merge('narrator', keys, keys[1], 'مستقل', 'Unrelated')).rejects.toMatchObject({ status: 409 });
  expect(connection.commit).not.toHaveBeenCalled();
});

test('waits for refresh and reports a committed merge distinctly if refresh fails', async () => {
  const handler = updateRouter.stack.find(layer => layer.route?.path === '/:id/:prop').route.stack.at(-1).handle;
  jest.spyOn(Pairs, 'merge').mockResolvedValue({ type: 'narrator', merged_count: 2, affected_hadith_ids: [7], affected_book_aliases: ['shuab'] });
  jest.spyOn(Refresh, 'refresh').mockRejectedValue(new Error('search offline'));
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  await handler({ params: { id: '0', prop: 'hdith_pair.merge' }, user: { uid: 'admin' }, body: { pairType: 'narrator', valueAr: targetName, valueEn: 'Abdullah', mergeKeys: keys, targetKey: keys[1] } }, res, jest.fn());
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 200, warning: true, message: expect.stringContaining('Do not repeat the merge') }));
});

test('propagates old imported spellings behind previously renamed managed aliases', async () => {
  managedRows = [{ pair_key: keys[0], value_ar: 'عبدالله بن عباس', value_en: 'Abdullah', hidden: 0 }];
  await Pairs.merge('narrator', keys, keys[1], targetName, 'Abdullah b. Abbas');
  const writes = statements.filter(([sql]) => sql.startsWith('UPDATE')).map(([sql]) => sql).join('\n');
  expect(writes).toContain("WHERE narrator='ابن عباس'");
  expect(writes).toContain("WHERE narrator='عبدالله بن عباس'");
});
