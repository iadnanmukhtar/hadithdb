#!/usr/bin/env node
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const mysql = require('mysql');
const { promisify, isDeepStrictEqual } = require('util');
const { aliases, ...group } = require('./book-search-groups-seed.json').find(group => group.id === 'hadith-compilations');
const identities = { riyad: 61, mishkat: 100419, ibnrajab50: 57, suyuti: 1000, 'lulu-marjan': 50 };
const parse = value => typeof value === 'string' || Buffer.isBuffer(value) ? JSON.parse(value.toString()) : value;
async function main() {
  const settings = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.hadithdb/settings.json')));
  const connection = mysql.createConnection({ ...settings.mysql.connection, connectTimeout: 10000 });
  const query = promisify(connection.query).bind(connection);
  const apply = process.argv.includes('--apply');
  try {
    await query('START TRANSACTION');
    const rows = await query('SELECT * FROM books WHERE alias IN (?) ORDER BY id FOR UPDATE', [aliases]);
    const updates = [];
    for (const alias of aliases) {
      const row = rows.find(row => row.alias === alias);
      if (!row || row.id !== identities[alias] || row.type !== 'hadith') throw new Error(`Book identity changed: ${alias}`);
      const properties = parse(row.properties) || {};
      const before = properties.searchGroups || [];
      if (!Array.isArray(before)) throw new Error(`Invalid groups: ${alias}`);
      const membership = { ...group, memberOrdinal: aliases.indexOf(alias) };
      const existing = before.find(item => item.id === group.id);
      if (existing) {
        if (!isDeepStrictEqual(existing, membership)) throw new Error(`Conflicting membership: ${alias}`);
        continue;
      }
      updates.push({ row, properties: { ...properties, searchGroups: [...before, membership] } });
    }
    let backup = null;
    if (apply && updates.length) {
      backup = path.join(os.tmpdir(), `hadithdb-compilations-${Date.now()}.json`);
      fs.writeFileSync(backup, JSON.stringify(rows, null, 2), { mode: 0o600 });
      for (const update of updates) {
        const result = await query('UPDATE books SET properties=?, content_lastmod=CURRENT_TIMESTAMP() WHERE id=? AND alias=?', [JSON.stringify(update.properties), update.row.id, update.row.alias]);
        if (result.affectedRows !== 1) throw new Error(`Unexpected update: ${update.row.alias}`);
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
