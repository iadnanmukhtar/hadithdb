#!/usr/bin/env node
'use strict';

// Reviewed, repeatable name repair. Dry run by default; --apply writes only planned fields.
const fs = require('fs');
const os = require('os');
const path = require('path');
const mysql = require('mysql');
const { promisify, isDeepStrictEqual } = require('util');
const Books = require('../../lib/Books');
const plan = require('./book-display-names-plan.json');
const allowed = new Set(['shortName', 'shortName_en', 'name', 'name_en', 'title', 'title_en', 'author', 'author_en', 'authorShortName', 'authorShortName_en']);
const strip = value => String(value || '').replace(/\p{M}/gu, '');

function validatePlan(input) {
  const seen = new Set();
  for (const entry of input.entries) {
    if (!Number.isSafeInteger(entry.id) || entry.id < 0 || !entry.alias || seen.has(entry.id)) throw new Error('Invalid/duplicate book identity');
    seen.add(entry.id);
    for (const [field, change] of Object.entries(entry.fields)) {
      if (!allowed.has(field) || typeof change.after !== 'string' || !change.after.trim() || !change.reason) throw new Error(`Invalid ${entry.alias}.${field}`);
      const limit = field.startsWith('authorShortName') ? 255 : (field.startsWith('shortName') ? 120 : Infinity);
      if ([...change.after].length > limit) throw new Error(`${entry.alias}.${field} exceeds column length`);
      if (change.reason.startsWith('Add missing lexical tashkil') && strip(change.before) !== strip(change.after)) throw new Error(`${entry.alias}.${field} changes base spelling`);
    }
  }
}

async function run(query, apply = false, planOverride = plan) {
  const plan = planOverride;
  validatePlan(plan);
  const ids = plan.entries.map(entry => entry.id);
  let locked = false;
  let transaction = false;
  try {
    if (apply) {
      const lock = await query("SELECT GET_LOCK('hadithdb-book-display-names', 30) AS acquired");
      if (Number(lock[0].acquired) !== 1) throw new Error('Unable to lock book-name repair');
      locked = true;
    }
    await query('START TRANSACTION'); transaction = true;
    const rows = await query(`SELECT * FROM books WHERE id IN (${ids.join(',')}) ORDER BY id${apply ? ' FOR UPDATE' : ''}`);
    const byId = new Map(rows.map(row => [Number(row.id), row]));
    const updates = [];
    for (const entry of plan.entries) {
      const current = byId.get(entry.id);
      if (!current || current.alias !== entry.alias) throw new Error(`Book identity changed: ${entry.id}/${entry.alias}`);
      const changes = {};
      for (const [field, change] of Object.entries(entry.fields)) {
        const value = current[field] == null ? null : current[field];
        if (value === change.after) continue;
        if (value !== change.before) throw new Error(`Concurrent/unreviewed change to ${entry.alias}.${field}; refusing to overwrite`);
        changes[field] = change.after;
      }
      if (Object.keys(changes).length) updates.push({ entry, changes });
    }
    let backup = null;
    if (apply && updates.length) {
      backup = path.join(os.tmpdir(), `hadithdb-book-display-names-${Date.now()}.json`);
      fs.writeFileSync(backup, JSON.stringify({ rows, plan }, null, 2), { mode: 0o600 });
      for (const { entry, changes } of updates) {
        const fields = Object.keys(changes);
        const result = await query(`UPDATE books SET ${fields.map(field => mysql.escapeId(field) + '=?').join(', ')}, content_lastmod=CURRENT_TIMESTAMP() WHERE id=? AND alias=?`, [...fields.map(field => changes[field]), entry.id, entry.alias]);
        if (result.affectedRows !== 1) throw new Error(`Unexpected update result for ${entry.alias}`);
      }
      const verified = await query(`SELECT * FROM books WHERE id IN (${ids.join(',')}) ORDER BY id`);
      for (const actual of verified) {
        const expected = { ...byId.get(Number(actual.id)) };
        const update = updates.find(item => item.entry.id === Number(actual.id));
        if (update) Object.assign(expected, update.changes);
        // MySQL maintains lastmod automatically when any metadata changes.
        delete expected.lastmod;
        const comparable = { ...actual }; delete comparable.lastmod;
        if (update) {
          if (Number(new Date(actual.content_lastmod)) !== Number(new Date(actual.lastmod))) throw new Error(`Metadata freshness timestamp mismatch for ${actual.alias}`);
          delete expected.content_lastmod; delete comparable.content_lastmod;
        }
        if (!isDeepStrictEqual(expected, comparable)) throw new Error(`Post-update verification failed for ${actual.alias}`);
      }
    }
    await query(apply ? 'COMMIT' : 'ROLLBACK'); transaction = false;
    return { apply, books: updates.length, fields: updates.reduce((count, item) => count + Object.keys(item.changes).length, 0), backup, notes: plan.notes };
  } catch (error) {
    if (transaction) await query('ROLLBACK');
    throw error;
  } finally {
    if (locked) await query("SELECT RELEASE_LOCK('hadithdb-book-display-names')");
  }
}

async function main() {
  const settings = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.hadithdb/settings.json'), 'utf8'));
  const connection = mysql.createConnection({ ...settings.mysql.connection, connectTimeout: 10000 });
  const query = promisify(connection.query).bind(connection);
  try {
    if (process.argv.includes('--apply')) {
      const previousQuery = global.query;
      try { global.query = query; await Books.ensureAuthorShortNameColumns(); }
      finally { global.query = previousQuery; }
    }
    const selectedPlan = process.argv.includes('--clean-arabic-sharh-names')
      ? require('./sharh-clean-arabic-names-plan.json')
      : process.argv.includes('--clean-sharh-names')
      ? require('./sharh-clean-names-plan.json')
      : process.argv.includes('--expand-author-short-names')
        ? require('./book-author-short-names-expanded-plan.json') : plan;
    console.log(JSON.stringify(await run(query, process.argv.includes('--apply'), selectedPlan), null, 2));
  } finally { connection.end(); }
}

module.exports = { validatePlan, run };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
