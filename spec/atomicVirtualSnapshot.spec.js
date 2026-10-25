'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { install } = require('../bin/utils/install-atomic-virtual-snapshot');

describe('atomic snapshot procedure installation', () => {
  let backupDir;
  const previous = 'CREATE PROCEDURE refresh_v_hadiths_virtual_snapshot() BEGIN SELECT 1; END';
  beforeEach(() => { backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-snapshot-')); });
  afterEach(() => { fs.rmSync(backupDir, { recursive: true, force: true }); });
  function database(options = {}) {
    return jest.fn(async sql => {
      if (sql.startsWith('SELECT ENGINE')) return [{ ENGINE: options.engine || 'InnoDB' }];
      if (sql.startsWith('SHOW CREATE')) return [{ 'Create Procedure': options.previous || previous }];
      if (sql.startsWith('SELECT GET_LOCK')) return [{ acquired: options.busy ? 0 : 1 }];
      if (sql.includes('DECLARE v_transaction_started') && options.fail) throw Error('create failed');
      return [];
    });
  }
  it('leaves the database unchanged in dry run', async () => {
    const query = database();
    expect(await install(query)).toMatchObject({ pending: true, changed: false });
    expect(query.mock.calls).toHaveLength(2);
  });
  it('backs up the previous routine before replacing it and releases the lock', async () => {
    const query = database();
    const result = await install(query, { apply: true, backupDir });
    expect(JSON.parse(fs.readFileSync(result.backup))['Create Procedure']).toBe(previous);
    expect(query.mock.calls.at(-1)[0]).toBe('DO RELEASE_LOCK(?)');
  });
  it('restores the original routine if creation fails', async () => {
    const query = database({ fail: true });
    await expect(install(query, { apply: true, backupDir })).rejects.toThrow('create failed');
    expect(query).toHaveBeenCalledWith(previous);
    expect(query.mock.calls.at(-1)[0]).toBe('DO RELEASE_LOCK(?)');
  });
  it('does not replace a busy snapshot procedure', async () => {
    const query = database({ busy: true });
    await expect(install(query, { apply: true, backupDir })).rejects.toThrow('busy');
    expect(query.mock.calls.some(([sql]) => sql.startsWith('DROP'))).toBe(false);
  });
  it('refuses a table that cannot roll back', async () => {
    await expect(install(database({ engine: 'MyISAM' }), { apply: true })).rejects.toThrow('InnoDB');
  });
  it('does not replace an already installed routine', async () => {
    const query = database({ previous: 'DECLARE v_transaction_started' });
    expect(await install(query, { apply: true })).toEqual({ atomic: true, changed: false });
    expect(query.mock.calls).toHaveLength(2);
  });
});
