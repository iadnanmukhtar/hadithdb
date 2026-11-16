#!/usr/bin/env node
'use strict';
// Update only reviewed H2 labels and introductions, with exact snapshot guards.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert/strict');
const ROOT = path.resolve('var/imports/yqsirah/toc-editorial');
const OUT = path.resolve('data/yqsirah-toc-editorial-en.json');
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const plain = value => JSON.parse(JSON.stringify(value));

function targets(snapshot) {
  return snapshot.toc.filter(t => Number(t.level) === 2).map(t => ({
    ...t,
    children: snapshot.toc.filter(c => Number(c.level) === 3 && c.h1 === t.h1 && c.h2 === t.h2),
    passages: snapshot.passages.filter(p => p.h1 === t.h1 && p.h2 === t.h2)
  }));
}

function validate(rows, sections) {
  assert.equal(sections.length, rows.length, 'Section count');
  sections.forEach((section, index) => {
    assert.equal(section.id, rows[index].id, 'Heading ID/order');
    for (const key of ['title_en', 'intro_en']) {
      assert.equal(typeof section[key], 'string');
      assert(section[key].trim());
      assert(!/[ʿʾ‘`āīūḥṣḍṭẓḤṢḌṬẒĀĪŪ]/u.test(section[key]), `Transliteration mark ${section.id}`);
      assert(!/\b(?:Ka['’]b|Sa['’]d|Mu['’]adh|Mas['’]ud|Nu['’]man|da['’]wah|Qur['’]an)\b/i.test(section[key]), `Ayn spelling ${section.id}`);
    }
    assert(section.intro_en.startsWith('✧ '));
    assert(section.intro_en.split(/\s+/).length <= 36, `Long intro ${section.id}`);
    assert(/[.!?]$/.test(section.intro_en));
  });
}

async function main() {
  const snapshot = JSON.parse(fs.readFileSync(path.join(ROOT, 'before.json')));
  const rows = targets(snapshot);
  const artifact = JSON.parse(fs.readFileSync(OUT));
  assert.equal(rows.length, 490);
  assert.equal(artifact.source_sha256, hash(snapshot));
  validate(rows, artifact.sections);
  const mysql = require('mysql');
  const { promisify } = require('util');
  const settings = require(path.join(require('os').homedir(), '.hadithdb/settings.json'));
  const db = mysql.createConnection({ ...settings.mysql.connection, connectTimeout: 10000 });
  const query = promisify(db.query).bind(db);
  try {
    await query('START TRANSACTION');
    const current = plain(await query('SELECT * FROM toc WHERE bookId=? ORDER BY ordinal FOR UPDATE', [snapshot.book.id]));
    assert.equal(current.length, snapshot.toc.length);
    const desired = new Map(artifact.sections.map(section => [section.id, section]));
    const changes = [];
    for (let i = 0; i < current.length; i++) {
      const row = current[i], old = snapshot.toc[i], section = desired.get(row.id);
      assert.equal(row.id, old.id);
      for (const key of Object.keys(old)) {
        // MySQL updates lastmod automatically. Accept it on an idempotent rerun
        // only when both edited fields already exactly match the artifact.
        if (key === 'lastmod' && section && row.title_en === section.title_en && row.intro_en === section.intro_en)
          continue;
        if (section && ['title_en', 'intro_en'].includes(key))
          assert(row[key] === old[key] || row[key] === section[key], `Newer edit ${row.id}/${key}`);
        else
          assert.deepEqual(row[key], old[key], `Changed metadata ${row.id}/${key}`);
      }
      if (section && (row.title_en !== section.title_en || row.intro_en !== section.intro_en))
        changes.push(section);
    }
    const state = hash(current);
    const apply = process.argv.includes('--apply');
    if (apply) {
      assert.equal(process.argv.find(arg => arg.startsWith('--expected-state='))?.split('=')[1], state, 'Live state changed');
      fs.writeFileSync(path.join(ROOT, `backup-${Date.now()}.json`), JSON.stringify(current, null, 2), { mode: 0o600 });
      if (changes.length) {
        const cases = changes.map(() => 'WHEN ? THEN ?').join(' ');
        await query(`UPDATE toc SET title_en=CASE id ${cases} ELSE title_en END,
          intro_en=CASE id ${cases} ELSE intro_en END WHERE bookId=? AND id IN (?)`, [
          ...changes.flatMap(section => [section.id, section.title_en]),
          ...changes.flatMap(section => [section.id, section.intro_en]),
          snapshot.book.id, changes.map(section => section.id)
        ]);
      }
      const after = plain(await query('SELECT * FROM toc WHERE bookId=? ORDER BY ordinal', [snapshot.book.id]));
      const changedIds = new Set(changes.map(section => section.id));
      assert.equal(after.length, current.length);
      for (let i = 0; i < after.length; i++) {
        const section = desired.get(after[i].id);
        assert.deepEqual(after[i], {
          ...current[i],
          ...(section ? { title_en: section.title_en, intro_en: section.intro_en } : {}),
          ...(changedIds.has(after[i].id) ? { lastmod: after[i].lastmod } : {})
        });
      }
      if (changes.length)
        await query('UPDATE books SET content_lastmod=NOW() WHERE id=?', [snapshot.book.id]);
      await query('COMMIT');
    } else {
      await query('ROLLBACK');
    }
    const report = { applied: apply, targets: rows.length, changes: changes.length, state };
    fs.writeFileSync(path.join(ROOT, apply ? 'applied.json' : 'dry-run.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } catch (error) {
    await query('ROLLBACK');
    throw error;
  } finally {
    db.destroy();
  }
}

module.exports = { targets, validate, hash, ROOT, OUT };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
