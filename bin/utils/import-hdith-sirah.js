#!/usr/bin/env node
'use strict';
// Source-faithful b-81 passage import. Dry-run by default; cached source permits resumption.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const mysql = require('mysql');
const { promisify } = require('util');
const { normalizeField } = require('./normalize-hadith-honorifics');
const SOURCE = 'https://hdith.com/encyclopedia/book/b-81';
const ALIAS = 'ibnhisham';
const CACHE = path.resolve('var/imports/hdith-b81');
function props(html) {
 const $ = cheerio.load(html);
 const page = JSON.parse($('script[data-page="app"]').text());
 if (!page.props) throw new Error('Missing source props');
 return page.props;
}
async function fetchPage(key, url) {
 const file = path.join(CACHE, `${key}.json`);
 if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
 for (let attempt=1; ; attempt++) {
  try {
   const page = props((await axios.get(url, { timeout: 45000 })).data);
   fs.writeFileSync(file + '.tmp', JSON.stringify(page)); fs.renameSync(file + '.tmp', file);
   return page;
  } catch(error) { if(attempt===4) throw error; await new Promise(r=>setTimeout(r,attempt*1000)); }
 }
}
async function mapLimit(rows, fn) {
 let cursor=0;
 await Promise.all(Array.from({length:6},async()=>{while(cursor<rows.length){const index=cursor++;await fn(rows[index],index);}}));
}
function passage(source, expectedId) {
 if (Number(source?.id)!==Number(expectedId) || source.book?.slug!=='b-81' || source.entry_kind!=='passage') throw new Error(`Wrong source identity ${expectedId}`);
 if (!source.matn?.trim()) throw new Error(`Empty passage ${expectedId}`);
 return { id: Number(source.id), text: source.matn, title: source.chapter_text || '', raw: source };
}
function fullTitle(listed, full) {
 if (!listed?.includes('…')) return listed;
 full=full ? cheerio.load(`<div>${full}</div>`)('div').text() : '';
 const comparable=text=>text.replace(/["'«»]/g,'').replace(/\s+/g,' ').trim();
 if (!full || full.includes('…') || !comparable(full).startsWith(comparable(listed.split('…')[0]))) throw new Error(`Cannot recover heading: ${listed}`);
 return full;
}
function restoreTitles(chapters) {
 for(const chapter of chapters) {
  const raw=chapter.entries[0].passage.raw;
  const occurrence=raw.takhrij?.sources?.find(source=>source.book_id===81)?.occurrences?.find(item=>item.entry_id===raw.id);
  chapter.title=fullTitle(chapter.title,occurrence?.section);
  for(const group of chapter.groups || []) {
   const first=chapter.entries.find(entry=>entry.id===group.hadiths?.[0]?.id);
   group.title=fullTitle(group.title,first?.passage.raw.chapter_text);
  }
 }
 return chapters;
}
async function scrape() {
 fs.mkdirSync(CACHE,{recursive:true});
 const book = await fetchPage('book',SOURCE);
 if(book.book.slug!=='b-81') throw new Error('Wrong book');
 const chapters=new Array(book.chapters.length);
 await mapLimit(book.chapters,async(chapter,index)=>{
  const page=await fetchPage(`chapter-${chapter.id}`,`${SOURCE}?chapter=${chapter.id}`);
  if(Number(page.active_chapter?.id)!==Number(chapter.id))throw new Error('Wrong chapter');
  const entries=page.hadith_groups?.length ? page.hadith_groups.flatMap(group=>group.hadiths || []) : (page.hadiths || []);
  if(entries.length!==chapter.count)throw new Error(`Incomplete chapter ${chapter.id}: ${entries.length}/${chapter.count}; pagination required`);
  chapters[index]={id:chapter.id,title:page.active_chapter.title,groups:page.hadith_groups,entries};
 });
 const entries=chapters.flatMap(c=>c.entries);
 if(entries.length!==book.stats.hadiths || new Set(entries.map(e=>e.id)).size!==entries.length)throw new Error('Source count/identity mismatch');
 let completed=0;
 await mapLimit(entries,async entry=>{
  entry.passage=passage((await fetchPage(`entry-${entry.id}`,`${SOURCE}/h/${entry.id}`)).hadith,entry.id);
  if(++completed%100===0)console.log(`Fetched ${completed}/${entries.length} passages`);
 });
 for(let i=0;i<entries.length;i++) {
  if(entries[i].passage.raw.next_id !== (entries[i+1]?.id ?? null))throw new Error(`Broken source sequence after ${entries[i].id}`);
 }
 restoreTitles(chapters);
 const result={book:book.book,stats:book.stats,chapters};
 fs.writeFileSync(path.join(CACHE,'complete.json'),JSON.stringify(result));
 return result;
}
async function apply(source) {
 const settings=require(path.join(require('os').homedir(),'.hadithdb/settings.json'));
 const db=mysql.createConnection(settings.mysql.connection);const query=promisify(db.query).bind(db);
 try {
  await query(`CREATE TABLE IF NOT EXISTS sirah_source_entries (book_id INT NOT NULL, source_entry_id INT NOT NULL, item_id INT NOT NULL, source_url VARCHAR(255) NOT NULL, source_json JSON NOT NULL, PRIMARY KEY(book_id,source_entry_id), UNIQUE KEY sirah_item(item_id)) CHARACTER SET utf8mb4`);
  await query('START TRANSACTION');
  const existing=await query('SELECT id,type,source FROM books WHERE alias=? FOR UPDATE',[ALIAS]);
  if(existing.length) {
   if(existing[0].type!=='sirah'||existing[0].source!==SOURCE)throw new Error('Existing alias has a different identity');
   const count=(await query('SELECT COUNT(*) AS n FROM sirah_source_entries WHERE book_id=?',[existing[0].id]))[0].n;
   if(Number(count)!==source.stats.hadiths)throw new Error('Existing import is incomplete; refusing replacement');
   await query('COMMIT'); console.log(`Already imported ${count} passages; book id ${existing[0].id}`);return;
  }
  const id=Number((await query('SELECT MAX(id) AS id FROM books FOR UPDATE'))[0].id)+1;
  await query(`INSERT INTO books (id,ordinal,alias,type,shortName_en,name_en,title_en,shortName,name,title,author_en,author,death,description,source,lang,hidden,format,hdith_book_id,properties,content_lastmod) VALUES (?,?,?,'sirah',?,?,?,?,?,?,?,?,?,?,?,'ar',0,'md',81,?,NOW())`,
   [id,id,ALIAS,'Sirat Ibn Hisham','Sirat Ibn Hisham','Sirat Ibn Hisham','سيرة ابن هشام',source.book.title,source.book.title,'Ibn Hisham',source.book.author,source.book.author_death,normalizeField(source.book.summary),SOURCE,JSON.stringify({sirah:{source_book:'b-81',card_info:source.book.card_info,stats:source.stats,reference:'sequential passage number; source IDs retained in sirah_source_entries'}})]);
  const passageNumbers=new Map(source.chapters.flatMap(chapter=>chapter.entries).map((entry,index)=>[entry.id,index+1]));
  let ordinal=0,tocOrdinal=0;
  for(let ci=0;ci<source.chapters.length;ci++) {
   const chapter=source.chapters[ci]; const rows=chapter.entries;
   const addToc=async(level,h2,h3,title,items)=> (await query('INSERT INTO toc (ordinal,bookId,level,h1,h2,h3,title,start,end,start0,end0,count) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',[++tocOrdinal,id,level,ci+1,h2,h3,normalizeField(title),String(passageNumbers.get(items[0].id)),String(passageNumbers.get(items.at(-1).id)),passageNumbers.get(items[0].id),passageNumbers.get(items.at(-1).id),items.length])).insertId;
   const root=await addToc(1,null,null,chapter.title,rows);
   const map=new Map(rows.map(e=>[e.id,{toc:root,h2:null,h3:null}]));
   let h2=0,h3=0;
   const groups=chapter.groups || [];
   for(let gi=0;gi<groups.length;gi++) {
    const group=groups[gi];
    if(Number(group.depth)===0)continue; // The active chapter is already the root.
    const level=Number(group.depth)+1;
    if(![2,3].includes(level))throw new Error(`Unsupported heading depth ${group.depth}`);
    const descendants=[...(group.hadiths||[])];
    for(let j=gi+1;j<groups.length && groups[j].depth>group.depth;j++)descendants.push(...groups[j].hadiths);
    if(!descendants.length)throw new Error(`Empty heading ${group.id}`);
    if(level===2){h2++;h3=0;}else{h3++;if(!h2)throw new Error('Heading without parent');}
    const toc=await addToc(level,h2,level===3?h3:null,group.title,descendants);
    for(const item of descendants)map.set(item.id,{toc,h2,h3:level===3?h3:null});
   }
   for(let ri=0;ri<rows.length;ri++) {
    const entry=rows[ri],p=entry.passage,pos=map.get(entry.id);
    const notes=(p.raw.footnotes||[]).map(note=>typeof note==='string'?note:(note.text||note.content||JSON.stringify(note))).join('\n\n');
    const inserted=await query('INSERT INTO hadiths (ordinal,bookId,tocId,h1,h2,h3,num,num0,numInChapter,title,body,text,footnote) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',[++ordinal,id,pos.toc,ci+1,pos.h2,pos.h3,String(passageNumbers.get(p.id)),passageNumbers.get(p.id),ri+1,normalizeField(p.title),normalizeField(p.text),normalizeField(p.text),normalizeField(notes)||null]);
    await query('INSERT INTO sirah_source_entries (book_id,source_entry_id,item_id,source_url,source_json) VALUES (?,?,?,?,?)',[id,p.id,inserted.insertId,`${SOURCE}/h/${p.id}`,JSON.stringify(p.raw)]);
   }
  }
  if(ordinal!==source.stats.hadiths)throw new Error('Imported count mismatch');
  await query('COMMIT');console.log(`Imported ${ordinal} Sirah passages and ${tocOrdinal} headings; book id ${id}, alias ${ALIAS}`);
 }catch(error){await query('ROLLBACK');throw error;}finally{db.end();}
}
if(require.main===module)(async()=>{const source=await scrape();console.log(`${source.stats.hadiths} passages, ${source.chapters.length} chapters verified`);if(process.argv.includes('--apply'))await apply(source);})().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={props,passage,fullTitle,restoreTitles};
