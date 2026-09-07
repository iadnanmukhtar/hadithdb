#!/usr/bin/env node
'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const cheerio = require('cheerio');
const mysql = require('mysql');
const util = require('util');
const similarity = require('string-similarity').compareTwoStrings;
const { connectionSettings } = require('./initializeHadithAttributions');
const clean = s => String(s || '').replace(/\s+/gu, ' ').trim();
const normalize = s => clean(String(s || '').normalize('NFKD').replace(/[\u064b-\u065f\u0670\u06d6-\u06edـ]/gu, '').replace(/صلى الله عليه وسلم|ﷺ/gu, ' ').replace(/[إأآٱ]/gu, 'ا').replace(/ى/gu, 'ي').replace(/ة/gu, 'ه').replace(/[^\p{L}\p{N} ]/gu, ' '));
// Reviewed exceptions: incorrect printed location (378, 707, 1743), a heading
// swallowed into the footer (601), abbreviated local heading (654), and the
// composite report 950, split into four consecutive local records.
const OVERRIDES = new Map([[378,['560']],[601,['1421']],[654,['5302']],[707,['1904']],[950,['5334','5335','5336','5337']],[1743,['5196']]]);
const NEW_CHAPTER_EN = new Map([[1009,'The prohibition of selling surplus water'],[1352,'Discarding a gold ring'],[1880,'The prohibition of showing off'],[1881,'Guarding the tongue']]);
const normalizedCache=new Map();
function norm(s){if(!normalizedCache.has(s))normalizedCache.set(s,normalize(s));return normalizedCache.get(s);}
function score(a,b) {
 a=norm(a);b=norm(b); const words=a.split(' ').filter(w=>w.length>2),set=new Set(b.split(' '));
 return Math.max(similarity(a,b),words.length ? words.filter(w=>set.has(w)).length/words.length*0.9:0);
}
function parse() {
 const epub=path.resolve('temp',fs.readdirSync('temp').find(x=>x.normalize('NFC')==='اللؤلؤ والمرجان.epub'));
 const zip=new AdmZip(epub), $=cheerio.load(zip.readAsText('OEBPS/toc.ncx'),{xmlMode:true});
 const headings=[];
 $('navPoint').each((i,e)=>{const file=Number(($(e).children('content').attr('src')||'').match(/P(\d+)\.xhtml/)?.[1]);if(file>=9)headings.push({file,title:clean($(e).children('navLabel').text()),level:$(e).parents('navPoint').length+1});});
 const hadiths=[];let current;
 const opf=cheerio.load(zip.readAsText('OEBPS/content.opf'),{xmlMode:true});
 const manifest=new Map(opf('manifest item').toArray().map(e=>[opf(e).attr('id'),'OEBPS/'+opf(e).attr('href')]));
 for(const e of opf('spine itemref').toArray()) {
  const name=manifest.get(opf(e).attr('idref'));if(!name)throw Error('Missing spine entry');const file=Number(name.match(/P(\d+)\.xhtml/)?.[1]);if(!(file>=9)||file===2922)continue;
  const p=cheerio.load(zip.readAsText(name),{xmlMode:true}),container=p('#book-container');
  const marker=container.find('span.red').first(),m=clean(marker.text()).match(/^(\d+)\s*-/u);
  if(m){current={number:Number(m[1]),file,text:'',footer:''};hadiths.push(current);marker.remove();}
  else if(headings.some(h=>h.file===file)){current=null;continue;}
  if(!current){headings.push({file,title:clean(container.text()),level:2});headings.sort((a,b)=>a.file-b.file);continue;}
  container.find('.footnote').each((i,e)=>{
   const clone=p(e).clone();clone.find('br').replaceWith('\n');
   const lines=clone.text().split(/\n+/u).map(clean).filter(Boolean);
   current.footer=clean(current.footer+' '+(lines.shift()||''));
   const title=clean(lines.join(' ').replace(/\[ص:\s*\d+\]/gu,''));
   if(title)headings.push({file:file+0.1,title,level:2});
  });
  container.find('.footnote,.footnote-hr,hr').remove();container.find('br').replaceWith('\n');
  current.text=clean(current.text+' '+container.text());
 }
 if(hadiths.length!==1907 || new Set(hadiths.map(h=>h.number)).size!==1906 || hadiths.at(-1).number!==1906)throw Error('Expected 1906 numbered hadiths with two source excerpts for 1469');
 for(const h of hadiths){const at=h.text.search(/[أا]خر[جح]ه(?:ما)? (?:البخاري|الخباري)/u);if(at>=0){h.footer=clean(h.footer+' '+h.text.slice(at));h.text=clean(h.text.slice(0,at));}h.text=clean(h.text.replace(/\[ص:\s*\d+\]/gu,''));}
 const misplaced=hadiths.find(h=>h.number===1678);const boundary=misplaced.text.indexOf('أَمْرِ مَنْ مَرَّ');if(boundary<0)throw Error('Missing embedded heading boundary');headings.push({file:misplaced.file+0.1,title:clean(misplaced.text.slice(boundary)),level:2});misplaced.text=clean(misplaced.text.slice(0,boundary));headings.sort((a,b)=>a.file-b.file);
 for(const h of headings)h.start=hadiths.find(x=>x.file>h.file)?.number;
 return {epub,hadiths,headings};
}
async function main(){
 const source=parse(),db=mysql.createConnection(connectionSettings()),q=util.promisify(db.query).bind(db);
 try {
 const book=(await q("SELECT * FROM books WHERE alias='lulu-marjan' AND `virtual`=1"))[0];if(!book)throw Error('Missing virtual book');
 const toc=await q('SELECT * FROM toc WHERE bookId=? ORDER BY ordinal,id',[book.id]);
 const originalToc=JSON.parse(JSON.stringify(toc));
 const corpus=await q("SELECT h.*,t.title chapterTitle FROM hadiths h JOIN books b ON h.bookId=b.id LEFT JOIN toc t ON t.id=h.tocId WHERE b.alias='bukhari'");
 const sourceToc=await q("SELECT * FROM toc WHERE bookId=(SELECT id FROM books WHERE alias='bukhari') ORDER BY ordinal");
 fs.writeFileSync('temp/lulu-source-corpus.json',JSON.stringify({corpus,sourceToc,toc}));
 const existing=await q('SELECT * FROM hadiths_virtual WHERE bookId=? ORDER BY ordinal,id',[book.id]);
 const additions=[];
 for(const [start,h1,h2,title] of [[706,13,29,'حفظ اللسان للصائم'],[1009,22,8,'تحريم بيع فضل الماء'],[1132,32,4,'تحريم الغدر'],[1352,37,11,'في طرح خاتم الذهب'],[1880,54,6,'تحريم الرياء'],[1881,54,7,'حفظ اللسان']]){
  const found=toc.find(t=>t.h1===h1&&t.h2===h2);if(found){found.start=String(start);found.start0=start;}else{const t={id:-start,bookId:book.id,level:2,h1,h2,h3:null,title:'باب '+title,title_en:NEW_CHAPTER_EN.get(start)||null,start:String(start),start0:start};additions.push(t);toc.push(t);}
 }
 // These chapter titles are embedded after hadith footers/body text, absent
 // from the EPUB NCX and the old local TOC. Preserve those source boundaries.
 const embeddedChapters=[
  [36,1,26,'Faith decreases through sins'],
  [325,5,15,'The permissibility of praying in shoes'],
  [326,5,16,'The dislike of praying in a garment with markings'],
  [327,5,17,'The dislike of praying when food is ready'],
  [353,5,31,'Whoever catches one rakah has caught the prayer'],
  [602,12,26,'The reward of the trustworthy keeper and a wife who gives charity'],
  [632,12,47,'Giving to those whose hearts are reconciled to Islam'],
  [1245,33,43,'Actions are judged by intentions'],
  [1249,33,52,'A group of this nation will remain upon the truth'],
  [1287,35,5,'The abrogation of the prohibition on keeping sacrificial meat'],
  [1316,36,16,'Breathing outside the drinking vessel three times'],
  [1637,44,47,'The virtues of Ghifar, Aslam, Juhaynah and other tribes'],
  [1679,45,33,'Holding the points of weapons in public places']
 ];
 for(const [start,h1,h2,title_en] of embeddedChapters){
  const heading=source.headings.find(h=>h.start===start&&h.level===2);if(!heading)throw Error(`Missing embedded source heading ${start}`);
  const found=toc.find(t=>t.h1===h1&&t.h2===h2);
  if(found){if(score(heading.title,found.title)<0.5)throw Error(`Embedded chapter conflicts with existing heading ${start}`);found.start=String(start);found.start0=start;}
  else{const t={id:-start,bookId:book.id,level:2,h1,h2,h3:null,title:'باب '+heading.title,title_en,start:String(start),start0:start};additions.push(t);toc.push(t);}
 }
 const problems=[],reviews=[],rows=[];
 for(const h of source.hadiths){
  const footer=norm(h.footer),bookCitation=footer.match(/(?:في )?(\d+)?\s*كتاب (.*?)(?= \d+ | باب |$)/u);
  let bookNumber=Number(bookCitation?.[1])||null;
  if(bookCitation){const bookTitles=sourceToc.filter(t=>t.level===1).map(t=>({t,s:score(bookCitation[2],norm(t.title).replace(/^كتاب /,''))})).sort((a,b)=>b.s-a.s);if(bookTitles[0]?.s>=0.75)bookNumber=Number(bookTitles[0].t.h1);}
  const printedBook=Number(footer.match(/(?:في )?(\d+) كتاب/u)?.[1])||bookNumber;
  const chapterTitle=footer.includes(' باب ')?footer.split(' باب ').slice(1).join(' باب '):footer.replace(/^.*?كتاب /,'').replace(/^.*?\d+ /,'');
  const chapterRanks=sourceToc.filter(t=>t.level>=2&&Number(t.h1)===bookNumber).map(t=>({t,s:score(chapterTitle,norm(t.title).replace(/^باب /,''))})).sort((a,b)=>b.s-a.s);
  const allowed=chapterRanks.filter(t=>t.s>=Math.max(0.48,(chapterRanks[0]?.s||0)-0.04));
  let pool=corpus.filter(c=>allowed.some(t=>t.t.id===c.tocId));
  if(!pool.length)pool=corpus.filter(c=>!bookNumber||Number(c.h1)===bookNumber);
  if(bookNumber&&printedBook&&bookNumber!==printedBook)pool=corpus.filter(c=>[bookNumber,printedBook].includes(Number(c.h1)));
  if(!h.footer){const prior=corpus.filter(c=>existing.some(x=>Number(x.num0)===h.number&&x.hadithId===c.id));if(prior.length===1&&Math.max(score(h.text,prior[0].text),score(h.text,prior[0].body),score(h.text,prior[0].footnote))>=0.7)pool=prior;}
  const initialBest=Math.max(...pool.map(c=>Math.max(score(h.text,c.body),score(h.text,c.chain+' '+c.body+' '+c.footnote),score(h.text,c.text),score(h.text,c.footnote))));
  if(initialBest<0.64&&allowed.length){const near=sourceToc.filter(t=>allowed.some(a=>Math.abs(t.ordinal-a.t.ordinal)<=2)&&Number(t.h1)===bookNumber);pool=corpus.filter(c=>near.some(t=>t.id===c.tocId));}
  const candidates=pool.map(c=>({c,score:Math.max(score(h.text,c.body),score(h.text,c.chain+' '+c.body+' '+c.footnote),score(h.text,c.text),score(h.text,c.footnote))})).sort((a,b)=>b.score-a.score);
  if(!candidates.length){problems.push({number:h.number,footer:h.footer});continue;}
  let chosen=candidates[0];
  if(OVERRIDES.has(h.number)){const c=corpus.find(c=>c.num===OVERRIDES.get(h.number)[0]);if(!c)throw Error('Missing reviewed match');chosen={c,score:Math.max(score(h.text,c.text),score(h.text,c.body),score(h.text,c.footnote))};}
  const old=existing.filter(x=>Number(x.num0)===h.number);
  const corroborated=old.some(x=>x.hadithId===chosen.c.id);
  if(!OVERRIDES.has(h.number)&&(chosen.score<0.64 || (!corroborated&&candidates[1]&&chosen.score-candidates[1].score<0.045)))reviews.push({number:h.number,footer:h.footer,text:h.text,corroborated,candidates:candidates.slice(0,3).map(x=>({num:x.c.num,h1:x.c.h1,h2:x.c.h2,title:x.c.chapterTitle,score:x.score,chain:x.c.chain,body:x.c.body}))});
  const heading=source.headings.filter(x=>x.file<h.file).at(-1);
  const matchingToc=toc.filter(t=>Number(t.start0)===heading.start&&Number(t.level)===(heading.file===9||heading.file===2175?2:heading.level));
  const ranked=matchingToc.map(t=>({t,score:score(heading.title,t.title+' '+(t.intro||''))})).sort((a,b)=>b.score-a.score);
  if(!ranked.length){problems.push({number:h.number,heading});continue;}
  let t=ranked[0].t;
  // Keep the established placeholder section for this otherwise unsectioned book.
  if(t.level===1&&t.h1===50)t=toc.find(x=>x.h1===50&&x.h2===1&&x.level===2);
  if(!t)throw Error('Missing placeholder chapter');
  rows.push({...h,tocId:t.id,h1:t.h1,h2:t.h2,h3:t.h3,hadithId:chosen.c.id,ref_num:'bukhari:'+chosen.c.num,score:chosen.score});
  for(const num of (OVERRIDES.get(h.number)||[]).slice(1)){const c=corpus.find(c=>c.num===num);if(!c)throw Error('Missing composite match');rows.push({...h,text:null,footer:null,tocId:t.id,h1:t.h1,h2:t.h2,h3:t.h3,hadithId:c.id,ref_num:'bukhari:'+num,score:null});}
 }
 if(rows.length===1910){for(const t of toc){if(!rows.some(r=>t.level===1?r.h1===t.h1:r.tocId===t.id))problems.push({emptyChapter:t.id,title:t.title});}}
 const report={missingFooters:source.hadiths.filter(h=>!h.footer).map(h=>h.number),reviewedOverrides:Object.fromEntries(OVERRIDES),epub:source.epub,stats:{source:source.hadiths.length,headings:source.headings.length,existing:existing.length,rows:rows.length,problems:problems.length,reviews:reviews.length},problems,reviews,rows};
 fs.writeFileSync('temp/lulu-marjan-import-review.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report.stats));console.log(JSON.stringify(problems.slice(0,15),null,2));
 if(!process.argv.includes('--apply'))return;
 if(problems.length||reviews.length)throw Error('Unresolved import review');
 const stamp=new Date().toISOString().replace(/[:.]/g,'-');
 const backup=path.resolve('temp',`lulu-marjan-before-${stamp}.json`);
 const grader=(await q('SELECT * FROM graders WHERE id=58'))[0];
 if(!grader || !norm(grader.name).includes('عبد الباقي'))throw Error('Grader 58 is not Abd al-Baqi');
 const affectedIds=[...new Set([...rows.map(r=>r.hadithId),...existing.map(r=>r.hadithId)].filter(Boolean))];
 const physical=await q('SELECT * FROM hadiths WHERE id IN (?) OR graderId=58',[affectedIds]);
 const affectedBooks=await q('SELECT DISTINCT bookId FROM hadiths_virtual WHERE hadithId IN (?)',[physical.map(h=>h.id)]);
 fs.writeFileSync(backup,JSON.stringify({book,graders:[grader],toc:originalToc,hadiths_virtual:existing,hadiths:physical},null,2)+'\n');
 await q('START TRANSACTION');
 try {
  for(const t of additions){const oldId=t.id;const result=await q('INSERT INTO toc SET ?', {bookId:book.id,level:t.level,h1:t.h1,h2:t.h2,title:t.title,title_en:t.title_en,start:t.start,start0:t.start0,lastmod_user:'epub:lulu-marjan'});t.id=result.insertId;rows.filter(r=>r.tocId===oldId).forEach(r=>r.tocId=t.id);}
  await q('DELETE FROM hadiths_virtual WHERE bookId=?',[book.id]);
  const counts=new Map(),duplicates=new Map();rows.forEach(h=>duplicates.set(h.number,(duplicates.get(h.number)||0)+1));const occurrences=new Map();
  const values=rows.map((r,i)=>{const inChapter=(counts.get(r.tocId)||0)+1;counts.set(r.tocId,inChapter);const occurrence=(occurrences.get(r.number)||0)+1;occurrences.set(r.number,occurrence);const multiple=duplicates.get(r.number)>1;return [i+1,book.id,r.tocId,inChapter,r.h1,r.h2,r.h3,multiple?`${r.number}${String.fromCharCode(96+occurrence)}`:String(r.number),multiple?r.number+occurrence/1000:r.number,r.hadithId,r.ref_num,r.text,'bukhari',1,r.footer||null,'epub:lulu-marjan'];});
  await q('INSERT INTO hadiths_virtual (ordinal,bookId,tocId,numInChapter,h1,h2,h3,num,num0,hadithId,ref_num,textActual,bookActual,muttafaq,note,lastmod_user) VALUES ?',[values]);
  const orderedToc=toc.slice().sort((a,b)=>a.h1-b.h1||a.level-b.level||a.h2-b.h2||a.h3-b.h3);
  const firstOrdinal=Number((await q('SELECT MAX(ordinal)+1 n FROM toc'))[0].n);
  for(let i=0;i<orderedToc.length;i++){const t=orderedToc[i],members=rows.filter(r=>t.level===1?r.h1===t.h1:r.tocId===t.id);if(!members.length)throw Error(`Empty imported chapter ${t.id}`);
   await q('UPDATE toc SET ordinal=?,start=?,start0=?,end=?,end0=?,count=?,lastmod=CURRENT_TIMESTAMP(),lastfixed=CURRENT_TIMESTAMP(),lastmod_user=? WHERE id=?',[firstOrdinal+i,String(members[0].number),members[0].number,String(members.at(-1).number),members.at(-1).number,members.length,'epub:lulu-marjan',t.id]);
  }
  await q('UPDATE graders SET shortName=?,shortName_en=? WHERE id=58',['عبد الباقي','ʿAbd al-Bāqī']);
  await q('UPDATE hadiths SET gradeId=50,graderId=58,lastmod=CURRENT_TIMESTAMP(),lastfixed=CURRENT_TIMESTAMP(),lastmod_user=? WHERE id IN (?)',['epub:lulu-marjan',[...new Set(rows.map(r=>r.hadithId))]]);
  await q("UPDATE hadiths SET books=NULLIF(TRIM(REPLACE(COALESCE(books,''),'{lulu-marjan}','')),'') WHERE id IN (?)",[affectedIds]);
  await q("UPDATE hadiths SET books=CONCAT(COALESCE(books,''),'{lulu-marjan}') WHERE id IN (?)",[[...new Set(rows.map(r=>r.hadithId))]]);
  await q('UPDATE books SET content_lastmod=CURRENT_TIMESTAMP() WHERE id IN (?)',[[book.id,...new Set(physical.map(r=>r.bookId))]]);
  const check=(await q('SELECT COUNT(*) n,COUNT(DISTINCT num) uniqueNums,COUNT(DISTINCT FLOOR(num0)) numbered FROM hadiths_virtual WHERE bookId=?',[book.id]))[0];
  if(check.n!==1910||check.uniqueNums!==1910||check.numbered!==1906)throw Error('Post-insert counts failed');
  await q('COMMIT');
 }catch(e){await q('ROLLBACK');throw e;}
 for(const id of new Set([book.id,...affectedBooks.map(r=>r.bookId)]))await q('CALL refresh_v_hadiths_virtual_snapshot(?)',[id]);
 console.log(JSON.stringify({applied:rows.length,backup,refreshedVirtualBooks:affectedBooks.map(r=>r.bookId)}));

 }finally{db.end();}
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={parse,norm,score};
