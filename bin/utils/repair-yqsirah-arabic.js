#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const mysql = require('mysql');
const {promisify} = require('util');
const {manifest, repairEntry, contentHash, repairHash} = require('./yqsirah-arabic-repairs');

async function main() {
  const apply = process.argv.includes('--apply');
  const db = mysql.createConnection(require(path.join(require('os').homedir(), '.hadithdb/settings.json')).mysql.connection);
  const query = promisify(db.query).bind(db);
  try {
    await query('START TRANSACTION');
    const [book] = await query('SELECT id,type,lang FROM books WHERE alias=? FOR UPDATE', ['yqsirah']);
    assert(book && book.type === 'sirah' && book.lang === 'en');
    const numbers = Object.keys(manifest.original_hashes);
    const rows = await query('SELECT h.*,s.content_sha256,s.source_json FROM hadiths h JOIN yqsirah_source_entries s ON s.book_id=h.bookId AND s.item_id=h.id WHERE h.bookId=? AND h.num IN (?) ORDER BY h.ordinal FOR UPDATE', [book.id,numbers]);
    assert.equal(rows.length,numbers.length);
    const pending = [];
    for (const row of rows) {
      const provenance = typeof row.source_json === 'string' ? JSON.parse(row.source_json) : row.source_json;
      assert.equal(provenance.source_sha256,manifest.source_sha256);
      const entry = {num:Number(row.num),title:row.title_en,body:row.body_en,footnotes:row.footnote_en,h1:Number(row.h1),h2:Number(row.h2),provenance};
      if (provenance.arabic_repair_sha256 === repairHash) {
        assert.equal(contentHash(entry),row.content_sha256,'Repaired passage edited; refusing replacement');
        assert.equal(row.text_en,row.body_en);
        continue;
      }
      assert.equal(row.content_sha256,manifest.original_hashes[row.num]);
      assert.equal(row.text_en,row.body_en,'Search body differs');
      pending.push({row,after:repairEntry(entry)});
    }
    let backup;
    if (apply && pending.length) {
      const directory = path.resolve('var/imports/yqsirah-arabic-repair');
      fs.mkdirSync(directory,{recursive:true});
      backup = path.join(directory,`before-${Date.now()}.json`);
      fs.writeFileSync(backup,JSON.stringify({repairHash,rows:pending.map(p=>p.row)}),{mode:0o600,flag:'wx'});
      for (const {row,after} of pending) {
        await query('UPDATE hadiths SET body_en=?,text_en=?,footnote_en=? WHERE id=? AND bookId=?',[after.body,after.body,after.footnotes,row.id,book.id]);
        await query('UPDATE yqsirah_source_entries SET content_sha256=?,source_json=? WHERE book_id=? AND item_id=?',[after.sha256,JSON.stringify(after.provenance),book.id,row.id]);
        const [stored] = await query('SELECT title_en,body_en,text_en,footnote_en,h1,h2 FROM hadiths WHERE id=?',[row.id]);
        assert.equal(contentHash({title:stored.title_en,body:stored.body_en,footnotes:stored.footnote_en,h1:Number(stored.h1),h2:Number(stored.h2)}),after.sha256);
        assert.equal(stored.text_en,stored.body_en);
      }
    }
    await query(apply ? 'COMMIT' : 'ROLLBACK');
    console.log(JSON.stringify({applied:apply,bookId:book.id,passagesChecked:rows.length,passagesChanged:pending.length,repairs:manifest.repairs.length,repairHash,backup}));
  } catch (error) {
    await query('ROLLBACK').catch(()=>{});
    throw error;
  } finally { db.destroy(); }
}
if (require.main === module) main().catch(error=>{console.error(error.message);process.exitCode=1;});
