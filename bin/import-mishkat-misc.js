#!/usr/bin/env node
'use strict';
const fs=require('fs'),assert=require('assert/strict'),crypto=require('crypto'),Zip=require('adm-zip'),cheerio=require('cheerio');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const REPORT='temp/mishkat-import-review.json',PLAN='temp/mishkat-misc-plan.json',APPLIED='temp/mishkat-misc-applied.json',USER='epub:mishkat-misc';
function sourceNote(h,zip){
 const $=cheerio.load(zip.readAsText(`OEBPS/xhtml/P${h.file}.xhtml`));
 const location=$('div.center').last().text().replace(/\s+/g,' ').trim();
 // Preserve the exact attribution in the supplied text, without inventing a source match.
 let plain='',offsets=[];for(let i=0;i<h.text.length;i++){const c=h.text[i].normalize('NFKD').replace(/[\u064b-\u065f\u0670ـ]/g,'');for(const x of c){plain+=x;offsets.push(i);}}
 const m=plain.match(/(?:رواه|رواهما|اخرجه|أخرجه|أخرجاه|اخرجاه|رواية|روايه)\s/);
 const cited=m?h.text.slice(offsets[m.index]).trim():plain.includes('متفق عليه')?'متفق عليه (البخاري ومسلم)':'';
 return [`المصدر: مشكاة المصابيح، رقم ${h.number}.`,location?`موضعه في النسخة المستوردة: ${location}.`:'',cited?`العزو الوارد في النص: ${cited}`:'',h.footnote||''].filter(Boolean).join('\n\n');
}
function prepare(report){const zip=new Zip('temp/مشكاة المصابيح.epub');return report.entries.filter(h=>!h.links.length).map(h=>({number:h.number,num:`mishkat-${h.number}`,text:h.text,footnote:sourceNote(h,zip),sourceFootnote:h.footnote||'',headingKey:h.headingKey}));}
async function main(){
 require('dotenv').config();const mysql=require('mysql'),util=require('util'),db=mysql.createConnection(require('./initializeHadithAttributions').connectionSettings()),q=util.promisify(db.query).bind(db);
 try{
 const bytes=fs.readFileSync(REPORT),report=JSON.parse(bytes),original=JSON.parse(bytes),book=(await q("SELECT * FROM books WHERE alias='mishkat' AND `virtual`=1"))[0],misc=(await q("SELECT * FROM books WHERE alias='misc' AND `virtual`=0"))[0];assert(book&&misc);
 const props=typeof book.properties==='string'?JSON.parse(book.properties):book.properties;
 const existing=await q('SELECT * FROM hadiths_virtual WHERE bookId=? ORDER BY ordinal,id',[book.id]);
 const miscRows=await q('SELECT * FROM hadiths WHERE bookId=? ORDER BY ordinal,id',[misc.id]);
 if(props.mishkatMiscImport){const imported=miscRows.filter(r=>r.lastmod_user===USER);assert.equal(imported.length,props.mishkatMiscImport.entries);for(const r of imported){const h=report.entries.find(h=>`mishkat-${h.number}`===r.num);assert(h);assert.equal(r.body,h.text);assert.equal(r.footnote,h.footnote);assert(existing.some(x=>Math.floor(x.num0)===h.number&&x.hadithId===r.id&&x.note===r.footnote));}console.log({unchanged:true,entries:imported.length});return;}
 const entries=prepare(report);assert.equal(entries.length,1842);assert.equal(report.stats.unlinked,1842);assert.equal(existing.length,report.stats.links);
 assert(!miscRows.some(r=>r.num.startsWith('mishkat-')),'Existing misc Mishkat records need reconciliation');
 const toc=await q('SELECT * FROM toc WHERE bookId=? ORDER BY ordinal,id',[book.id]),miscToc=await q('SELECT * FROM toc WHERE bookId=? ORDER BY ordinal,id',[misc.id]);assert.equal(miscToc.length,1);const mt=miscToc[0];
 const plan={baseReportSha256:sha(bytes),sourceSha256:report.sha256,miscBookId:misc.id,mishkatBookId:book.id,entries};fs.writeFileSync(PLAN,JSON.stringify(plan,null,2));console.log({entries:entries.length,existingMisc:miscRows.length,existingMishkatAliases:existing.length,example:entries[0],apply:process.argv.includes('--apply')});if(!process.argv.includes('--apply'))return;
 assert.equal(require('./import-mishkat-epub').parse().sha256,report.sha256);assert.equal(sha(fs.readFileSync(REPORT)),plan.baseReportSha256);
 const backup=`temp/mishkat-misc-before-${Date.now()}.json`;fs.writeFileSync(backup,JSON.stringify({book,misc,miscRows,existing,toc,miscToc,report:original},null,2));
 await q('SET SESSION innodb_lock_wait_timeout=300');await q('START TRANSACTION');try{
 // Serialize another run for these books, and fail if the baseline changed.
 const locked=await q('SELECT id,properties FROM books WHERE id IN (?,?) ORDER BY id FOR UPDATE',[misc.id,book.id]);assert.equal(locked.find(r=>r.id===book.id).properties,book.properties);
 assert.equal((await q('SELECT COUNT(*) n FROM hadiths WHERE bookId=?',[misc.id]))[0].n,miscRows.length);
 assert.equal((await q('SELECT COUNT(*) n FROM hadiths_virtual WHERE bookId=?',[book.id]))[0].n,existing.length);
 const baseOrdinal=Math.max(0,...miscRows.map(r=>r.ordinal)),baseNum=Math.ceil(Math.max(0,...miscRows.map(r=>Number(r.num0)||0)));
 assert(baseNum+entries.length<10000000);
 const values=entries.map((h,i)=>[baseOrdinal+i+1,misc.id,mt.id,miscRows.length+i+1,mt.h1,mt.h2,mt.h3,h.num,String(h.number),baseNum+i+1,'No Grade',h.text,h.text,h.footnote,USER]);
 for(let i=0;i<values.length;i+=100)await q('INSERT INTO hadiths (ordinal,bookId,tocId,numInChapter,h1,h2,h3,num,numActual,num0,gradeText,text,body,footnote,lastmod_user) VALUES ?',[values.slice(i,i+100)]);
 console.log({physicalRowsInserted:entries.length});
 const inserted=await q('SELECT * FROM hadiths WHERE bookId=? AND lastmod_user=? ORDER BY ordinal',[misc.id,USER]);assert.equal(inserted.length,entries.length);const byNum=new Map(inserted.map(r=>[r.num,r]));
 const positions=new Map(toc.map(t=>[[t.level,t.h1,t.h2,t.h3].join(':'),t])),headings=new Map(report.headings.map(t=>[t.key,t]));let ordinal=Math.max(...existing.map(r=>r.ordinal));const aliases=[];
 for(const h of entries){const c=byNum.get(h.num),heading=headings.get(h.headingKey),t=positions.get([heading.level,heading.h1,heading.h2,heading.h3].join(':'));assert(c&&t);assert.equal(c.body,h.text);assert.equal(c.footnote,h.footnote);aliases.push([++ordinal,book.id,t.id,0,t.h1,t.h2,t.h3,String(h.number),h.number,c.id,`misc:${h.num}`,h.text,'misc',h.footnote,USER]);const e=report.entries.find(e=>e.number===h.number);e.originalSourceFootnote=h.sourceFootnote;e.footnote=h.footnote;e.links=[{id:c.id,ref:`misc:${h.num}`,method:'preserved-mishkat-source',sourceMatchVerified:false}];e.miscImport={sourceSha256:report.sha256,sourceNumber:h.number,sourceMatchVerified:false};}
 for(let i=0;i<aliases.length;i+=100)await q('INSERT INTO hadiths_virtual (ordinal,bookId,tocId,numInChapter,h1,h2,h3,num,num0,hadithId,ref_num,textActual,bookActual,note,lastmod_user) VALUES ?',[aliases.slice(i,i+100)]);
 console.log({virtualAliasesInserted:aliases.length,stage:'ordering'});
 const rows=await q('SELECT * FROM hadiths_virtual WHERE bookId=? ORDER BY num0,id',[book.id]),counts=new Map();assert.equal(rows.length,existing.length+entries.length);
 await q('CREATE TEMPORARY TABLE mishkat_misc_order (id INT PRIMARY KEY, ordinal INT, chapterNum INT)');await q('INSERT INTO mishkat_misc_order VALUES ?',[rows.map((r,i)=>{const n=(counts.get(r.tocId)||0)+1;counts.set(r.tocId,n);return [r.id,i+1,n];})]);await q('UPDATE hadiths_virtual h JOIN mishkat_misc_order o ON o.id=h.id SET h.ordinal=o.ordinal,h.numInChapter=o.chapterNum WHERE h.bookId=? AND (h.ordinal<>o.ordinal OR h.numInChapter<>o.chapterNum)',[book.id]);
 const bounds=toc.map(t=>{const members=rows.filter(r=>r.h1===t.h1&&(t.level===1||r.h2===t.h2&&(t.level===2||r.h3===t.h3)));return [t.id,members.length?String(Math.floor(members[0].num0)):null,members.length?Math.floor(members[0].num0):null,members.length?String(Math.floor(members.at(-1).num0)):null,members.length?Math.floor(members.at(-1).num0):null,members.length];});
 await q('CREATE TEMPORARY TABLE mishkat_misc_bounds (id INT PRIMARY KEY, startNum VARCHAR(45),start0 DECIMAL(10,3),endNum VARCHAR(45),end0 DECIMAL(10,3),n INT)');await q('INSERT INTO mishkat_misc_bounds VALUES ?',[bounds]);await q('UPDATE toc t JOIN mishkat_misc_bounds b ON b.id=t.id SET t.start=b.startNum,t.start0=b.start0,t.end=b.endNum,t.end0=b.end0,t.count=b.n WHERE t.bookId=?',[book.id]);
 const allMisc=await q('SELECT * FROM hadiths WHERE bookId=? ORDER BY ordinal,id',[misc.id]);for(const old of miscRows){const now=allMisc.find(r=>r.id===old.id);assert.deepEqual(now,old);}await q('UPDATE toc SET count=?,`start`=?,start0=?,`end`=?,end0=? WHERE id=?',[allMisc.length,allMisc[0].num,allMisc[0].num0,allMisc.at(-1).num,allMisc.at(-1).num0,mt.id]);
 const final=await q('SELECT * FROM hadiths_virtual WHERE bookId=? ORDER BY ordinal,id',[book.id]),byId=new Map(final.map(r=>[r.id,r]));for(const old of existing){const now=byId.get(old.id);for(const key of ['hadithId','ref_num','num','num0','tocId','textActual','note'])assert.equal(now[key],old[key]);}assert(final.every((r,i)=>r.ordinal===i+1&&(!i||r.num0>=final[i-1].num0)));assert.equal(new Set(final.map(r=>Math.floor(r.num0))).size,6294);
 for(const h of entries){const row=final.find(r=>Math.floor(r.num0)===h.number);assert.equal(row.ref_num,`misc:${h.num}`);assert.equal(row.textActual,h.text);assert.equal(row.note,h.footnote);}
 report.stats.linkedEntries=6294;report.stats.links=final.length;report.stats.unlinked=0;report.stats.miscEntries=entries.length;report.stats.matchedSourceEntries=original.stats.linkedEntries;
 const next=JSON.stringify(report,null,2);props.mishkatImport.reportSha256=sha(next);props.mishkatImport.importedEntries=6294;props.mishkatImport.importedAliases=final.length;props.mishkatMiscImport={entries:entries.length,backup,sourceSha256:report.sha256};await q('UPDATE books SET properties=?,content_lastmod=CURRENT_TIMESTAMP() WHERE id=?',[JSON.stringify(props),book.id]);await q('UPDATE books SET content_lastmod=CURRENT_TIMESTAMP() WHERE id=?',[misc.id]);
 await q('COMMIT');fs.writeFileSync(REPORT,next);fs.writeFileSync(APPLIED,JSON.stringify({bookId:book.id,miscBookId:misc.id,backup,stats:report.stats,inserted:inserted.map(r=>({id:r.id,num:r.num}))},null,2));
 }catch(e){await q('ROLLBACK');throw e;}
 await q('CALL refresh_v_hadiths_virtual_snapshot(?)',[book.id]);console.log({applied:true,stats:report.stats,backup});
 }finally{db.end();}
}
module.exports={sourceNote,prepare};if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});
