#!/usr/bin/env node
'use strict';
const fs=require('fs'),assert=require('assert/strict');
const db=require('mysql').createConnection(require('./initializeHadithAttributions').connectionSettings());
const q=require('util').promisify(db.query).bind(db);
(async()=>{try {
 const book=(await q("SELECT * FROM books WHERE alias='lulu-marjan' AND `virtual`=1"))[0];
 const toc=await q('SELECT * FROM toc WHERE bookId=? ORDER BY ordinal,id',[book.id]);
 const rows=await q('SELECT * FROM hadiths_virtual WHERE bookId=? ORDER BY ordinal,id',[book.id]);
 const mapping=[],ordered=[];
 for(const parent of toc.filter(t=>t.level===1).sort((a,b)=>a.h1-b.h1)) {
  ordered.push(parent);
  const sections=toc.filter(t=>t.level===2&&t.h1===parent.h1).sort((a,b)=>parent.h1===0?a.ordinal-b.ordinal||a.id-b.id:a.start0-b.start0||a.ordinal-b.ordinal);
  sections.forEach((t,i)=>{ordered.push(t);mapping.push({id:t.id,h1:t.h1,oldH2:t.h2,h2:parent.h1===0?t.h2:i+1});});
 }
 assert.equal(ordered.length,toc.length,'Unexpected nested headings');
 const backup=`temp/lulu-marjan-renumber-before-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;
 fs.writeFileSync(backup,JSON.stringify({book,toc,hadiths_virtual:rows},null,2));
 fs.writeFileSync('temp/lulu-marjan-section-number-map.json',JSON.stringify(mapping,null,2));
 await q('START TRANSACTION');
 try {
  const first=Number((await q('SELECT MAX(ordinal)+1 n FROM toc'))[0].n);
  await q(`UPDATE toc SET ordinal=CASE id ${ordered.map((t,i)=>`WHEN ${t.id} THEN ${first+i}`).join(' ')} END WHERE bookId=${book.id}`);
  const numbered=mapping.filter(m=>m.h1>0);
  await q(`UPDATE toc SET h2=CASE id ${numbered.map(m=>`WHEN ${m.id} THEN ${m.h2}`).join(' ')} END,lastmod=CURRENT_TIMESTAMP(),lastfixed=CURRENT_TIMESTAMP(),lastmod_user='renumber:lulu-marjan' WHERE bookId=${book.id} AND level=2 AND h1>0`);
  await q(`UPDATE hadiths_virtual h JOIN toc t ON t.id=h.tocId SET h.h2=t.h2 WHERE h.bookId=${book.id} AND t.level=2 AND t.h1>0`);
  const after=await q('SELECT * FROM hadiths_virtual WHERE bookId=? ORDER BY ordinal,id',[book.id]);
  const withoutSection=rs=>rs.map(({h2,lastmod,...r})=>r);
  assert.deepEqual(withoutSection(after),withoutSection(rows),'Hadith content or references changed');
  const saved=await q('SELECT * FROM toc WHERE bookId=? ORDER BY ordinal,id',[book.id]);
  for(const parent of saved.filter(t=>t.level===1&&t.h1>0)) {
   const sections=saved.filter(t=>t.level===2&&t.h1===parent.h1);
   assert.deepEqual(sections.map(t=>t.h2),sections.map((_,i)=>i+1));
  }
  for(const t of toc) {const changed=saved.find(s=>s.id===t.id);assert.equal(changed.intro,t.intro);assert.equal(changed.intro_en,t.intro_en);}
  await q('UPDATE books SET content_lastmod=CURRENT_TIMESTAMP() WHERE id=?',[book.id]);
  await q('COMMIT');
 }catch(e){await q('ROLLBACK');throw e;}
 console.log(JSON.stringify({backup,sections:mapping.filter(m=>m.h1>0).length,changed:mapping.filter(m=>m.oldH2!==m.h2).length,hadithLinksPreserved:rows.length}));
 await q('CALL refresh_v_hadiths_virtual_snapshot(?)',[book.id]);
 const mismatch=await q('SELECT COUNT(*) n FROM v_hadiths_virtual_snapshot s JOIN hadiths_virtual h ON h.bookId=s.book_id AND h.num=s.num WHERE h.bookId=? AND NOT(s.h2 <=> h.h2)',[book.id]);
 assert.equal(mismatch[0].n,0);
 console.log('Snapshot section numbers verified.');
}finally{db.end();}})().catch(e=>{console.error(e);process.exitCode=1;});
