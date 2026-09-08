#!/usr/bin/env node
'use strict';
require('dotenv').config();
const fs=require('fs'),path=require('path'),mysql=require('mysql'),{promisify}=require('util');
const Utils=require('../../lib/Utils');
function numbering(items,headings) {
 if(items.length!==1666 || new Set(items.map(r=>r.id)).size!==items.length || new Set(items.map(r=>String(r.num))).size!==items.length) throw Error('Unexpected passage identities/count');
 const map=new Map(items.map((r,n)=>[String(r.num),n+1]));
 const ranges=headings.map(r=>{
  const start=map.get(String(r.start)),end=map.get(String(r.end));
  if(!start||!end||end<start)throw Error(`Unmapped TOC range ${r.id}`);
  return {id:r.id,start,end};
 });
 return {items:items.map((r,n)=>({id:r.id,num:n+1})),ranges};
}
async function main(){
 const apply=process.argv.includes('--apply');
 const db=mysql.createConnection(require(path.join(require('os').homedir(),'.hadithdb/settings.json')).mysql.connection),query=promisify(db.query).bind(db);
 try{
  const [book]=await query("SELECT id,properties FROM books WHERE alias='ibnhisham' AND type='sirah'");if(!book)throw Error('Sirah book missing');
  if(apply)await query('START TRANSACTION');
  const suffix=apply?' FOR UPDATE':'';
  const items=await query('SELECT * FROM hadiths WHERE bookId=? ORDER BY ordinal,id'+suffix,[book.id]);
  const toc=await query('SELECT * FROM toc WHERE bookId=? ORDER BY ordinal'+suffix,[book.id]);
  const provenance=await query('SELECT source_entry_id,item_id,source_url FROM sirah_source_entries WHERE book_id=?',[book.id]);
  if(provenance.length!==items.length||items.some(r=>!provenance.some(p=>p.item_id===r.id)))throw Error('Source crosswalk is incomplete');
  const plan=numbering(items,toc);
  const changed=items.filter((r,n)=>String(r.num)!==String(n+1)||Number(r.num0)!==n+1).length;
  console.log(JSON.stringify({apply,passages:items.length,headings:toc.length,changed,first:1,last:items.length}));
  if(!apply)return;
  if(changed){
   const dir=path.resolve('var/imports/hdith-b81');fs.mkdirSync(dir,{recursive:true});
   fs.writeFileSync(path.join(dir,`before-item-renumber-${Date.now()}.json`),JSON.stringify({book,items,toc,provenance}));
   await query('CREATE TEMPORARY TABLE sirah_item_numbers (id INT PRIMARY KEY,num INT NOT NULL)');
   await query('INSERT INTO sirah_item_numbers VALUES ?',[plan.items.map(r=>[r.id,r.num])]);
   await query('CREATE TEMPORARY TABLE sirah_heading_ranges (id INT PRIMARY KEY,start_num INT NOT NULL,end_num INT NOT NULL)');
   await query('INSERT INTO sirah_heading_ranges VALUES ?',[plan.ranges.map(r=>[r.id,r.start,r.end])]);
   await query('UPDATE hadiths h JOIN sirah_item_numbers n ON n.id=h.id SET h.num=CAST(n.num AS CHAR),h.num0=n.num WHERE h.bookId=?',[book.id]);
   await query('UPDATE toc t JOIN sirah_heading_ranges n ON n.id=t.id SET t.start=CAST(n.start_num AS CHAR),t.end=CAST(n.end_num AS CHAR),t.start0=n.start_num,t.end0=n.end_num WHERE t.bookId=?',[book.id]);
   const props=typeof book.properties==='string'?JSON.parse(book.properties||'{}'):(book.properties||{});
   props.sirah={...props.sirah,reference:'sequential passage number; source IDs retained in sirah_source_entries'};
   await query('UPDATE books SET properties=?,content_lastmod=NOW() WHERE id=?',[JSON.stringify(props),book.id]);
  }
  await query('COMMIT');
  await Utils.flushCacheContaining('ibnhisham');await Utils.flushCacheContaining('book:ibnhisham');
 }catch(e){if(apply)await query('ROLLBACK').catch(()=>{});throw e;}finally{db.destroy();}
}
module.exports={numbering};
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
