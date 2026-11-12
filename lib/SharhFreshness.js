'use strict';
const { promisify } = require('util');
const { createHash } = require('crypto');
const hasDefault = column => /^current_timestamp\(3\)$/i.test(String(column?.Default || ''));

// DDL and advisory locks are connection-scoped. Never run this through a pool's
// query helper: another PM2 worker must recheck the schema after taking the lock.
async function migrate(pool, table) {
  if (!/^[a-zA-Z0-9_]+$/.test(table)) throw new Error('Invalid Sharh migration table');
  const connection = await promisify(pool.getConnection).call(pool);
  const query = promisify(connection.query).bind(connection);
  const column = async () => (await query(`SHOW COLUMNS FROM ${table} LIKE 'content_updated_at'`))[0];
  let lock, timeout;
  let reusable = true;
  try {
    if (hasDefault(await column())) return;
    const [{ database }] = await query('SELECT DATABASE() AS `database`');
    const key = 'sharh-freshness:' + createHash('sha256').update(`${database}:${table}`).digest('hex').slice(0, 40);
    const [{ acquired }] = await query('SELECT GET_LOCK(?, 30) AS acquired', [key]);
    if (Number(acquired) !== 1) throw new Error(`Timed out waiting for Sharh schema migration: ${table}`);
    lock = key;
    let current = await column();
    if (hasDefault(current)) return;
    [{ timeout }] = await query('SELECT @@SESSION.lock_wait_timeout AS timeout');
    await query('SET SESSION lock_wait_timeout=10');
    if (!current) {
      // INSTANT forbids a silent table-copy/rebuild during application startup.
      // NULL preserves unknown historical dates; only later inserts get now().
      try {
        await query(`ALTER TABLE ${table} ADD COLUMN content_updated_at DATETIME(3) NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP(3), ALGORITHM=INSTANT`);
      } catch (error) {
        // Compatibility with an older worker still running the unlocked migration.
        if (error.code !== 'ER_DUP_FIELDNAME') throw error;
      }
      current = await column();
    }
    if (!current) throw new Error(`Sharh revision column missing after migration: ${table}`);
    if (!hasDefault(current)) {
      // Changing only the default is metadata-only; MODIFY COLUMN can rebuild.
      await query(`ALTER TABLE ${table} ALTER COLUMN content_updated_at SET DEFAULT (CURRENT_TIMESTAMP(3)), ALGORITHM=INSTANT`);
    }
  } finally {
    try {
      if (timeout !== undefined) await query('SET SESSION lock_wait_timeout=?', [Number(timeout)]);
      if (lock) await query('SELECT RELEASE_LOCK(?)', [lock]);
    } catch (error) {
      reusable = false;
      connection.destroy(); // Closing the connection also releases advisory locks.
      throw error;
    } finally {
      if (reusable) connection.release();
    }
  }
}
module.exports = { migrate };
