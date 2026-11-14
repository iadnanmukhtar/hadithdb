#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const mysql = require('mysql');
const {promisify} = require('util');
const metadata = require('../../data/yqsirah-metadata.json');
const previousDescription = 'English transcript of Yasir Qadhi’s 101-part Seerah Series, imported from the supplied PDF. Chapters are arranged topically, with original transcript wording and editorial footnotes preserved.';
(async()=>{
  const db = mysql.createConnection(require(path.join(require('os').homedir(),'.hadithdb/settings.json')).mysql.connection);
  const query = promisify(db.query).bind(db);
  try {
    await query('START TRANSACTION');
    const [before] = await query('SELECT * FROM books WHERE alias=? FOR UPDATE',['yqsirah']);
    assert(before && before.type === 'sirah' && before.lang === 'en');
    const unchanged = Object.entries(metadata).every(([key,value])=>before[key]===value);
    if (!unchanged) {
      assert.equal(before.author_en,'Yasir Qadhi','Author changed since review');
      assert.equal(before.description,previousDescription,'Description changed since review');
    }
    const apply = process.argv.includes('--apply');
    let backup;
    if (apply && !unchanged) {
      const directory = path.resolve('var/imports/yqsirah');
      fs.mkdirSync(directory,{recursive:true});
      backup = path.join(directory,`metadata-before-${Date.now()}.json`);
      fs.writeFileSync(backup,JSON.stringify(before),{mode:0o600,flag:'wx'});
      await query('UPDATE books SET ? WHERE id=?',[metadata,before.id]);
      const [after] = await query('SELECT * FROM books WHERE id=?',[before.id]);
      for (const key of Object.keys(before)) {
        if (key === 'lastmod') continue;
        assert.deepEqual(after[key],Object.hasOwn(metadata,key) ? metadata[key] : before[key],`Unexpected change: ${key}`);
      }
    }
    await query(apply ? 'COMMIT' : 'ROLLBACK');
    console.log(JSON.stringify({applied:apply,unchanged,bookId:before.id,fields:Object.keys(metadata),backup}));
  } catch(error) {
    await query('ROLLBACK').catch(()=>{});
    throw error;
  } finally {db.destroy();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
