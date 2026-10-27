#!/usr/bin/env node
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const mysql = require('mysql');
const { promisify, isDeepStrictEqual } = require('util');
const groups = require('./book-search-groups-seed.json').filter(group => group.scope === 'sharh');
function plan(rows) {
  for (const group of groups) for (const alias of group.aliases) {
    if (!rows.some(row => row.alias === alias && row.type === 'sharh')) throw new Error(`Missing sharh: ${alias}`);
  }
  return rows.flatMap(row => {
    const memberships = groups.filter(group => group.aliases.includes(row.alias)).map(({ aliases, ...group }) => ({ ...group, memberOrdinal: aliases.indexOf(row.alias) }));
    if (!memberships.length) return [];
    const properties = typeof row.properties === 'string' || Buffer.isBuffer(row.properties) ? JSON.parse(row.properties.toString()) : (row.properties || {});
    const next = { ...properties, searchGroups: [...(properties.searchGroups || []).filter(group => group.scope !== 'sharh'), ...memberships] };
    return isDeepStrictEqual(properties, next) ? [] : [{ row, properties: next }];
  });
}
async function main() {
  const settings = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.hadithdb/settings.json')));
  const connection = mysql.createConnection(settings.mysql.connection);
  const query = promisify(connection.query).bind(connection);
  const apply = process.argv.includes('--apply');
  try {
    await query('START TRANSACTION');
    const rows = await query("SELECT id, alias, type, properties FROM books WHERE type='sharh' FOR UPDATE");
    const updates = plan(rows);
    let backup;
    if (apply && updates.length) {
      backup = path.join(os.tmpdir(), `hadithdb-sharh-categories-${Date.now()}.json`);
      fs.writeFileSync(backup, JSON.stringify(rows, null, 2), { mode: 0o600 });
      for (const update of updates) await query('UPDATE books SET properties=? WHERE id=? AND alias=?', [JSON.stringify(update.properties), update.row.id, update.row.alias]);
      if (plan(await query("SELECT id, alias, type, properties FROM books WHERE type='sharh'")).length) throw new Error('Verification failed');
    }
    await query(apply ? 'COMMIT' : 'ROLLBACK');
    console.log(JSON.stringify({ apply, categories: groups.length, updated: updates.length, backup }));
  } catch (error) { await query('ROLLBACK'); throw error; }
  finally { connection.end(); }
}
module.exports = { plan, groups };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
