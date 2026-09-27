#!/usr/bin/env node
'use strict';
// Remove only exact, unchanged heading-only passages from the original import plans.
// Default is a dry run. --apply writes a complete backup before a transaction.
require('dotenv').config();
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),crypto=require('crypto');
const mysql=require('mysql'),{promisify}=require('util');
const {isMishkatHeadingOnly}=require('../../lib/SharhHeadingContent');
const db=mysql.createConnection(require('../initializeHadithAttributions').connectionSettings());
const q=promisify(db.query).bind(db);
const hash=rows=>crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
async function main(){
 const sources=[{name:'mirqat',bookId:-10},{name:'miraat',bookId:-11}],removals=[],backup=[];
 await q('START TRANSACTION');
 try{
  for(const s of sources){
   const [source]=await q('SELECT id FROM hdith_sharh_sources WHERE source_book_id=?',[s.bookId]);assert(source);
   const plan=JSON.parse(fs.readFileSync(path.resolve(`temp/${s.name}/audit/plan.json`)));
   const candidates=plan.headings.filter(h=>isMishkatHeadingOnly(s.name,h));
   const rows=await q('SELECT * FROM hdith_toc_sharh WHERE source_id=? ORDER BY id FOR UPDATE',[source.id]);
   const hadiths=await q('SELECT * FROM hdith_hadith_sharh WHERE source_id=? ORDER BY id',[source.id]);
   for(const h of candidates){
    const matches=rows.filter(r=>r.toc_id===h.tocId&&r.source_entry_id===h.sourceEntryId);assert(matches.length<=1);
    if(!matches.length)continue; // Idempotent after cleanup.
    const r=matches[0];assert.equal(r.text,h.text,`Edited text ${r.id}`);assert(!r.text_en?.trim(),`Translated passage ${r.id}`);
    removals.push(r);
   }
   backup.push({source:s.name,sourceId:source.id,headings:rows,hadithHash:hash(hadiths),hadithCount:hadiths.length});
   console.log(JSON.stringify({source:s.name,candidates:candidates.length,remove:removals.filter(r=>r.source_id===source.id).length,before:rows.length,hadiths:hadiths.length}));
  }
  const ids=removals.map(r=>r.id),result={removed:ids.length,tocIds:[...new Set(removals.map(r=>r.toc_id))],ids};
  if(process.argv.includes('--apply')&&ids.length){
   const dir=path.resolve('temp/sharh-heading-cleanup');fs.mkdirSync(dir,{recursive:true});
   const filename=path.join(dir,`backup-${Date.now()}.json`);fs.writeFileSync(filename,JSON.stringify({backup,removals},null,2));
   const deleted=await q('DELETE FROM hdith_toc_sharh WHERE id IN (?)',[ids]);assert.equal(deleted.affectedRows,ids.length);
   for(const s of backup){
    assert.deepEqual(await q('SELECT * FROM hdith_toc_sharh WHERE source_id=? ORDER BY id',[s.sourceId]),s.headings.filter(r=>!ids.includes(r.id)));
    assert.equal(hash(await q('SELECT * FROM hdith_hadith_sharh WHERE source_id=? ORDER BY id',[s.sourceId])),s.hadithHash);
   }
   await q('UPDATE books SET content_lastmod=NOW() WHERE id=100419');
   await q('COMMIT');fs.writeFileSync(path.join(dir,'applied.json'),JSON.stringify({...result,backup:filename},null,2));
   console.log(`Committed ${ids.length} removals; preserved every remaining heading and hadith commentary.`);
  }else{await q('ROLLBACK');console.log(`Dry run: ${ids.length} removals.`);}
  const sample=await q('SELECT hs.id,hs.source_id,hs.text,t.* FROM hdith_toc_sharh hs JOIN v_toc t ON t.id=hs.toc_id WHERE hs.source_entry_id IN (-10000128,-11001003)');
  console.log(JSON.stringify(sample));
 }catch(e){await q('ROLLBACK');throw e;}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;}).finally(()=>db.end());
