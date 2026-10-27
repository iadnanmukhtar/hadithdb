#!/usr/bin/env node
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const mysql = require('mysql');
const { promisify, isDeepStrictEqual } = require('util');
const { aliases, ...group } = require('./book-search-groups-seed.json').find(group => group.id === 'hadith-personal-development');
const retired = new Set(['hadith-adab', 'hadith-zuhd', group.id]);
const parse = value => typeof value === 'string' || Buffer.isBuffer(value) ? JSON.parse(value.toString()) : value;
async function main() {
  const settings = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.hadithdb/settings.json')));
  const connection = mysql.createConnection({ ...settings.mysql.connection, connectTimeout: 10000 });
  const query = promisify(connection.query).bind(connection);
  const apply = process.argv.includes('--apply');
  try {
    await query('START TRANSACTION');
    const rows = await query('SELECT id, alias, properties FROM books ORDER BY id FOR UPDATE');
    const updates = [];
    for (const row of rows) {
      const properties = parse(row.properties) || {};
      const before = properties.searchGroups || [];
      if (!Array.isArray(before)) throw new Error(`Invalid groups: ${row.alias}`);
      if (!before.some(item => retired.has(item.id))) continue;
      if (!aliases.includes(row.alias)) throw new Error(`Unexpected member: ${row.alias}`);
      const searchGroups = [...before.filter(item => !retired.has(item.id)), { ...group, memberOrdinal: aliases.indexOf(row.alias) }];
      if (!isDeepStrictEqual(before, searchGroups)) updates.push({ row, properties: { ...properties, searchGroups } });
    }
    for (const alias of aliases) {
      if (!rows.some(row => row.alias === alias && (parse(row.properties)?.searchGroups || []).some(item => retired.has(item.id)))) throw new Error(`Missing member: ${alias}`);
    }
    let backup = null;
    if (apply && updates.length) {
      backup = path.join(os.tmpdir(), `hadithdb-personal-development-${Date.now()}.json`);
      fs.writeFileSync(backup, JSON.stringify(updates.map(item => item.row), null, 2), { mode: 0o600 });
      for (const update of updates) {
        await query('UPDATE books SET properties=?, content_lastmod=CURRENT_TIMESTAMP() WHERE id=? AND alias=?', [JSON.stringify(update.properties), update.row.id, update.row.alias]);
        const [actual] = await query('SELECT properties FROM books WHERE id=?', [update.row.id]);
        if (!isDeepStrictEqual(parse(actual.properties), update.properties)) throw new Error(`Verification failed: ${update.row.alias}`);
      }
    }
    await query(apply ? 'COMMIT' : 'ROLLBACK');
    console.log(JSON.stringify({ apply, updated: updates.length, members: aliases, backup }, null, 2));
  } catch (error) { await query('ROLLBACK'); throw error; }
  finally { connection.end(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
