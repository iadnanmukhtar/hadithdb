#!/usr/bin/env node
'use strict';

// Fill only numbers absent from the reader; retain superseded placeholder rows.
require('dotenv').config();
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql');
const { promisify } = require('util');
const { connectionSettings } = require('../initializeHadithAttributions');
const sources = require('../../data/repairs/riyad-sunnah-missing.json');
const USER = 'repair:riyad-sunnah';

async function missingNumbers(q, bookId) {
  const rows = await q(`SELECT DISTINCT FLOOR(hv.num0) n FROM hadiths_virtual hv
    JOIN v_hadiths h ON h.hId=hv.hadithId JOIN v_toc t ON t.hId=hv.tocId
    WHERE hv.bookId=?`, [bookId]);
  const present = new Set(rows.map(row => Number(row.n)));
  return Array.from({ length: 1896 }, (_, i) => i + 1).filter(n => !present.has(n));
}

async function main() {
  const db = mysql.createConnection(connectionSettings());
  const q = promisify(db.query).bind(db);
  try {
    const [book] = await q("SELECT * FROM books WHERE alias='riyad' AND `virtual`=1");
    assert(book);
    const missing = await missingNumbers(q, book.id);
    console.log(JSON.stringify({ missing, apply: process.argv.includes('--apply') }));
    if (!missing.length || !process.argv.includes('--apply')) return;
    const plan = [];
    for (const number of missing) {
      const source = sources.find(row => row.number === number);
      assert(source, `No reviewed Sunnah.com source for ${number}`);
      assert.equal(source.source, `https://sunnah.com/riyadussalihin:${number}`);
      assert.equal(source.actualReference, `${source.sourceBook}:${source.sourceNumber}`);
      const rows = await q('SELECT * FROM hadiths_virtual WHERE bookId=? AND num=? AND hadithId IS NULL', [book.id, String(number)]);
      assert.equal(rows.length, 1, `Expected one unlinked placeholder for ${number}`);
      const [toc] = await q('SELECT * FROM toc WHERE id=? AND bookId=?', [rows[0].tocId, book.id]);
      assert(toc);
      plan.push({ source, row: rows[0], toc });
    }
    const backup = path.resolve(__dirname, `../../temp/riyad-missing-before-${Date.now()}.json`);
    fs.writeFileSync(backup, JSON.stringify({ book, plan }, null, 2) + '\n');
    await q('START TRANSACTION');
    try {
      await q('SELECT id FROM books WHERE id=? FOR UPDATE', [book.id]);
      assert.deepEqual(await missingNumbers(q, book.id), missing, 'Reader changed during planning');
      for (const { source, row } of plan) {
        const [locked] = await q('SELECT * FROM hadiths_virtual WHERE id=? FOR UPDATE', [row.id]);
        assert.deepEqual(locked, row, 'Placeholder changed during planning');
        const matches = await q(`SELECT h.* FROM hadiths h JOIN books b ON b.id=h.bookId
          WHERE b.alias=? AND b.\`virtual\`=0 AND h.num=?`, [source.sourceBook, source.sourceNumber]);
        assert.equal(matches.length, 1, `Expected one actual source hadith for ${source.actualReference}`);
        const actual = matches[0];
        const normalize = text => String(text || '').normalize('NFKD')
          .replace(/[\u064b-\u065f\u0670\u06d6-\u06edـ]/gu, '')
          .replace(/[إأآٱ]/gu, 'ا').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
        assert(normalize(actual.body).includes(source.matchText), 'Actual source text differs');
        assert(normalize(row.textActual).includes(source.matchText), 'Riyad placeholder text differs');
        assert(actual.body_en, 'Actual source needs English text');
        const updated = await q('UPDATE hadiths_virtual SET hadithId=?,ref_num=?,lastmod_user=?,lastmod=CURRENT_TIMESTAMP WHERE id=? AND hadithId IS NULL',
          [actual.id, source.actualReference, USER, row.id]);
        assert.equal(updated.affectedRows, 1);
      }
      assert.deepEqual(await missingNumbers(q, book.id), []);
      await q('UPDATE books SET content_lastmod=CURRENT_TIMESTAMP WHERE id=?', [book.id]);
      await q('COMMIT');
    } catch (error) { await q('ROLLBACK'); throw error; }
    await q('CALL refresh_v_hadiths_virtual_snapshot(?)', [book.id]);
    const snapshot = await q('SELECT DISTINCT FLOOR(num0) n FROM v_hadiths_virtual_snapshot WHERE book_id=?', [book.id]);
    assert.equal(new Set(snapshot.map(row => Number(row.n))).size, 1896);
    console.log(JSON.stringify({ repaired: missing, backup, snapshotNumbers: snapshot.length }));
  } finally { await promisify(db.end).call(db); }
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { missingNumbers };
