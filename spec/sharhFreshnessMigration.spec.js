'use strict';
const { migrate } = require('../lib/SharhFreshness');
function fixture(respond) {
  const connection = {
    query: jest.fn((sql, values, callback) => {
      if (typeof values === 'function') { callback = values; values = []; }
      Promise.resolve().then(() => respond(sql, values)).then(rows => callback(null, rows), error => callback(error));
    }),
    release: jest.fn(), destroy: jest.fn()
  };
  const pool = { getConnection: callback => callback(null, connection) };
  return { pool, connection };
}
const ready = [{ Default: 'CURRENT_TIMESTAMP(3)' }];
test('already migrated startup performs one read and no DDL or locks', async () => {
  const {pool,connection}=fixture(()=>ready);
  await migrate(pool,'hdith_hadith_sharh');
  expect(connection.query).toHaveBeenCalledTimes(1);
  expect(connection.release).toHaveBeenCalledTimes(1);
});
test('worker rechecks schema after waiting for another worker and skips DDL', async()=>{
  let reads=0;
  const {pool,connection}=fixture(sql=>{
    if(sql.startsWith('SHOW COLUMNS'))return ++reads===1 ? [] : ready;
    if(sql.startsWith('SELECT DATABASE'))return [{database:'fixture'}];
    if(sql.startsWith('SELECT GET_LOCK'))return [{acquired:1}];
    return [];
  });
  await migrate(pool,'hdith_hadith_sharh');
  const statements=connection.query.mock.calls.map(call=>call[0]);
  expect(reads).toBe(2);
  expect(statements.some(sql=>sql.startsWith('ALTER'))).toBe(false);
  expect(statements.at(-1)).toBe('SELECT RELEASE_LOCK(?)');
  expect(connection.release).toHaveBeenCalledTimes(1);
});
test('DDL failure restores timeout and releases the session lock before returning connection',async()=>{
  const failure=Object.assign(new Error('Metadata lock timeout'),{code:'ER_LOCK_WAIT_TIMEOUT'});
  const {pool,connection}=fixture(sql=>{
    if(sql.startsWith('SHOW COLUMNS'))return [];
    if(sql.startsWith('SELECT DATABASE'))return [{database:'fixture'}];
    if(sql.startsWith('SELECT GET_LOCK'))return [{acquired:1}];
    if(sql.startsWith('SELECT @@SESSION'))return [{timeout:31536000}];
    if(sql.startsWith('ALTER'))throw failure;
    return [];
  });
  await expect(migrate(pool,'hdith_hadith_sharh')).rejects.toBe(failure);
  expect(connection.query.mock.calls.some(([sql])=>sql.includes('ALGORITHM=INSTANT'))).toBe(true);
  expect(connection.query).toHaveBeenCalledWith('SET SESSION lock_wait_timeout=?',[31536000],expect.any(Function));
  expect(connection.query.mock.calls.at(-1)[0]).toBe('SELECT RELEASE_LOCK(?)');
  expect(connection.release).toHaveBeenCalledTimes(1);
});
test('partial migration changes only the default, without MODIFY or ADD',async()=>{
  const {pool,connection}=fixture(sql=>{
    if(sql.startsWith('SHOW COLUMNS'))return [{Default:null}];
    if(sql.startsWith('SELECT DATABASE'))return [{database:'fixture'}];
    if(sql.startsWith('SELECT GET_LOCK'))return [{acquired:1}];
    if(sql.startsWith('SELECT @@SESSION'))return [{timeout:31536000}];
    return [];
  });
  await migrate(pool,'hdith_hadith_sharh');
  const ddl=connection.query.mock.calls.map(call=>call[0]).filter(sql=>sql.startsWith('ALTER'));
  expect(ddl).toEqual(['ALTER TABLE hdith_hadith_sharh ALTER COLUMN content_updated_at SET DEFAULT (CURRENT_TIMESTAMP(3)), ALGORITHM=INSTANT']);
});
