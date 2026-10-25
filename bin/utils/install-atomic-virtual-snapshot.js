#!/usr/bin/env node
'use strict';

// Run on a dedicated connection, outside an application transaction.
require('dotenv').config();
const fs = require('fs');
const os = require('os');
const path = require('path');
const mysql = require('mysql');
const { promisify } = require('util');
const { connectionSettings } = require('../initializeHadithAttributions');
const definition = fs.readFileSync(path.join(__dirname, '../../data/migrations/atomic-virtual-hadith-snapshot.sql'), 'utf8');
const routine = 'refresh_v_hadiths_virtual_snapshot';
const lock = 'v_hadiths_virtual_snapshot_refresh';

async function install(query, options = {}) {
  const table = await query("SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='v_hadiths_virtual_snapshot'");
  if (table[0]?.ENGINE !== 'InnoDB') throw new Error('Snapshot must use InnoDB for atomic refreshes');
  const [before] = await query(`SHOW CREATE PROCEDURE ${routine}`);
  const previous = before['Create Procedure'];
  if (previous.includes('DECLARE v_transaction_started')) return { changed: false, atomic: true };
  if (!options.apply) return { changed: false, atomic: false, pending: true };
  const acquired = await query('SELECT GET_LOCK(?, 30) AS acquired', [lock]);
  if (Number(acquired[0]?.acquired) !== 1) throw new Error('Snapshot refresh is busy; no changes made');
  try {
    // Keep the original definition, definer and creation session settings for recovery.
    const backup = path.join(options.backupDir || path.join(os.homedir(), '.hadithdb/backups'), `virtual-snapshot-procedure-${Date.now()}.json`);
    fs.mkdirSync(path.dirname(backup), { recursive: true });
    fs.writeFileSync(backup, JSON.stringify(before, null, 2));
    await query(`DROP PROCEDURE ${routine}`);
    try {
      await query(definition);
    } catch (error) {
      await query(previous);
      throw error;
    }
    return { changed: true, atomic: true, backup };
  } finally {
    await query('DO RELEASE_LOCK(?)', [lock]);
  }
}

async function main() {
  const db = mysql.createConnection(connectionSettings());
  const query = promisify(db.query).bind(db);
  try { console.log(JSON.stringify(await install(query, { apply: process.argv.includes('--apply') }))); }
  finally { await promisify(db.end).call(db).catch(() => {}); }
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
module.exports = { install, definition };
