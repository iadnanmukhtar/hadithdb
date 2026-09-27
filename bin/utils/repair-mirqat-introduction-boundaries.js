#!/usr/bin/env node
'use strict';
require('dotenv').config();
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),zlib=require('zlib'),mysql=require('mysql'),{promisify}=require('util');
const importer=require('./import-mirqat-sharh'),{normalize,refresh}=require('./normalize-commentary-honorifics');
const compact=s=>s.replace(/\s/g,'');
const headingKey=h=>`${h.tocId}:${h.sourceEntryId}`;
function changes(before,after,stored,headings,links) {
 assert.equal(before.entries.length,after.entries.length);
 const oldEntries=new Map(before.entries.map(e=>[e.sourceEntryId,e]));
 const rows=new Map(stored.map(r=>[r.source_entry_id,r]));
 const owners=new Map(links.map(r=>[r.sharh_id,r]));
 assert.equal(rows.size,after.entries.length);assert.equal(owners.size,stored.length);
 const oldHeads=new Map(before.headings.map(h=>[headingKey(h),h]));
 const currentHeads=new Map(headings.map(h=>[`${h.toc_id}:${h.source_entry_id}`,h]));
 assert.equal(currentHeads.size,headings.length);
 const moved=after.headings.filter(h=>!oldHeads.has(headingKey(h))),insert=[];
 for(const h of after.headings){
  assert.equal(normalize(h.text),h.text);
  const r=currentHeads.get(headingKey(h));
  if(r)assert.equal(r.text,h.text,`Existing heading edited: ${h.file}`);
  else {assert(!oldHeads.has(headingKey(h)),`Missing existing heading ${h.file}`);insert.push(h);}
 }
 assert(headings.every(r=>after.headings.some(h=>headingKey(h)===`${r.toc_id}:${r.source_entry_id}`)),'Unexpected heading record');
 for(const h of moved)assert(!before.headings.some(b=>compact(b.text).includes(compact(h.text))),`Introduction already exists: ${h.file}`);
 const update=[];
 for(const e of after.entries){
  const b=oldEntries.get(e.sourceEntryId),r=rows.get(e.sourceEntryId);
  assert(r&&b,`Missing hadith commentary: ${e.num}`);
  assert.equal(r.hadith_id,e.hadithId);assert.equal(owners.get(r.id)?.virtual_id,e.virtualId);assert.equal(owners.get(r.id)?.source_number,e.number);
  assert.equal(normalize(e.text),e.text);
  let remainder=compact(b.text);
  for(const h of moved){const needle=compact(h.text);if(remainder.includes(needle)){assert.equal(remainder.split(needle).length,2);remainder=remainder.replace(needle,'');}}
  assert.equal(remainder,compact(e.text),`Non-move text change: ${e.num}`);
  assert(r.text===b.text||r.text===e.text,`Existing hadith commentary edited: ${e.num}`);
  if(r.text!==e.text){assert(!r.text_en,'Translated commentary requires its own boundary review');update.push({row:r,entry:e});}
 }
 // Either a complete previous application or a complete pending move is valid.
 assert.equal(update.length===0,insert.length===0,'Partially applied boundary repair');
 return {update,insert,moved};
}
async function main(){
 const args=process.argv.slice(2);assert(args.every(a=>['--apply','--skip-refresh'].includes(a)),'Use [--apply] [--skip-refresh]');
 const apply=args.includes('--apply'),epub=path.resolve('temp/mirqat/mirqat.epub');
 const source=importer.extract(epub),legacy=importer.extract(epub,{legacyBoundaries:true});
 assert.equal(source.introductionAudit.moves.length,28);
 assert.deepEqual(source.introductionAudit.rejected.map(r=>[r.number,r.file]),[[2555,3660]]); // A quotation of "the Book of Allah", not a heading.
 const c=mysql.createConnection(require('../initializeHadithAttributions').connectionSettings()),q=promisify(c.query).bind(c);
 const directory=path.resolve('var/imports/mirqat-boundaries',String(Date.now()));let manifest;
 const read=async(table,lock=false)=>{const fields=(await q('SHOW COLUMNS FROM '+table)).map(c=>`'${c.Field}',\`${c.Field}\``).join(',');return(await q(`SELECT COMPRESS(JSON_OBJECT(${fields})) payload FROM ${table} WHERE source_id=3221 ORDER BY id${lock?' FOR UPDATE':''}`)).map(r=>JSON.parse(zlib.inflateSync(r.payload.subarray(4))));};
 try{
  if(apply){assert.equal((await q("SELECT GET_LOCK('import-mirqat',30) locked"))[0].locked,1);await q('START TRANSACTION');await q('SELECT id FROM books WHERE id=100419 FOR UPDATE');}
  const virtual=await q('SELECT * FROM hadiths_virtual WHERE bookId=100419 ORDER BY ordinal'+(apply?' FOR UPDATE':''));
  const toc=await q('SELECT * FROM toc WHERE bookId=100419 ORDER BY ordinal'+(apply?' FOR UPDATE':''));
  const stored=await read('hdith_hadith_sharh',apply),headings=await read('hdith_toc_sharh',apply);
  const links=await q('SELECT vl.* FROM hdith_virtual_sharh_links vl JOIN hdith_hadith_sharh hs ON hs.id=vl.sharh_id WHERE hs.source_id=3221 ORDER BY vl.sharh_id'+(apply?' FOR UPDATE':''));
  const before=importer.planImport(legacy,virtual,toc),after=importer.planImport(source,virtual,toc),delta=changes(before,after,stored,headings,links);
  console.log({hadithUpdates:delta.update.length,newIntroductions:delta.insert.length,totalHadiths:stored.length,totalIntroductions:after.headings.length,ownershipLinks:links.length,sourceTextConserved:true,honorificsNormalized:true});
  if(!apply||!delta.update.length){if(apply)await q('ROLLBACK');return;}
  fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'before.json'),JSON.stringify({stored,headings,links,virtual,toc}));
  fs.writeFileSync(path.join(directory,'moves.json'),JSON.stringify(delta.moved,null,2));
  const afterLines=[];
  for(const {row,entry} of delta.update){await q('UPDATE hdith_hadith_sharh SET text=? WHERE id=?',[entry.text,row.id]);afterLines.push({table:'hdith_hadith_sharh',id:row.id,update:{text:entry.text}});}
  const inserted=[];
  for(const h of delta.insert){const r=await q("INSERT INTO hdith_toc_sharh (toc_id,ordinal,source_id,source_entry_id,page_num,title,title_en,text,format,source_url) VALUES (?,1,3221,?,?,?,?,?,'md','')",[h.tocId,h.sourceEntryId,h.page,importer.SOURCE.title,importer.SOURCE.titleEn,h.text]);inserted.push({id:r.insertId,tocId:h.tocId,file:h.file});}
  const saved=await read('hdith_hadith_sharh'),savedHeads=await read('hdith_toc_sharh');
  const verified=changes(before,after,saved,savedHeads,links);assert.equal(verified.update.length,0);assert.equal(verified.insert.length,0);
  const strip=row=>{const {text,lastmod,...meta}=row;return meta;};
  assert.deepEqual(saved.map(strip),stored.map(strip));
  assert.deepEqual(savedHeads.filter(r=>headings.some(h=>h.id===r.id)),headings);
  const linksAfter=await q('SELECT vl.* FROM hdith_virtual_sharh_links vl JOIN hdith_hadith_sharh hs ON hs.id=vl.sharh_id WHERE hs.source_id=3221 ORDER BY vl.sharh_id');assert.deepEqual(linksAfter,links);
  const hadithIds=[...new Set(delta.update.map(e=>e.row.hadith_id))];
  const books=await q('SELECT DISTINCT bookId id FROM hadiths WHERE id IN (?) UNION SELECT DISTINCT bookId id FROM hadiths_virtual WHERE hadithId IN (?) UNION SELECT book_id id FROM sharh_book_mappings WHERE source_id=3221',[hadithIds,hadithIds]);
  manifest={hadithIds,sharhIds:delta.update.map(e=>e.row.id),bookIds:[...new Set([100419,...books.map(b=>b.id)])],tocBookIds:[],inserted,sourceId:3221,ownershipUnchanged:true};
  await q('UPDATE books SET content_lastmod=NOW() WHERE id IN (?)',[manifest.bookIds]);
  fs.writeFileSync(path.join(directory,'after.jsonl'),afterLines.map(r=>JSON.stringify(r)).join('\n')+'\n');fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify(manifest,null,2));
  await q('COMMIT');console.log('Committed. Backup:',directory);
 }catch(e){if(apply)await q('ROLLBACK');throw e;}finally{c.destroy();}
 if(manifest&&!args.includes('--skip-refresh'))await refresh(manifest,directory);
}
module.exports={changes};
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});
