#!/usr/bin/env node
'use strict';
// Run prepare-yqsirah.py first. Dry run by default; --apply imports a new identity only.
require('dotenv').config();
const fs=require('fs'), path=require('path'), crypto=require('crypto'), assert=require('assert/strict');
const mysql=require('mysql'), {promisify}=require('util');
const ALIAS='yqsirah', SOURCE='yqsirah.pdf';
const CACHE=path.resolve('var/imports/yqsirah');
const SHA='e9efc5e4b78d184c7d74c5d25733f2692ee029939c927e86d9be2f296106bce4';
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const {repairEntry}=require('./yqsirah-arabic-repairs');
const bookMetadata=require('../../data/yqsirah-metadata.json');
const canonical=title=>title.replace(/^\(Cont\.\)\s*/i,'').replace(/\s+/g,' ').trim();
function build(source,topics) {
 assert.equal(source.source_sha256,SHA,'Unexpected source PDF');
 assert.equal(Object.keys(source.videos).length,101);
 assert.equal(source.notes.length,1866);
 assert.equal(source.unmatched_headings.length,0);
 assert(source.notes.every(note=>note.uses && note.text));
 const literalNumbers=[[216,19],[216,20],[216,21],[216,22],[490,8],[511,8],[512,5],[601,59],[695,4],[750,48],[1072,43]];
 assert.deepEqual(source.unmatched_references.map(r=>[r.page,r.number]),literalNumbers,'Unreviewed numeric reference');
 const starts=topics.map(([page,title,heading])=>{
  const index=source.blocks.findIndex(b=>b.page===page && (!heading || b.heading===heading || b.text===heading));
  assert(index>=0,`Missing topic boundary: ${title}`);return {index,title,page};
 });
 assert(starts.every((s,i)=>!i || s.index>starts[i-1].index));
 const chapters=[], entries=[], merges=[];let ci=-1,section=null;
 for(let bi=0;bi<source.blocks.length;bi++) {
  const block=source.blocks[bi];
  if(starts[ci+1]?.index===bi) {
   ci++;chapters.push({title:starts[ci].title,sections:[],start:entries.length+1});section=null;
  }
  assert(ci>=0);
  let heading=block.heading || block.synthetic_heading;
  // A lecture's introductory paragraph belongs with its upcoming topic, not the
  // last unrelated topic of the previous lecture. No video labels enter the TOC.
  if(!heading && bi>0 && block.video!==source.blocks[bi-1].video && section) {
   const next=source.blocks.slice(bi+1).find(b=>b.video===block.video && b.heading);
   if(next)heading=next.heading;
  }
  if(heading) {
   const title=canonical(block.heading ? block.text.replace(/\[\^[^\]]+\]/g,'') : heading);
   if(section && canonical(section.title)===title)merges.push({title,page:block.page,video:block.video});
   else {section={title,blocks:[],h1:ci+1,h2:chapters[ci].sections.length+1};chapters[ci].sections.push(section);entries.push(section);}
  } else if(!section) {
   section={title:chapters[ci].title,blocks:[],h1:ci+1,h2:1};chapters[ci].sections.push(section);entries.push(section);
  }
  section.blocks.push({...block,index:bi});
 }
 const notes=new Map(source.notes.map(n=>[n.key,n]));const imported=new Set();
 entries.forEach((entry,index)=>{
  entry.num=index+1;
  entry.body=entry.blocks.filter(b=>!b.heading || /\[\^/.test(b.text)).map(b=>b.text).join('\n\n');
  // A heading with no prose before the next heading still needs a stable section.
  if(!entry.body)entry.body=entry.title;
  const keys=[...new Set([...entry.body.matchAll(/\[\^([^\]]+)\]/g)].map(m=>m[1]))];
  entry.footnotes=keys.map(key=>{assert(notes.has(key),`Missing ${key}`);imported.add(key);return `[^${key}]: ${notes.get(key).text}`;}).join('\n\n');
  entry.provenance={source_sha256:SHA,blocks:entry.blocks.map(b=>b.index),pages:[...new Set(entry.blocks.map(b=>b.page))],videos:[...new Set(entry.blocks.map(b=>b.video))],source_headings:entry.blocks.filter(b=>b.heading).map(b=>b.heading),notes:keys};
  entry.sha256=hash(JSON.stringify([entry.title,entry.body,entry.footnotes,entry.h1,entry.h2]));
  Object.assign(entry,repairEntry(entry));
 });
 assert.equal(imported.size,notes.size,'Lost footnotes');
 assert.equal(new Set(entries.flatMap(e=>e.provenance.videos)).size,101);
 assert.deepEqual(entries.flatMap(e=>e.provenance.blocks),source.blocks.map((_,i)=>i),'Source order or coverage changed');
 chapters.forEach(c=>{c.start=c.sections[0].num;c.end=c.sections.at(-1).num;});
 return {source_sha256:SHA,chapters,entries,merges};
}
async function apply(plan) {
 const db=mysql.createConnection(require(path.join(require('os').homedir(),'.hadithdb/settings.json')).mysql.connection);
 const query=promisify(db.query).bind(db);
 try {
  await query(`CREATE TABLE IF NOT EXISTS yqsirah_source_entries (book_id INT NOT NULL, passage_number INT NOT NULL, item_id INT NOT NULL, content_sha256 CHAR(64) NOT NULL, source_json JSON NOT NULL, PRIMARY KEY(book_id,passage_number), UNIQUE KEY yqsirah_item(item_id)) CHARACTER SET utf8mb4`);
  await query('START TRANSACTION');
  const existing=await query('SELECT * FROM books WHERE alias=? FOR UPDATE',[ALIAS]);
  if(existing.length) {
   const book=existing[0];assert.equal(book.type,'sirah');assert.equal(book.lang,'en');assert.equal(book.source,SOURCE);
   const rows=await query('SELECT h.*, s.content_sha256 FROM hadiths h JOIN yqsirah_source_entries s ON s.item_id=h.id AND s.book_id=h.bookId WHERE h.bookId=? ORDER BY h.ordinal',[book.id]);
   assert.equal(rows.length,plan.entries.length,'Incomplete existing import');
   rows.forEach((row,i)=>{const e=plan.entries[i];assert.equal(row.content_sha256,e.sha256,'Changed import plan');assert.equal(hash(JSON.stringify([row.title_en,row.body_en,row.footnote_en,Number(row.h1),Number(row.h2)])),e.sha256,'Existing user edits: refusing replacement');});
   const toc=await query('SELECT * FROM toc WHERE bookId=? ORDER BY ordinal',[book.id]);
   assert.equal(toc.length,plan.chapters.length+plan.entries.length);
   for(const row of toc){const expected=Number(row.level)===1?plan.chapters[Number(row.h1)-1]:plan.entries.find(e=>e.h1===Number(row.h1)&&e.h2===Number(row.h2));assert.equal(row.title_en,expected.title,'Existing heading edits');}
   await query('COMMIT');return {bookId:book.id,unchanged:true,passages:rows.length};
  }
  const bookId=Number((await query('SELECT MAX(id) AS id FROM books FOR UPDATE'))[0].id)+1;
  // New-identity import: an empty before-state plus a full immutable plan is the rollback record.
  fs.writeFileSync(path.join(CACHE,`before-${Date.now()}.json`),JSON.stringify({alias:ALIAS,bookId,existing,planHash:hash(JSON.stringify(plan))},null,2));
  const properties={reader:{referenceView:'item'},sirah:{source_file:SOURCE,source_sha256:SHA,source_pages:1181,transcript_pages:[44,1165],toc_pages:[3,43],videos:101,reference:'Sequential topical passages; source video and PDF pages retained in yqsirah_source_entries'}};
  await query('INSERT INTO books SET ?', {id:bookId,ordinal:bookId,alias:ALIAS,type:'sirah',lang:'en',shortName_en:'Yasir Qadhi’s Sirah',shortName:'',name_en:'The Sirah of Prophet Muhammad',title_en:'The Sirah of Prophet Muhammad — Yasir Qadhi',author_en:bookMetadata.author_en,source:SOURCE,hidden:0,format:'md',description:bookMetadata.description,properties:JSON.stringify(properties)});
  let ordinal=0;
  for(const chapter of plan.chapters) {
   const h1=chapter.sections[0].h1;
   await query('INSERT INTO toc SET ?', {ordinal:++ordinal,bookId,level:1,h1,title_en:chapter.title,start:String(chapter.start),end:String(chapter.end),start0:chapter.start,end0:chapter.end,count:chapter.sections.length});
   for(const entry of chapter.sections) {
    const toc=await query('INSERT INTO toc SET ?', {ordinal:++ordinal,bookId,level:2,h1,h2:entry.h2,title_en:entry.title,start:String(entry.num),end:String(entry.num),start0:entry.num,end0:entry.num,count:1});
    const inserted=await query('INSERT INTO hadiths SET ?', {ordinal:entry.num,bookId,tocId:toc.insertId,h1,h2:entry.h2,num:String(entry.num),num0:entry.num,numInChapter:entry.h2,title_en:entry.title,body_en:entry.body,text_en:entry.body,footnote_en:entry.footnotes,available_translation_languages:JSON.stringify(['en'])});
    await query('INSERT INTO yqsirah_source_entries SET ?', {book_id:bookId,passage_number:entry.num,item_id:inserted.insertId,content_sha256:entry.sha256,source_json:JSON.stringify(entry.provenance)});
   }
  }
  const rows=await query('SELECT title_en,body_en,footnote_en,h1,h2,body,text FROM hadiths WHERE bookId=? ORDER BY ordinal',[bookId]);
  assert.equal(rows.length,plan.entries.length);
  rows.forEach((row,i)=>{assert(!row.body&&!row.text);assert.equal(hash(JSON.stringify([row.title_en,row.body_en,row.footnote_en,Number(row.h1),Number(row.h2)])),plan.entries[i].sha256);});
  await query('COMMIT');return {bookId,passages:rows.length,chapters:plan.chapters.length,headings:ordinal};
 }catch(error){await query('ROLLBACK');throw error;}finally{db.end();}
}
async function main(){
 const source=JSON.parse(fs.readFileSync(path.join(CACHE,'extracted.json')));
 const plan=build(source,require('../../data/yqsirah-topics.json'));
 fs.writeFileSync(path.join(CACHE,'plan.json'),JSON.stringify(plan,null,2));
 fs.writeFileSync(path.join(CACHE,'contents.md'),plan.chapters.map((c,i)=>`## ${i+1}. ${c.title}\n\n`+c.sections.map(e=>`- ${e.title} — passage ${e.num}; videos ${e.provenance.videos.join(', ')}; PDF pages ${e.provenance.pages[0]}–${e.provenance.pages.at(-1)}`).join('\n')).join('\n\n')+'\n');
 console.log(JSON.stringify({chapters:plan.chapters.length,passages:plan.entries.length,footnotes:source.notes.length,mergedContinuations:plan.merges,crossVideoPassages:plan.entries.filter(e=>e.provenance.videos.length>1).map(e=>({number:e.num,title:e.title,videos:e.provenance.videos}))},null,2));
 if(process.argv.includes('--apply'))console.log(await apply(plan));
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={build,canonical};
