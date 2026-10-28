#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const mysql = require('mysql');
const { promisify } = require('util');
const { CANONICAL_AYAH_COUNTS } = require('../../packages/quran-review-core');
const plan = require('../../data/repairs/quran-passage-gap-audit.json');
const ayah = value => Number(String(value).split(':').pop());

function validate(rows) {
  for (let surah = 1; surah <= 114; surah++) {
    const passages = rows.filter(row => row.level === 2 && row.h1 === surah);
    for (let a = 1; a <= CANONICAL_AYAH_COUNTS[surah - 1]; a++)
      assert.equal(passages.filter(p => ayah(p.start) <= a && ayah(p.end) >= a).length, 1, `Coverage ${surah}:${a}`);
    for (const child of rows.filter(row => row.level === 3 && row.h1 === surah))
      assert(passages.some(p => p.h2 === child.h2 && ayah(p.start) <= ayah(child.start) && ayah(p.end) >= ayah(child.end)), `Parent containment ${child.id}`);
  }
  for (const row of rows.filter(row => row.level === 2 || row.level === 3))
    assert.equal(row.count, ayah(row.end) - ayah(row.start) + 1, `Count ${row.id}`);
}

async function main() {
  const apply = process.argv.includes('--apply');
  const settings = require(path.join(require('os').homedir(), '.hadithdb/settings.json'));
  const connection = mysql.createConnection({ ...settings.mysql.connection, connectTimeout: 10000 });
  const query = promisify(connection.query).bind(connection);
  const changes = [...plan.repairs, ...plan.countRepairs];
  const fields = ['start', 'end', 'start0', 'end0', 'count'];
  try {
    await query('START TRANSACTION');
    const before = await query("SELECT t.* FROM toc t JOIN books b ON b.id=t.bookId WHERE b.alias='quran' ORDER BY t.id FOR UPDATE");
    const projected = before.map(row => ({ ...row }));
    const pending = [];
    for (const change of changes) {
      const row = projected.find(row => row.id === change.before.id);
      assert(row, `Missing heading ${change.before.id}`);
      if (fields.every(field => row[field] === change.after[field])) continue;
      for (const field of ['level', 'h1', 'h2', ...fields])
        assert.equal(row[field], change.before[field], `Changed since audit: ${row.id}.${field}`);
      const patch = Object.fromEntries(fields.filter(field => row[field] !== change.after[field]).map(field => [field, change.after[field]]));
      Object.assign(row, patch);
      pending.push({ id: row.id, patch });
    }
    validate(projected);
    if (!apply) {
      await query('ROLLBACK');
      console.log(JSON.stringify({ dryRun: true, pending, canonicalAyahs: 6236, validation: 'All covered exactly once; counts and subsection containment valid.' }));
      return;
    }
    const directory = path.resolve('data/repairs', `quran-gap-backup-${Date.now()}`);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'before.json'), JSON.stringify(before, null, 2));
    for (const change of pending) {
      const result = await query('UPDATE toc SET ? WHERE id=?', [change.patch, change.id]);
      assert.equal(result.affectedRows, 1);
    }
    const after = await query("SELECT t.* FROM toc t JOIN books b ON b.id=t.bookId WHERE b.alias='quran' ORDER BY t.id");
    validate(after);
    // MySQL updates lastmod automatically; every other field must match the plan.
    const stable = rows => rows.map(({ lastmod, ...row }) => row);
    assert.deepEqual(stable(after), stable(projected));
    fs.writeFileSync(path.join(directory, 'after.json'), JSON.stringify(after, null, 2));
    await query('COMMIT');
    console.log(JSON.stringify({ committed: true, updated: pending.length, backup: directory, canonicalAyahs: 6236 }));
  } catch (error) {
    await query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    connection.destroy();
  }
}

module.exports = { validate };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
