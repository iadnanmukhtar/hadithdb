#!/usr/bin/env node
'use strict';
const fs=require('fs'),assert=require('assert/strict'),{separateReviewedEditorial:separate,reviewed,sha}=require('./utils/mishkat-editorial');
const reportPath='temp/mishkat-import-review.json',parsedPath='temp/mishkat-parsed.json';
async function main(){
 const bytes=fs.readFileSync(reportPath),report=JSON.parse(bytes),original=JSON.parse(bytes),parsedBytes=fs.readFileSync(parsedPath),parsed=JSON.parse(parsedBytes);
 const changes=[];report.entries=report.entries.map(h=>{const next=separate(h);if(next!==h)changes.push({number:h.number,before:h,after:next});return next;});parsed.entries=parsed.entries.map(separate);
 const plan={sourceSha256:report.sha256,baseReportSha256:sha(bytes),stats:{examined:report.entries.length,reviewed:reviewed.length,changed:changes.length,alreadyImported:changes.filter(c=>c.before.links.length).length,unresolved:changes.filter(c=>!c.before.links.length).length},changes};
 if(changes.length||!fs.existsSync('temp/mishkat-editorial-audit.json'))fs.writeFileSync('temp/mishkat-editorial-audit.json',JSON.stringify(plan,null,2));console.log(plan.stats);
 if(!process.argv.includes('--verify-db')&&!process.argv.includes('--apply'))return;
 require('dotenv').config();const mysql=require('mysql'),util=require('util'),db=mysql.createConnection(require('./initializeHadithAttributions').connectionSettings()),q=util.promisify(db.query).bind(db);
 try{
 const book=(await q("SELECT * FROM books WHERE alias='mishkat' AND `virtual`=1"))[0];assert(book);
 const rows=await q('SELECT * FROM hadiths_virtual WHERE bookId=? ORDER BY ordinal,id',[book.id]),patches=[];
 for(const c of changes){const aliases=rows.filter(r=>Math.floor(r.num0)===c.number);assert.equal(aliases.length,c.before.links.length,`Alias count changed ${c.number}`);if(!aliases.length)continue;assert.equal(aliases.filter(r=>r.textActual!==null).length,1,`Primary text count ${c.number}`);
 for(const row of aliases){assert(c.before.links.some(l=>l.id===row.hadithId&&l.ref===row.ref_num));if(row.textActual===null)continue;assert.equal(row.textActual,c.before.text,`Live text changed ${c.number}`);assert.equal(row.note||'',c.before.footnote||'',`Live note changed ${c.number}`);patches.push({id:row.id,number:c.number,text:c.after.text,note:c.after.footnote});}}
 console.log({verifiedLiveAliases:rows.length,patches:patches.length,apply:process.argv.includes('--apply')});if(!process.argv.includes('--apply')||!changes.length)return;
 assert.equal(sha(fs.readFileSync(reportPath)),plan.baseReportSha256);assert.equal(require('./import-mishkat-epub').parse().sha256,plan.sourceSha256);
 const backup=`temp/mishkat-editorial-before-${Date.now()}.json`;fs.writeFileSync(backup,JSON.stringify({book,rows,report:original,parsed:JSON.parse(parsedBytes)},null,2));
 const nextReport=JSON.stringify(report,null,2),props=typeof book.properties==='string'?JSON.parse(book.properties):book.properties;
 await q('START TRANSACTION');try{
 await q('CREATE TEMPORARY TABLE mishkat_editorial_patch (id INT PRIMARY KEY, body LONGTEXT, note LONGTEXT) CHARACTER SET utf8mb4');
 if(patches.length){await q('INSERT INTO mishkat_editorial_patch VALUES ?',[patches.map(p=>[p.id,p.text,p.note])]);const locked=await q('SELECT h.* FROM hadiths_virtual h JOIN mishkat_editorial_patch p ON p.id=h.id WHERE h.bookId=? FOR UPDATE',[book.id]);for(const r of locked){const old=rows.find(x=>x.id===r.id);assert.equal(r.textActual,old.textActual);assert.equal(r.note,old.note);assert.equal(r.hadithId,old.hadithId);}assert.equal(locked.length,patches.length);await q('UPDATE hadiths_virtual h JOIN mishkat_editorial_patch p ON p.id=h.id SET h.textActual=p.body,h.note=p.note WHERE h.bookId=?',[book.id]);}
 const final=await q('SELECT * FROM hadiths_virtual WHERE bookId=? ORDER BY ordinal,id',[book.id]),byId=new Map(final.map(r=>[r.id,r])),patchById=new Map(patches.map(p=>[p.id,p]));assert.equal(final.length,rows.length);
 for(const old of rows){const r=byId.get(old.id),p=patchById.get(old.id);assert(r);for(const key of ['hadithId','ref_num','num','num0','tocId','ordinal','numInChapter'])assert.equal(r[key],old[key]);assert.equal(r.textActual,p?p.text:old.textActual);assert.equal(r.note,p?p.note:old.note);}
 props.mishkatImport.reportSha256=sha(nextReport);props.mishkatEditorialAudit={changed:changes.length,updatedAliases:patches.length,backup};await q('UPDATE books SET properties=?,content_lastmod=CURRENT_TIMESTAMP() WHERE id=?',[JSON.stringify(props),book.id]);
 await q('COMMIT');fs.writeFileSync(reportPath,nextReport);fs.writeFileSync(parsedPath,JSON.stringify(parsed,null,2));
 }catch(e){await q('ROLLBACK');throw e;}
 await q('CALL refresh_v_hadiths_virtual_snapshot(?)',[book.id]);
 fs.writeFileSync('temp/mishkat-editorial-audit-applied.json',JSON.stringify({bookId:book.id,backup,stats:plan.stats,updatedAliases:patches.length,existingLinksAndOrderPreserved:true},null,2));console.log({applied:true,updatedAliases:patches.length,backup});
 }finally{db.end();}
}
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});
