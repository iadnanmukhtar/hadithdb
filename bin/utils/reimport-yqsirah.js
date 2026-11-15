#!/usr/bin/env node
'use strict';
// Restore the reviewed PDF import without replacing passage identities or metadata.
// Default: read-only comparison. --apply requires the exact dry-run state hash.
require('dotenv').config();
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert/strict');
const mysql=require('mysql'),{promisify}=require('util');
const {build}=require('./import-yqsirah');
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const hash=value=>digest(value || '');
const cache=path.resolve('var/imports/yqsirah');
const desiredFields=entry=>({title_en:entry.title,body_en:entry.body,text_en:entry.body,footnote_en:entry.footnotes});
function compare(plan,rows,toc){
 assert.equal(rows.length,plan.entries.length,'Passage count changed');
 assert.equal(toc.length,plan.chapters.length+plan.entries.length,'Heading count changed');
 const headings=new Map(toc.map(row=>[Number(row.id),row]));
 const changes=[];
 for(let i=0;i<rows.length;i++){
  const row=rows[i],entry=plan.entries[i];
  assert.equal(String(row.num),String(entry.num),'Passage order changed');
  assert.equal(Number(row.ordinal),entry.num,'Passage ordinal changed');
  for(const key of ['h1','h2','h3'])assert.equal(Number(row[key])||null,Number(entry[key])||null,`Passage ${entry.num}: ${key} changed`);
  const heading=headings.get(Number(row.tocId));assert(heading,`Missing heading for ${entry.num}`);
  for(const [key,value] of Object.entries({level:entry.level,h1:entry.h1,h2:entry.h2,h3:entry.h3,start0:entry.start,end0:entry.end,count:entry.count}))
   assert.equal(Number(heading[key])||null,Number(value)||null,`Heading ${entry.num}: ${key} changed`);
  assert.equal(heading.title_en,entry.title,`Heading title changed for ${entry.num}`);
  const fields=desiredFields(entry);
  const changed=Object.keys(fields).filter(key=>row[`${key}_hash`]!==hash(fields[key]));
  if(changed.length || row.content_sha256!==entry.sha256)changes.push({num:entry.num,id:row.id,fields:changed,entry});
 }
 for(let i=0;i<plan.chapters.length;i++){
  const chapter=plan.chapters[i],heading=toc.find(h=>Number(h.level)===1&&Number(h.h1)===i+1);assert(heading);
  assert.equal(heading.title_en,chapter.title);assert.equal(Number(heading.start0),chapter.start);assert.equal(Number(heading.end0),chapter.end);
 }
 return {changes,state:digest(JSON.stringify({rows,toc})),summary:{passages:rows.length,chapters:plan.chapters.length,h2:plan.entries.filter(e=>e.level===2).length,h3:plan.entries.filter(e=>e.level===3).length,changedPassages:changes.length,bodyChanges:changes.filter(e=>e.fields.includes('body_en')).length,searchTextChanges:changes.filter(e=>e.fields.includes('text_en')).length,footnoteChanges:changes.filter(e=>e.fields.includes('footnote_en')).length,titleChanges:changes.filter(e=>e.fields.includes('title_en')).length}};
}
const rowSql=`SELECT h.id,h.num,h.ordinal,h.tocId,h.h1,h.h2,h.h3,
 SHA2(COALESCE(h.title_en,''),256) AS title_en_hash,
 SHA2(COALESCE(h.body_en,''),256) AS body_en_hash,
 SHA2(COALESCE(h.text_en,''),256) AS text_en_hash,
 SHA2(COALESCE(h.footnote_en,''),256) AS footnote_en_hash,
 s.content_sha256 FROM hadiths h JOIN yqsirah_source_entries s ON s.item_id=h.id AND s.book_id=h.bookId WHERE h.bookId=? ORDER BY h.ordinal`;
const tocSql='SELECT id,level,h1,h2,h3,start0,end0,count,title_en FROM toc WHERE bookId=? ORDER BY ordinal';
async function main(){
 const source=JSON.parse(fs.readFileSync(path.join(cache,'extracted.json')));
 assert.equal(digest(fs.readFileSync('temp/yqsirah.pdf')),source.source_sha256,'The PDF differs from the extracted source');
 const plan=build(source,require('../../data/yqsirah-topics.json'));
 const apply=process.argv.includes('--apply');
 const expected=process.argv.find(arg=>arg.startsWith('--expected-state='))?.split('=')[1];
 if(apply)assert(/^[a-f0-9]{64}$/.test(expected || ''),'--apply requires --expected-state from a reviewed dry run');
 const db=mysql.createConnection(require(path.join(require('os').homedir(),'.hadithdb/settings.json')).mysql.connection),query=promisify(db.query).bind(db);
 let backups;
 try{
  const [book]=await query('SELECT id,type,lang FROM books WHERE alias=?',['yqsirah']);assert(book);assert.equal(book.type,'sirah');assert.equal(book.lang,'en');
  const before=compare(plan,await query(rowSql,[book.id]),await query(tocSql,[book.id]));
  if(apply&&before.changes.length){
   assert.equal(before.state,expected,'Database changed after the dry run; compare again');
   const suffix=new Date().toISOString().replace(/[^0-9]/g,'');
   backups={hadiths:`yqsirah_restore_h_${suffix}`,sources:`yqsirah_restore_s_${suffix}`};
   // Empty backup tables are created before the transaction (MySQL DDL commits).
   // Snapshot rows and restoration commit together; full text stays on its host.
   await query(`CREATE TABLE ${backups.hadiths} LIKE hadiths`);
   await query(`CREATE TABLE ${backups.sources} LIKE yqsirah_source_entries`);
   await query('START TRANSACTION');
   const locked=compare(plan,await query(rowSql+' FOR UPDATE',[book.id]),await query(tocSql+' FOR UPDATE',[book.id]));
   assert.equal(locked.state,expected,'Database changed before locking; nothing restored');
   await query(`INSERT INTO ${backups.hadiths} SELECT * FROM hadiths WHERE bookId=?`,[book.id]);
   await query(`INSERT INTO ${backups.sources} SELECT * FROM yqsirah_source_entries WHERE book_id=?`,[book.id]);
   const [saved]=await query(`SELECT (SELECT COUNT(*) FROM ${backups.hadiths}) AS passages,(SELECT COUNT(*) FROM ${backups.sources}) AS sources`);
   assert.equal(Number(saved.passages),plan.entries.length);assert.equal(Number(saved.sources),plan.entries.length);
   for(const change of locked.changes){
    await query('UPDATE hadiths SET ? WHERE id=? AND bookId=?',[desiredFields(change.entry),change.id,book.id]);
    await query('UPDATE yqsirah_source_entries SET content_sha256=? WHERE item_id=? AND book_id=?',[change.entry.sha256,change.id,book.id]);
   }
   const after=compare(plan,await query(rowSql,[book.id]),await query(tocSql,[book.id]));assert.equal(after.changes.length,0,'Restored content failed readback');
   await query('COMMIT');
  }
  const report={applied:apply,...before.summary,state:before.state,backups,source_sha256:plan.source_sha256,changes:before.changes.map(({entry,...change})=>change)};
  fs.mkdirSync(path.join(cache,'reimport'),{recursive:true});
  fs.writeFileSync(path.join(cache,'reimport',`${apply?'restored':'dry-run'}-${Date.now()}.json`),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({...report,changes:undefined},null,2));
 }catch(error){await query('ROLLBACK').catch(()=>{});throw error;}finally{db.destroy();}
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={compare,desiredFields};
