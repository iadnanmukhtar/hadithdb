#!/usr/bin/env node
'use strict';
// Dry run by default. Does not load Globals (which can start background work).
const mysql = require('mysql');
const fs = require('fs');
const os = require('os');
const { promisify } = require('util');
const { indexes } = require('../../lib/HadithGradeLookup');

async function run(query, apply = false) {
  const existing = await query('SHOW INDEX FROM hdith_hadith_grades');
  const grouped = new Map();
  for (const row of existing) {
    if (!grouped.has(row.Key_name)) grouped.set(row.Key_name, []);
    grouped.get(row.Key_name)[Number(row.Seq_in_index) - 1] = row;
  }
  for (const index of indexes) {
    const same = columns => index.columns.every((column, i) => columns[i]?.Column_name === column && !columns[i]?.Sub_part);
    if ([...grouped.values()].some(same)) {
      console.log(`${index.name}: covered`);
      continue;
    }
    if (grouped.has(index.name)) throw Error(`${index.name} exists with a different definition`);
    const sql = `ALTER TABLE hdith_hadith_grades ADD INDEX ${index.name} (${index.columns.join(',')}), ALGORITHM=INPLACE, LOCK=NONE`;
    console.log(`${apply ? 'Applying' : 'Would apply'}: ${sql}`);
    if (apply) await query(sql);
  }
}
async function main() {
  const settings = JSON.parse(fs.readFileSync(`${os.homedir()}/.hadithdb/settings.json`, 'utf8'));
  const db = mysql.createConnection({ ...settings.mysql.connection, connectTimeout: 8000 });
  const query = promisify(db.query).bind(db);
  try {
    // Fail quickly on a metadata lock instead of queueing application requests.
    await query('SET SESSION lock_wait_timeout=5');
    await run(query, process.argv.includes('--apply'));
  } finally { db.end(); }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { run };
