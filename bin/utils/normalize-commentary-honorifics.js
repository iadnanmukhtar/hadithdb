#!/usr/bin/env node
'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {promisify} = require('util');
const Utils = require('../../lib/Utils');

// Preserve layout and all non-honorific text, including Markdown indentation.
function normalizeBare(value) {
 return Utils.normalizeArabicHonorifics(value
  .replace(/عليه الصلاة والسلام/g, ' ﷺ ')
  .replace(/\b(?:PBUH)\b/g, ' ﷺ ')
  .replace(/(?:may\s+)?(?:Allah\\?['’]s\s+)?peace(?:\s+and\s+blessings)?\s+be\s+upon\s+him/gi, ' ﷺ ')
  .replace(/upon whom be Allah\\?['’]s peace and blessings/gi, ' ﷺ ')
  .replace(/(?:may )?Allah bless him(?: and his (?:Household|family))? and (?:give (?:him )?peace|grant him peace)/gi, ' ﷺ ')
  .replace(/Allah\\?['’]s\s+ﷺ/gi, ' ﷺ '));
}
function normalizePass(value) {
 if (typeof value !== 'string') return value;
 // Normalize complete parenthetical formulas before matching their inner words;
 // this also preserves Markdown-escaped parentheses without dangling escapes.
 const quotations=[];
 const protect=text=>`\uE000${quotations.push(text)-1}\uE001`;
 const marked=word=>[...word].map(c=>c===' '?'\\s+':`${c}${mark}`).join('');
 const verse=new RegExp(marked('رضي الله عنهم ورضوا عنه').replace('ي'+mark,'[ىي]'+mark).replace('ا'+mark,'[اٱ]'+mark),'gu');
 const protectedValue=value.replace(/https?:\/\/[^\s<>"()]+/gu,protect).replace(/﴿[^﴿﴾]*﴾/gu,protect).replace(verse,protect);
 const unwrapped=protectedValue.replace(/\\?\(\s*([^()]*?)\s*\\?\)/g,(whole,inner)=>{
  const result=normalizeBare(inner).trim();
  return /^[ﷺؓ]$/u.test(result) ? ` ${result} ` : whole;
 }).replace(/\\?\[\s*(?:PBUH|SAW)\s*\\?\]/gi,' ﷺ ');
 let replaced = normalizeBare(unwrapped);
 while(true){const next=replaced.replace(/\\?\(\s*([ﷺؓ])\s*\\?\)|\\?\[\s*([ﷺؓ])\s*\\?\]/gu,(_,a,b)=>` ${a||b} `);if(next===replaced)break;replaced=next;}
 if(replaced===protectedValue)return value;
 return replaced
  .replace(/[ \t]*([ﷺؓ])[ \t]*/gu, ' $1 ')
  .replace(/([ﷺؓ]) +([,.;:!?،؛؟])/gu, '$1$2')
  .replace(/^ ([ﷺؓ])/u, '$1').replace(/([ﷺؓ]) $/u, '$1')
  .replace(/\uE000(\d+)\uE001/g,(_,i)=>quotations[Number(i)]);
}
function normalize(value) {
 let result=value;
 for(let pass=0;pass<10;pass++){
  const next=normalizePass(result);
  if(next===result)return result;
  result=next;
 }
 throw Error('Honorific normalization did not converge');
}
// A conservative superset of every match in normalize()/Utils. Filtering on the
// server avoids transferring hundreds of MB of already-normalized commentary.
const mark='[ؐ-ؚـً-ٰٟۖ-ۭ]*';
const candidatePattern=String.raw`peace(?:\s+and\s+blessings)?\s+be\s+upon\s+him|may\s+(?:Allah|God)(?:\s+the\s+Most\s+High)?\s+be\s+pleased|Allah bless him|upon whom be Allah|PBUH|[\[(]\s*SAW|Allah.{1,2}s\s+ﷺ|عليه الصلاة والسلام|(?:ص${mark}ل${mark}[ىي]|ر${mark}ض${mark}[ىي])${mark}\s+[اٱ]?${mark}ل${mark}ل${mark}ه|[\[(]\s*[ﷺؓ]|-\s*[ﷺؓ]\s*-`;
async function main() {
 const args = process.argv.slice(2);
 const allowedTables=['hdith_hadith_sharh','hdith_toc_sharh','hadiths_commentary','toc'];
 const selected=args.find(a=>a.startsWith('--table='))?.slice(8);
 if (args.some(a => a !== '--apply' && a !== `--table=${selected}`) || (selected && !allowedTables.includes(selected))) throw Error('Usage: normalize-commentary-honorifics.js [--apply] [--table=<table>]');
 const apply = args.includes('--apply');
 const c = require('mysql').createConnection(require(require('os').homedir()+'/.hadithdb/settings.json').mysql.connection);
 const q = promisify(c.query).bind(c);
 const manifest = {started: new Date().toISOString(), tables: {}, hadithIds: [], sharhIds: [], bookIds: []};
 const hadithIds = new Set(), bookIds = new Set(), sourceIds = new Set();
 const directory = path.resolve('var/imports/commentary-honorifics', String(Date.now()));
 if (apply) {fs.mkdirSync(directory, {recursive:true});fs.writeFileSync(path.join(directory,'after.jsonl'),'');}
 try {
  if (apply) await q('START TRANSACTION');
  for (const table of selected ? [selected] : allowedTables) {
   const columns = await q(`SHOW COLUMNS FROM ${table}`);
   const fields = columns.map(r=>r.Field).filter(f=> /^(text|footnotes|intro)(_[a-z]+)?$/.test(f));
   if(apply) await q(`CREATE TEMPORARY TABLE honorific_stage (PRIMARY KEY (id)) AS SELECT id,${fields.join(',')} FROM ${table} WHERE 1=0`);
   const scope=['hadiths_commentary','toc'].includes(table) ? "AND EXISTS (SELECT 1 FROM books b WHERE b.id=s.bookId AND b.type='tafsir')" : '';
   const [total]=await q(`SELECT COUNT(*) n FROM ${table} s WHERE 1=1 ${scope}`);
   const report = manifest.tables[table] = {total:total.n,scanned:0, changed:0, fields:{}, samples:[]};
   let after = 0;
   while (true) {
    // Keep the primary-key scan ordered; a semijoin here otherwise sorts the whole corpus per batch.
    const packed = await q(`SELECT STRAIGHT_JOIN COMPRESS(JSON_OBJECT(${columns.map(c=>`'${c.Field}',s.\`${c.Field}\``).join(',')})) AS payload FROM ${table} s WHERE s.id>? ${scope} AND REGEXP_LIKE(CONCAT_WS(' ',${fields.map(f=>`s.${f}`).join(',')}),?, 'i') ORDER BY s.id LIMIT 500${apply?' FOR UPDATE':''}`, [after,candidatePattern]);
    const rows=packed.map(r=>JSON.parse(require('zlib').inflateSync(r.payload.subarray(4)).toString('utf8')));
    if (!rows.length) break;
    after=rows.at(-1).id;
    const staged=[];
    for (const row of rows) {
     report.scanned++;
     const update = Object.fromEntries(fields.map(f=>[f,normalize(row[f])]).filter(([f,v])=>v!==row[f]));
     if (!Object.keys(update).length) continue;
     for (const [f,v] of Object.entries(update)) {
      if (normalize(v)!==v) throw Error(`Non-idempotent normalization: ${table}:${row.id}:${f}`);
      report.fields[f]=(report.fields[f]||0)+1;
      if(report.samples.length<4) {let i=0;while(i<v.length&&v[i]===row[f][i])i++;report.samples.push({id:row.id,field:f,before:row[f].slice(Math.max(0,i-50),i+150),after:v.slice(Math.max(0,i-50),i+150)});}
     }
     report.changed++;
     if(row.hadith_id)hadithIds.add(row.hadith_id);
     if(row.bookId)bookIds.add(row.bookId);
     if(row.source_id)sourceIds.add(row.source_id);
     if(table==='hdith_hadith_sharh')manifest.sharhIds.push(row.id);
     if(row.toc_id){const [toc]=await q('SELECT bookId FROM toc WHERE id=?',[row.toc_id]);bookIds.add(toc.bookId);}
     if(apply){fs.appendFileSync(path.join(directory,'before.jsonl'),JSON.stringify({table,row})+'\n');fs.appendFileSync(path.join(directory,'after.jsonl'),JSON.stringify({table,id:row.id,update})+'\n');staged.push([row.id,...fields.map(f=>update[f]===undefined?row[f]:update[f])]);}
    }
    if(report.scanned%10000===0)console.log(`${table}: scanned ${report.scanned}, changed ${report.changed}`);
    if(apply&&staged.length){const raw=Buffer.from(JSON.stringify(staged));const header=Buffer.alloc(4);header.writeUInt32LE(raw.length);const packed=Buffer.concat([header,require('zlib').deflateSync(raw)]);await q(`INSERT INTO honorific_stage (id,${fields.join(',')}) SELECT * FROM JSON_TABLE(CONVERT(UNCOMPRESS(?) USING utf8mb4), '$[*]' COLUMNS (id BIGINT PATH '$[0]',${fields.map((f,i)=>`\`${f}\` LONGTEXT PATH '$[${i+1}]'`).join(',')})) AS normalized`,[packed]);await q(`UPDATE ${table} s JOIN honorific_stage n ON n.id=s.id SET ${fields.map(f=>`s.${f}=n.${f}`).join(',')}`);const [check]=await q(`SELECT COUNT(*) AS mismatches FROM ${table} s JOIN honorific_stage n ON n.id=s.id WHERE NOT (${fields.map(f=>`BINARY s.${f} <=> BINARY n.${f}`).join(' AND ')})`);if(check.mismatches)throw Error(`Verification failed: ${table}`);await q('DELETE FROM honorific_stage');}
   }
   if(apply)await q('DROP TEMPORARY TABLE honorific_stage');
   console.log(table, JSON.stringify(report));
  }
  if(hadithIds.size)for(const r of await q('SELECT DISTINCT bookId FROM hadiths WHERE id IN (?)',[[...hadithIds]]))bookIds.add(r.bookId);
  if(hadithIds.size)for(const r of await q('SELECT DISTINCT bookId FROM hadiths_virtual WHERE hadithId IN (?)',[[...hadithIds]]))bookIds.add(r.bookId);
  if(sourceIds.size)for(const r of await q('SELECT DISTINCT book_id FROM sharh_book_mappings WHERE source_id IN (?)',[[...sourceIds]]))bookIds.add(r.book_id);
  manifest.hadithIds=[...hadithIds];manifest.bookIds=[...bookIds];
  if(apply){
   if(bookIds.size)await q('UPDATE books SET content_lastmod=NOW() WHERE id IN (?)',[[...bookIds]]);
   fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify(manifest,null,2));
   await q('COMMIT');
   console.log('Committed. Backup:', directory);
  }
 } catch(e){if(apply)await q('ROLLBACK').catch(()=>{});throw e;}
 finally{c.destroy();}
 if(apply)await refresh(manifest,directory);
}
async function refresh(manifest,directory,options={}) {
 require('../../lib/Globals');
 try {
  await require('../../lib/QuranTocSubdivisions').preload();
  const axios=require('axios'),http=require('../../lib/SearchHttp'),zlib=require('zlib');
  const counts={};
  async function bulk(index, entries) {
   if(!entries.length)return;
   if(index==='hadiths'&&entries.length>25){for(let i=0;i<entries.length;i+=25)await bulk(index,entries.slice(i,i+25));return;}
   const body=entries.map(e=>JSON.stringify({update:{_id:e.id}})+'\n'+JSON.stringify({doc:e.update})).join('\n')+'\n';
   let response;
   try{response=await axios.post(`${global.settings.search.domain}/${index}/_bulk`,zlib.gzipSync(Buffer.from(body)),http.axiosConfig({headers:{'Content-Type':'application/x-ndjson','Content-Encoding':'gzip'},timeout:120000,maxBodyLength:Infinity}));}
   catch(error){if(error.response?.status===413&&entries.length>1){const middle=Math.ceil(entries.length/2);await bulk(index,entries.slice(0,middle));await bulk(index,entries.slice(middle));return;}throw error;}
   const report=counts[index] ||= {updated:0,notIndexed:0};
   for(const item of response.data.items){const result=item.update;if(result.error?.type==='document_missing_exception')report.notIndexed++;else if(result.error)throw Error(JSON.stringify(result.error));else report.updated++;}
  }
  let pending=[],currentIndex='',bytes=0;
  if(!options.skipSourceIndexes)for await(const line of require('readline').createInterface({input:fs.createReadStream(path.join(directory,'after.jsonl')),crlfDelay:Infinity})) {
   const record=JSON.parse(line);
   const index=record.table==='hdith_hadith_sharh'?'sharhs':record.table==='hadiths_commentary'?'commentaries':null;
   if(!index)continue;
   if(index==='commentaries')for(const field of Object.keys(record.update)){
    // Other index languages are owned by user_content_translations, not these source columns.
    if(!['text','text_en','footnotes','footnotes_en'].includes(field))delete record.update[field];
    else record.update[field]=require('../../lib/Tafsir').stripPageMarkers(record.update[field]);
   }
   if(!Object.keys(record.update).length)continue;
   if(currentIndex!==index||pending.length>=100||bytes>2*1024*1024){await bulk(currentIndex,pending);pending=[];bytes=0;}
   currentIndex=index;pending.push(record);bytes+=line.length;
  }
  await bulk(currentIndex,pending);
  console.log('Commentary search updates:',JSON.stringify(counts));
  for(let i=0;i<manifest.hadithIds.length;i+=250) {
   const ids=manifest.hadithIds.slice(i,i+250);
   const rows=await global.query(`SELECT hs.hadith_id AS id, COMPRESS(JSON_ARRAYAGG(JSON_OBJECT('id',hs.id,'text',COALESCE(NULLIF(hs.text_en,''),hs.text),'title',COALESCE(NULLIF(hs.title_en,''),NULLIF(hs.title,''),ss.title_en,ss.title),'author',ss.author))) AS payload FROM hdith_hadith_sharh hs JOIN hdith_sharh_sources ss ON ss.id=hs.source_id WHERE hs.hadith_id IN (${ids.join(',')}) GROUP BY hs.hadith_id`);
   await bulk('hadiths',rows.map(row=>({id:row.id,update:{sharh:JSON.parse(zlib.inflateSync(row.payload.subarray(4)).toString('utf8')).sort((a,b)=>a.id-b.id).map(s=>`${s.title}${s.author?` — ${s.author}`:''}\n${s.text}`).join('\n\n')}})));
   if(i%2500===0)console.log(`Updated embedded sharhs: ${Math.min(i+250,manifest.hadithIds.length)}/${manifest.hadithIds.length}`);
  }
  for(const index of Object.keys(counts))await axios.post(`${global.settings.search.domain}/${index}/_refresh`,null,http.axiosConfig());
  const books=manifest.bookIds.length ? await global.query(`SELECT id,alias,type FROM books WHERE id IN (${manifest.bookIds.join(',')})`) : [];
  for(const book of books){
   await Utils.flushBookDiskCache(book.alias);
   await Utils.flushCacheContaining(`tafsir:${book.alias}`);
  }
  await require('../../lib/RuntimeRefresh').publish();
  fs.writeFileSync(path.join(directory,'refreshed.json'),JSON.stringify({at:new Date().toISOString(),counts}));
 }finally{await promisify(global.dbPool.end).call(global.dbPool);}
}
if(require.main===module)main().catch(e=>{console.error(e.stack||e.message);process.exitCode=1;});
module.exports={normalize,refresh,candidatePattern};
