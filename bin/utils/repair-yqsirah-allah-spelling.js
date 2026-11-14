#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),mysql=require('mysql'),{promisify}=require('util');
const {contentHash}=require('./yqsirah-arabic-repairs');
const {normalizeAllahSpelling}=require('./yqsirah-allah-spelling');
(async()=>{
 const db=mysql.createConnection(require(path.join(require('os').homedir(),'.hadithdb/settings.json')).mysql.connection),query=promisify(db.query).bind(db);
 try {
  await query('START TRANSACTION');
  const [book]=await query('SELECT id FROM books WHERE alias=? FOR UPDATE',['yqsirah']);assert(book);
  const rows=await query('SELECT h.*,s.source_json,s.content_sha256 FROM hadiths h JOIN yqsirah_source_entries s ON s.book_id=h.bookId AND s.item_id=h.id WHERE h.bookId=? ORDER BY h.ordinal FOR UPDATE',[book.id]);
  assert.equal(rows.length,1023);
  const pending=[];let replacements=0;
  for(const row of rows){
   assert(!String(row.title_en||'').includes('هللا'),'Title correction requires corresponding TOC change');
   const entry={num:Number(row.num),title:row.title_en,body:row.body_en,footnotes:row.footnote_en,h1:Number(row.h1),h2:Number(row.h2),provenance:typeof row.source_json==='string'?JSON.parse(row.source_json):row.source_json};
   const after=normalizeAllahSpelling(entry);if(after===entry)continue;
   assert.equal(contentHash(entry),row.content_sha256,'Source changed since import');assert.equal(row.body_en,row.text_en);
   replacements+=after.provenance.allah_spelling_replacements;pending.push({row,after});
  }
  const apply=process.argv.includes('--apply');let backup;
  if(apply&&pending.length){
   const dir=path.resolve('var/imports/yqsirah');fs.mkdirSync(dir,{recursive:true});backup=path.join(dir,`allah-spelling-before-${Date.now()}.json`);fs.writeFileSync(backup,JSON.stringify(pending.map(p=>p.row)),{mode:0o600,flag:'wx'});
   for(const {row,after} of pending){
    await query('UPDATE hadiths SET body_en=?,text_en=?,footnote_en=? WHERE id=?',[after.body,after.body,after.footnotes,row.id]);
    await query('UPDATE yqsirah_source_entries SET source_json=?,content_sha256=? WHERE book_id=? AND item_id=?',[JSON.stringify(after.provenance),after.sha256,book.id,row.id]);
    const [stored]=await query('SELECT body_en,text_en,footnote_en FROM hadiths WHERE id=?',[row.id]);assert.equal(stored.body_en,after.body);assert.equal(stored.text_en,after.body);assert.equal(stored.footnote_en,after.footnotes);
   }
   const [check]=await query('SELECT COUNT(*) AS remaining FROM hadiths WHERE bookId=? AND (body_en LIKE ? OR text_en LIKE ? OR footnote_en LIKE ?)',[book.id,'%هللا%','%هللا%','%هللا%']);if(check.remaining){const diagnostic=await query('SELECT num,LOCATE(?,body_en) AS body_position,LOCATE(?,text_en) AS search_position,LOCATE(?,footnote_en) AS note_position FROM hadiths WHERE bookId=? AND (body_en LIKE ? OR text_en LIKE ? OR footnote_en LIKE ?)', ['هللا','هللا','هللا',book.id,'%هللا%','%هللا%','%هللا%']);console.log(JSON.stringify({diagnostic}));}assert.equal(check.remaining,0);
  }
  await query(apply?'COMMIT':'ROLLBACK');console.log(JSON.stringify({applied:apply,passages:pending.length,replacements,backup}));
 }catch(error){await query('ROLLBACK').catch(()=>{});throw error;}finally{db.destroy();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
