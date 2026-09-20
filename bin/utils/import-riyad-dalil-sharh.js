#!/usr/bin/env node
'use strict';
require('dotenv').config();
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const AdmZip=require('adm-zip'),cheerio=require('cheerio');
const sha256=x=>crypto.createHash('sha256').update(x).digest('hex');
const EPUB=path.resolve('temp/دليل الفالحين لطرق الر رياض الصالحين.epub');
const HASH='332be224a4885066a56a383eae64dac1e87bc70238b79fa9ba3718c462fe96fd';
function extract(filename=EPUB){
 const bytes=fs.readFileSync(filename);if(sha256(bytes)!==HASH)throw Error('Unreviewed EPUB');
 const zip=new AdmZip(bytes),opf=cheerio.load(zip.readAsText('OEBPS/content.opf'),{xmlMode:true});
 const manifest=new Map(opf('manifest item').toArray().map(e=>[opf(e).attr('id'),opf(e).attr('href')]));
 const spine=opf('spine itemref').toArray().map(e=>manifest.get(opf(e).attr('idref'))).filter(h=>/^xhtml\/P\d+\.xhtml$/.test(h));
 const parts=[];let previous;
 for(const href of spine.slice(1)){
  const $=cheerio.load(zip.readAsText('OEBPS/'+href));const footer=$('.center').text();
  const volume=Number(footer.match(/الجزء:\s*(\d+)/)?.[1]),page=Number(footer.match(/الصفحة:\s*(\d+)/)?.[1]);
  const filePage=Number(href.match(/P(\d+)/)[1]);
  if(previous&&(volume!==previous.volume||page!==previous.page+1))parts.push({kind:'gap',text:'',filePage,volume,page});
  previous={volume,page};
  $('.footnote br').replaceWith('\n');const notes=new Map();
  const noteText=$('.footnote').text();const matches=[...noteText.matchAll(/(?:^|\n)\s*\((\d+)\)\s*/g)];
  for(let i=0;i<matches.length;i++)notes.set(matches[i][1],noteText.slice(matches[i].index+matches[i][0].length,matches[i+1]?.index).trim());
  $('.matn,.matn-hr,.footnote,.footnote-hr').remove();
  $('#book-container a').remove();$('#book-container br').replaceWith('\n');
  $('#book-container .title').before('\n[[TITLE]]');
  let lines=$('#book-container').text().split('\n').map(t=>t.trim()).filter(Boolean);
  for(let i=0;i<lines.length;i++){
   if(/^\d+\s*[-ـ]+\s*$/.test(lines[i])&&lines[i+1]?.startsWith('[[TITLE]]')){lines[i+1]=lines[i]+' '+lines[i+1];continue;}
   let text=lines[i];const title=text.includes('[[TITLE]]');text=text.replace('[[TITLE]]','');
   // Footnotes are page-local; separate matn references are intentionally not copied.
   const refs=[];text=text.replace(/\((\d+)\)/g,(m,n)=>{if(!notes.has(n))return m;const key=`p${filePage}n${n}`;refs.push({key,text:notes.get(n)});return `[^${key}]`;});
   const printed=text.match(/^(\d[\d ]*)\s*[-ـ]+\s*(.+)/u);
   // These two short lines continue citations from the preceding page, not headings.
   const bareHeading=/^(?:باب|كتاب) /u.test(text)&&text.length<180&&![647,655].includes(filePage);
   const heading=bareHeading||(title&&/^(?:\d+\s*[-ـ]+\s*)?\(?(?:باب|كتاب)/u.test(text))||/^\d+\s*[-ـ]+\s*(?:باب|كتاب|كتَاب)/u.test(text);
   const suspicious=/^\(?(?:وعن|وعنه|عن|الأول|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر)(?:\s|[:：])/u.test(text);
   parts.push({kind:heading?'heading':printed?'hadith':suspicious?'possible':'body',text,refs,printed:printed?.[1].replace(/ /g,''),filePage,volume,page});
  }
 }
 return parts;
}
function textFor(parts,start,end,offsets={}){
 const slice=parts.slice(start,end).map(p=>({...p}));
 if(offsets.startTextOffset!==undefined||offsets.endTextOffset!==undefined){
  if(!slice.length)throw Error('Invalid text slice');
  const first=offsets.startTextOffset??0,last=offsets.endTextOffset??slice.at(-1).text.length;
  if(!Number.isInteger(first)||!Number.isInteger(last)||first<0||first>=slice[0].text.length||last<=0||last>slice.at(-1).text.length||(slice.length===1&&first>=last))throw Error('Invalid text slice');
  slice.at(-1).text=slice.at(-1).text.slice(0,last);
  slice[0].text=slice[0].text.slice(first);
 }
 const notes=new Map(slice.flatMap(p=>(p.refs||[]).filter(n=>p.text.includes(`[^${n.key}]`)).map(n=>[n.key,n.text])));
 return slice.map(p=>p.text).filter(Boolean).join('\n\n')+(notes.size?'\n\n'+[...notes].map(([k,t])=>`[^${k}]: ${t.replace(/\n/g,' ')}`).join('\n'):'');
}
function normalize(t){return String(t||'').normalize('NFKD').replace(/[\u064B-\u065F\u0670\u06D6-\u06EDـ]/g,'').replace(/[أإآٱ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه').replace(/بن/g,' بن ').replace(/صلي الله عليه وسلم|رضي الله عنهما?/g,' ').replace(/[^\p{L} ]/gu,' ').replace(/\s+/g,' ').trim();}
function tokens(t){return normalize(t).split(' ').filter(w=>w.length>=3);}
function coverage(text,target){const a=new Set(tokens(text)),b=new Set(tokens(target));return [...b].filter(w=>a.has(w)).length/Math.max(1,b.size);}
module.exports={extract,textFor,sha256,normalize,coverage,EPUB,HASH};

const SOURCE={bookId:-9,title:'دليل الفالحين (ابن علان)',titleEn:'Dalīl al-Fāliḥīn (Ibn ʿAllān)',author:'محمد علي بن محمد علان البكري الصديقي'};
const AUDIT=path.resolve('temp/dalil-audit');
function normalizeHonorifics(text){
 const normalized=require('../../lib/Utils').normalizeArabicHonorifics(text);
 const cleaned=normalized===text?text:normalized.replace(/[ \t]{2,}/g,' ').trim();
 return require('./normalize-commentary-honorifics').normalize(cleaned);
}
function materialize(alignment,parts){
 if(alignment.epubSha256!==HASH||parts.length!==alignment.partCount)throw Error('Source layout changed');
 const entries=alignment.segments.map(s=>{
  if(parts[s.start]?.text.slice(0,100)!==s.startWitness||parts[s.end]?.text.slice(0,100)!==s.endWitness)throw Error(`Boundary changed: ${s.start}`);
  if(parts.slice(s.start,s.end).some(p=>p.kind==='gap'))throw Error(`Incomplete passage: ${s.start}`);
  if(s.kind==='hadith'&&(parts[s.start].kind!=='hadith'||!['hadith','heading'].includes(parts[s.end]?.kind))&&!([2,3,4].includes(s.validationPass)&&s.boundaryReview))throw Error('Unvalidated hadith boundary');
  const text=textFor(parts,s.start,s.end,s);if(sha256(text)!==s.textSha256)throw Error(`Source text changed: ${s.start}`);
  return {...s,sourceText:text,text:normalizeHonorifics(text),entryId:s.entryId??(-9000000-s.start)};
 });
 for(let i=1;i<entries.length;i++){
  const previous=entries[i-1],current=entries[i];
  const end=previous.endTextOffset===undefined?[previous.end,0]:[previous.end-1,previous.endTextOffset];
  const start=[current.start,current.startTextOffset||0];
  if(end[0]>start[0]||(end[0]===start[0]&&end[1]>start[1]))throw Error('Overlapping source passages');
 }
 return entries;
}
function validateTargets(entries,rows,headings,supportingRecords=[]){
 for(const e of entries){
  if(e.kind==='hadith'){
   const r=rows.find(r=>r.id===e.virtualId);
   if(!r||r.hadithId!==e.hadithId||Math.floor(r.num0)!==e.number||r.actualBookId===61||
    sha256(JSON.stringify([r.hadithId,r.tocId,r.num0,r.textActual,r.chain,r.body]))!==e.targetSha256||
    (e.targetFullTextSha256&&sha256(r.actualText||'')!==e.targetFullTextSha256))throw Error(`Actual hadith identity changed: ${e.number}`);
   for(const support of e.supportingTargets||[]){
    const record=supportingRecords.find(r=>r.id===support.id);
    if(!record||sha256(JSON.stringify([record.id,record.bookId,record.chain,record.body,record.text]))!==support.sha256)throw Error(`Supporting narration changed: ${e.number}`);
   }
  }else if(!headings.some(t=>t.id===e.tocId&&t.title===e.targetTitle&&(!e.targetIntroSha256||sha256(t.intro||'')===e.targetIntroSha256)))throw Error(`Heading identity changed: ${e.tocId}`);
 }
}
const targetSql=`SELECT hv.id,hv.num0,hv.hadithId,hv.tocId,hv.textActual,h.chain,h.body,h.text actualText,h.bookId actualBookId
 FROM hadiths_virtual hv JOIN hadiths h ON h.id=hv.hadithId WHERE hv.bookId=61`;
async function refresh(sourceId,expected){
 require('../../lib/Globals');const {promisify}=require('util');
 try{
  await require('../../lib/SharhBooks').sync();
  const [book]=await global.query(`SELECT b.* FROM books b JOIN sharh_book_mappings m ON m.book_id=b.id WHERE m.source_id=${Number(sourceId)} AND m.source_title=''`);
  if(!book)throw Error('Missing sharh book');
  // Assign a human-readable alias only to the newly generated catalog entry.
  if(book.alias===`sharh-${book.id}`)await global.query(`UPDATE books SET alias='riyad-ibn-allan',lang='ar' WHERE id=${book.id}`);
  const index=require('../../lib/HadithSharhIndex');await index.ensureIndex();let after=0,count=0;
  while(true){const docs=await index.documents(`hs.source_id=${Number(sourceId)} AND hs.id>${after}`);if(!docs.length)break;await index.writeBatch(docs);after=docs.at(-1).id;count+=docs.length;}
  if(count!==expected)throw Error(`Index count mismatch: ${count} != ${expected}`);
  const axios=require('axios'),http=require('../../lib/SearchHttp');
  await axios.post(`${global.settings.search.domain}/sharhs/_refresh`,null,http.axiosConfig());
  const indexed=await axios.post(`${global.settings.search.domain}/sharhs/_count`,{query:{term:{bookId:book.id}}},http.axiosConfig());
  if(indexed.data.count!==expected)throw Error('Search count verification failed');
  const aliases=await global.query(`SELECT DISTINCT b.alias FROM hdith_hadith_sharh s JOIN hadiths h ON h.id=s.hadith_id JOIN books b ON b.id=h.bookId WHERE s.source_id=${Number(sourceId)}`);
  for(const alias of ['riyad',...aliases.map(r=>r.alias)])await require('../../lib/Utils').flushBookDiskCache(alias);
  await require('../../lib/RuntimeRefresh').publish();
  fs.writeFileSync(path.join(AUDIT,'refreshed.json'),JSON.stringify({sourceId,bookId:book.id,alias:'riyad-ibn-allan',indexed:count,verifiedSearchCount:indexed.data.count,at:new Date().toISOString()},null,2));
  console.log(`Indexed and verified ${count} commentaries; refreshed affected book caches and runtime catalog.`);
 }finally{await promisify(global.dbPool.end).call(global.dbPool);}
}
function replacementKind(stored,entry,options={}){
 if(stored===entry.text)return null;
 if(options.honorifics&&stored===entry.sourceText)return 'honorifics';
 if(options.corrections&&entry.previousTextSha256&&sha256(stored)===entry.previousTextSha256)return 'reviewed-correction';
 throw Error('Existing entry differs; refusing overwrite');
}
async function main(){
 const alignment=require('./riyad-dalil-alignment.json'),entries=materialize(alignment,extract());
 const mysql=require('mysql'),{promisify}=require('util');const db=mysql.createConnection(require('../initializeHadithAttributions').connectionSettings());const query=promisify(db.query).bind(db);
 const supportingIds=[...new Set(entries.flatMap(e=>(e.supportingTargets||[]).map(s=>s.id)))];
 const supportingRecords=lock=>supportingIds.length?query('SELECT id,bookId,chain,body,text FROM hadiths WHERE id IN (?)'+(lock?' FOR UPDATE':''),[supportingIds]):Promise.resolve([]);
 fs.mkdirSync(AUDIT,{recursive:true});let source;
 try{
  if(!(await query("SELECT id FROM books WHERE id=61 AND alias='riyad' AND `virtual`=1")).length)throw Error('Riyad book identity changed');
  validateTargets(entries,await query(targetSql),await query('SELECT id,title,intro FROM toc WHERE bookId=61'),await supportingRecords(false));
  const counts=entries.reduce((a,e)=>(a[e.kind]=(a[e.kind]||0)+1,a),{});console.log(JSON.stringify({counts,actualHadiths:new Set(entries.filter(e=>e.hadithId).map(e=>e.hadithId)).size,validated:true}));
  if(process.argv.includes('--refresh')){[source]=await query('SELECT * FROM hdith_sharh_sources WHERE source_book_id=?',[SOURCE.bookId]);if(!source)throw Error('Source absent');}
  else if(!process.argv.includes('--apply'))return;
  else{
   await require('../../lib/HadithHeadingSharh').ensureSchema(query);
   if(Number((await query("SELECT GET_LOCK('import-riyad-dalil',30) locked"))[0].locked)!==1)throw Error('Import already running');
   await query('START TRANSACTION');
   try{
    const lockedHeadings=await query('SELECT id,title,intro FROM toc WHERE bookId=61 FOR UPDATE');
    validateTargets(entries,await query(targetSql+' FOR UPDATE'),lockedHeadings,await supportingRecords(true));
    [source]=await query('SELECT * FROM hdith_sharh_sources WHERE source_book_id=? FOR UPDATE',[SOURCE.bookId]);
    if(source&&source.author!==SOURCE.author)throw Error('Source namespace conflict');
    const before={source,hadiths:source?await query('SELECT * FROM hdith_hadith_sharh WHERE source_id=?',[source.id]):[],headings:source?await query('SELECT * FROM hdith_toc_sharh WHERE source_id=?',[source.id]):[]};
    const backupDir=path.join(require('os').homedir(),'.hadithdb','backups');fs.mkdirSync(backupDir,{recursive:true});const backup=path.join(backupDir,`riyad-dalil-${Date.now()}.json`);fs.writeFileSync(backup,JSON.stringify(before,null,2));
    if(!source){await query('INSERT INTO hdith_sharh_sources (source_book_id,title,title_en,author,source_url) VALUES (?,?,?,?,?)',[SOURCE.bookId,SOURCE.title,SOURCE.titleEn,SOURCE.author,'']);[source]=await query('SELECT * FROM hdith_sharh_sources WHERE source_book_id=?',[SOURCE.bookId]);}
    let inserted=0,normalizedRows=0,correctedRows=0;
    await query("CREATE TEMPORARY TABLE dalil_honorific_updates (id INT PRIMARY KEY,text LONGTEXT NOT NULL)");
    for(const hadith of [true,false]){
     const table=hadith?'hdith_hadith_sharh':'hdith_toc_sharh',key=hadith?'hadith_id':'toc_id';
     const existing=await query(`SELECT id,${key},source_entry_id,source_id,text FROM ${table} WHERE source_entry_id BETWEEN -9100000 AND -9000000 FOR UPDATE`);
     const pending=[],updates=[];
     for(const e of entries.filter(e=>hadith?e.kind==='hadith':e.kind!=='hadith')){
      const id=hadith?e.hadithId:e.tocId;
      const old=existing.filter(s=>s[key]===id&&s.source_entry_id===e.entryId);
      if(old.length){
       if(old.length!==1||old[0].source_id!==source.id)throw Error('Existing entry identity differs');
       if(old[0].text!==e.text){
        const replacement=replacementKind(old[0].text,e,{honorifics:process.argv.includes('--normalize-honorifics'),corrections:process.argv.includes('--apply-reviewed-corrections')});
        if(replacement==='honorifics')normalizedRows++;else correctedRows++;
        updates.push([old[0].id,e.text]);
       }
       continue;
      }
      const prefix=hadith?[id,lockedHeadings.find(t=>t.id===e.tocId).title]:[id];
      pending.push([...prefix,e.number||e.start,source.id,e.entryId,e.page,source.title,source.title_en,e.text,'md','']);
     }
     for(let offset=0;offset<updates.length;offset+=100){
      const batch=updates.slice(offset,offset+100);
      await query('INSERT INTO dalil_honorific_updates (id,text) VALUES ?',[batch]);
      await query(`UPDATE ${table} s JOIN dalil_honorific_updates u ON u.id=s.id SET s.text=u.text WHERE s.source_id=?`,[source.id]);
      await query('DELETE FROM dalil_honorific_updates');
     }
     const columns=hadith?'hadith_id,chapter':'toc_id';
     for(let offset=0;offset<pending.length;offset+=100){
      const batch=pending.slice(offset,offset+100);
      await query(`INSERT INTO ${table} (${columns},ordinal,source_id,source_entry_id,page_num,title,title_en,text,format,source_url) VALUES ?`,[batch]);
      inserted+=batch.length;
     }
    }
    for(const [kind,table,key] of [['hadith','hdith_hadith_sharh','hadith_id'],['heading','hdith_toc_sharh','toc_id']]){
     const stored=await query(`SELECT * FROM ${table} WHERE source_id=?`,[source.id]);const expected=entries.filter(e=>kind==='hadith'?e.kind==='hadith':e.kind!=='hadith');
     if(stored.length!==expected.length||expected.some(e=>!stored.some(s=>s[key]===(kind==='hadith'?e.hadithId:e.tocId)&&s.source_entry_id===e.entryId&&s.text===e.text)))throw Error('Exact post-write audit failed');
    }
    await query('COMMIT');
    fs.writeFileSync(path.join(AUDIT,'applied.json'),JSON.stringify({sourceId:source.id,counts,inserted,normalizedRows,correctedRows,actualHadiths:new Set(entries.filter(e=>e.hadithId).map(e=>e.hadithId)).size,backup,exactTextVerified:true,appliedAt:new Date().toISOString()},null,2));
    console.log(`Imported/verified ${entries.length} passages (new: ${inserted}, honorifics normalized: ${normalizedRows}, reviewed corrections: ${correctedRows}), source ${source.id}.`);
   }catch(err){await query('ROLLBACK');throw err;}finally{await query("SELECT RELEASE_LOCK('import-riyad-dalil')");}
  }
 }finally{db.end();}
 if(source)await refresh(source.id,entries.filter(e=>e.kind==='hadith').length);
}
Object.assign(module.exports,{materialize,validateTargets,normalizeHonorifics,replacementKind});
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});
