#!/usr/bin/env node
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const mysql = require('mysql');
const { promisify, isDeepStrictEqual } = require('util');
const seed = require('./book-search-groups-seed.json').filter(group => group.scope === 'tafsir');
const review = require('./tafsir-category-review.json');
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const parse = value => typeof value === 'string' || Buffer.isBuffer(value) ? JSON.parse(value.toString()) : value;

function planUpdates(rows) {
  if (hash(seed) !== review.seedHash) throw new Error('Tafsir seed changed since review');
  const byAlias = new Map(rows.map(row => [row.alias, row]));
  for (const row of rows.filter(row => row.type === 'tafsir')) {
    if (!review.entries.some(entry => entry.id === row.id && entry.alias === row.alias)) throw new Error(`Unreviewed tafsir: ${row.alias}`);
  }
  for (const group of seed) for (const alias of group.aliases) {
    if (!review.entries.some(entry => entry.alias === alias)) throw new Error(`Unreviewed membership: ${alias}`);
  }
  return review.entries.flatMap(entry => {
    const row = byAlias.get(entry.alias);
    if (!row || row.id !== entry.id || row.type !== 'tafsir') throw new Error(`Book identity changed: ${entry.alias}`);
    const properties = parse(row.properties) || {};
    if (typeof properties !== 'object' || Array.isArray(properties)) throw new Error(`Invalid properties: ${entry.alias}`);
    const before = properties.searchGroups || [];
    if (!Array.isArray(before)) throw new Error(`Invalid memberships: ${entry.alias}`);
    const memberships = seed.filter(group => group.aliases.includes(entry.alias)).map(({ aliases, memberEvidence, ...group }) => ({
      ...group, memberOrdinal: aliases.indexOf(entry.alias), ...memberEvidence[entry.alias]
    }));
    if (!memberships.length) throw new Error(`Uncategorized tafsir: ${entry.alias}`);
    const after = [...before.filter(group => group.scope !== 'tafsir' && !group.id?.startsWith('tafsir-')), ...memberships];
    if (isDeepStrictEqual(before, after)) return [];
    if (hash(before) !== entry.beforeHash) throw new Error(`Concurrent membership edit: ${entry.alias}; refusing to overwrite`);
    return [{ row, properties: { ...properties, searchGroups: after } }];
  });
}

async function run(query, apply = false) {
  let transaction = false;
  try {
    await query('START TRANSACTION'); transaction = true;
    const rows = await query('SELECT * FROM books ORDER BY id' + (apply ? ' FOR UPDATE' : ''));
    const updates = planUpdates(rows);
    let backup = null;
    if (apply && updates.length) {
      backup = path.join(os.tmpdir(), `hadithdb-tafsir-categories-${Date.now()}.json`);
      fs.writeFileSync(backup, JSON.stringify({ review, seed, rows }, null, 2), { mode: 0o600 });
      for (const update of updates) {
        const result = await query('UPDATE books SET properties=?, content_lastmod=CURRENT_TIMESTAMP() WHERE id=? AND alias=?', [JSON.stringify(update.properties), update.row.id, update.row.alias]);
        if (result.affectedRows !== 1) throw new Error(`Unexpected update: ${update.row.alias}`);
      }
      const actual = await query('SELECT * FROM books ORDER BY id');
      const expected = rows.map(row => {
        const update = updates.find(item => item.row.id === row.id);
        return update ? { ...row, properties: JSON.stringify(update.properties) } : row;
      });
      const normalize = row => {
        const copy = { ...row, properties: parse(row.properties) };
        if (updates.some(item => item.row.id === row.id)) { delete copy.lastmod; delete copy.content_lastmod; }
        return copy;
      };
      if (!isDeepStrictEqual(actual.map(normalize), expected.map(normalize))) throw new Error('Post-update verification failed; rolling back');
      if (planUpdates(actual).length) throw new Error('Membership verification failed');
    }
    await query(apply ? 'COMMIT' : 'ROLLBACK'); transaction = false;
    return { apply, reviewed: review.entries.length, updated: updates.length, categories: seed.length, backup };
  } catch (error) {
    if (transaction) await query('ROLLBACK');
    throw error;
  }
}

async function main() {
  const settings = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.hadithdb/settings.json')));
  const connection = mysql.createConnection({ ...settings.mysql.connection, connectTimeout: 10000 });
  const query = promisify(connection.query).bind(connection);
  try { console.log(JSON.stringify(await run(query, process.argv.includes('--apply')), null, 2)); }
  finally { connection.end(); }
}
module.exports = { planUpdates, run };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
