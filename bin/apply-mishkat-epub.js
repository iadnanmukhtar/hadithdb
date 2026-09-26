#!/usr/bin/env node
'use strict';
// Apply the deterministic, reviewed-source report produced by import-mishkat-epub.js.
require('dotenv').config();
const fs=require('fs'),crypto=require('crypto'),mysql=require('mysql'),util=require('util');
const {parse,norm}=require('./import-mishkat-epub');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const USER='epub:mishkat';
async function main(){
 const report=JSON.parse(fs.readFileSync('temp/mishkat-import-review.json')),source=parse();
 if(report.sha256!==source.sha256||source.missing.length)throw Error('Source checksum or numbering audit failed');
 if(JSON.stringify(report.headings)!==JSON.stringify(source.headings))throw Error('Heading evidence changed');
 const sourceMap=new Map(source.entries.map(h=>[h.number,h]));
 for(const h of report.entries){const original=sourceMap.get(h.number);if(!original||h.text!==original.text||h.headingKey!==original.headingKey)throw Error('Entry evidence changed');}
 const linked=report.entries.filter(h=>h.links.length),db=mysql.createConnection(require('./initializeHadithAttributions').connectionSettings()),q=util.promisify(db.query).bind(db);
 try{
 const ids=[...new Set(linked.flatMap(h=>h.links.map(l=>l.id)))];
 const targets=await q('SELECT h.id,h.bookId,h.num,h.chain,h.body,h.text,h.books,b.alias FROM hadiths h JOIN books b ON b.id=h.bookId WHERE h.id IN (?)',[ids]),byId=new Map(targets.map(h=>[h.id,h]));
 for(const h of linked)for(const l of h.links){const t=byId.get(l.id);if(!t||l.targetSha256!==sha(JSON.stringify([t.id,t.bookId,t.num,t.chain,t.body,t.text]))||l.ref!==`${t.alias}:${t.num}`||!h.sources.includes(t.alias))throw Error(`Changed or invalid target: ${h.number}`);}
 const existing=(await q("SELECT * FROM books WHERE alias='mishkat'"))[0];
 if(existing){const props=typeof existing.properties==='string'?JSON.parse(existing.properties):existing.properties;if(props?.mishkatImport?.reportSha256===sha(fs.readFileSync('temp/mishkat-import-review.json'))){console.log(JSON.stringify({unchanged:true,bookId:existing.id}));return;}throw Error('Existing Mishkat book differs; refusing replacement');}
 console.log(JSON.stringify({dryRun:!process.argv.includes('--apply'),sourceNumbers:source.entries.reduce((n,h)=>n+h.numbers.length,0),entries:linked.length,aliases:linked.reduce((n,h)=>n+h.links.length,0),headings:source.headings.length}));
 if(!process.argv.includes('--apply'))return;
 const backup=`temp/mishkat-before-${Date.now()}.json`;fs.writeFileSync(backup,JSON.stringify({books:[],toc:[],hadiths_virtual:[],hadithMembership:targets.map(t=>({id:t.id,books:t.books})),sourceSha256:source.sha256,reportSha256:sha(fs.readFileSync('temp/mishkat-import-review.json'))},null,2));
 await q('START TRANSACTION');let bookId;
 try{
 bookId=Number((await q('SELECT MAX(id)+1 id FROM books'))[0].id);
 const properties={mishkatImport:{sourceSha256:source.sha256,reportSha256:sha(fs.readFileSync('temp/mishkat-import-review.json')),status:'partial-verified-aliases',sourceNumbers:6294,sourcePassages:source.entries.length,importedEntries:linked.length,importedAliases:linked.reduce((n,h)=>n+h.links.length,0)}};
 await q('INSERT INTO books SET ?',{id:bookId,ordinal:51,alias:'mishkat',virtual:1,type:'hadith',source:'epub',lang:'ar',size:'md',shortName:'مشكاة المصابيح',shortName_en:'Mishkat al-Masabih',name:'مِشْكَاةُ الْمَصَابِيحِ',name_en:'Mishkat al-Masabih',title:'مشكاة المصابيح',title_en:'Mishkat al-Masabih',author:'محمد بن عبد الله الخطيب العمري، أبو عبد الله، ولي الدين، التبريزي',author_en:'Muhammad ibn Abd Allah al-Khatib al-Tabrizi',death:741,publisher:'المكتب الإسلامي - بيروت',published_year:1985,format:'md',description:'Mishkat al-Masabih follows the books and chapters of al-Baghawi’s Masabih. Chapters generally contain three sections: reports from al-Bukhari and/or Muslim; reports from other cited collections; and supplementary reports, including statements of earlier scholars. The author notes exceptions, abbreviations, additions, variant wordings, and unidentified sources. This is a partial import of verified source aliases from the supplied Arabic EPUB, edited by Muhammad Nasir al-Din al-Albani, third edition (1985). Unresolved entries are retained separately for review; original numbering is preserved.',properties:JSON.stringify(properties)});
 const headingRecords=[];const headingMap=new Map(),startOrdinal=Number((await q('SELECT MAX(ordinal)+1 n FROM toc'))[0].n);
 for(const [i,h]of report.headings.entries()){
 const members=linked.filter(x=>{const t=source.headings.find(t=>t.key===x.headingKey);return t.h1===h.h1&&(h.level===1||t.h2===h.h2&&(h.level===2||t.h3===h.h3));});
 const record={bookId,ordinal:startOrdinal+i,level:h.level,h1:h.h1,h2:h.h2,h3:h.h3,title:h.title,intro:h.intro||null,start:members.length?String(members[0].number):null,start0:members[0]?.number||null,end:members.length?String(members.at(-1).number):null,end0:members.at(-1)?.number||null,count:members.reduce((n,h)=>n+h.links.length,0),lastmod_user:USER};
 if(h.level===3)record.title_en=norm(h.title).includes('الثالث')?'Third Section':norm(h.title).includes('الثاني')?'Second Section':'First Section';
 if(h.key==='C1')record.title_en="Author’s Introduction";
 headingRecords.push(record);
 }
 const headingColumns=['bookId','ordinal','level','h1','h2','h3','title','title_en','intro','start','start0','end','end0','count','lastmod_user'];
 for(let i=0;i<headingRecords.length;i+=200)await q('INSERT INTO toc (`'+headingColumns.join('`,`')+'`) VALUES ?',[headingRecords.slice(i,i+200).map(r=>headingColumns.map(k=>r[k]??null))]);
 const insertedHeadings=await q('SELECT id,ordinal FROM toc WHERE bookId=? ORDER BY ordinal',[bookId]);
 if(insertedHeadings.length!==report.headings.length)throw Error('Heading insert count differs');
 insertedHeadings.forEach((h,i)=>headingMap.set(report.headings[i].key,{...report.headings[i],id:h.id}));
 let ordinal=0;const counts=new Map(),values=[];
 for(const h of linked){const t=headingMap.get(h.headingKey);for(const [i,l]of h.links.entries()){const multiple=h.links.length>1,num=multiple?`${h.number}${String.fromCharCode(97+i)}`:String(h.number),n=(counts.get(t.id)||0)+1;counts.set(t.id,n);values.push([++ordinal,bookId,t.id,n,t.h1,t.h2,t.h3,num,multiple?h.number+(i+1)/1000:h.number,l.id,l.ref,i===0?h.text:null,i===0?l.ref.split(':')[0]:null,i===0&&norm(h.text).includes('متفق عليه')?1:null,i===0?h.footnote||null:null,USER]);}}
 for(let i=0;i<values.length;i+=200)await q('INSERT INTO hadiths_virtual (ordinal,bookId,tocId,numInChapter,h1,h2,h3,num,num0,hadithId,ref_num,textActual,bookActual,muttafaq,note,lastmod_user) VALUES ?',[values.slice(i,i+200)]);
 const audit=(await q('SELECT COUNT(*) n,COUNT(DISTINCT num) uniqueNums,COUNT(DISTINCT FLOOR(num0)) entries FROM hadiths_virtual WHERE bookId=?',[bookId]))[0];if(audit.n!==values.length||audit.uniqueNums!==values.length||audit.entries!==linked.length)throw Error('Inserted counts differ');
 await q("UPDATE hadiths SET books=CONCAT(COALESCE(books,''),'{mishkat}') WHERE id IN (?) AND COALESCE(books,'') NOT LIKE '%{mishkat}%'",[ids]);
 await q('COMMIT');
 }catch(e){await q('ROLLBACK');throw e;}
 await q('CALL refresh_v_hadiths_virtual_snapshot(?)',[bookId]);
 fs.writeFileSync('temp/mishkat-import-applied.json',JSON.stringify({bookId,backup,stats:report.stats},null,2));console.log(JSON.stringify({applied:true,bookId,backup}));
 }finally{db.end();}
}
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});
