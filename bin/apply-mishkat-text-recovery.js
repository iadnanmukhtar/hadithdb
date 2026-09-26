#!/usr/bin/env node
'use strict';
require('dotenv').config();
const fs=require('fs'),crypto=require('crypto'),mysql=require('mysql'),util=require('util');
const {isTextRejection}=require('./recover-mishkat-text-matches');
const pass2=process.argv.includes('--pass2'),shuab=process.argv.includes('--shuab'),suyuti=process.argv.includes('--suyuti'),variants=process.argv.includes('--variants'),narrators=process.argv.includes('--narrators'),priority=process.argv.includes('--priority')||narrators;
if([pass2,shuab,suyuti,variants,priority].filter(Boolean).length>1)throw Error('Select only one recovery mode');
const priorityMatcher=priority?require(narrators?'./recover-mishkat-narrators':'./recover-mishkat-priority'):null;
const variantsMatcher=variants?require('./recover-mishkat-variants'):null;
const suyutiMatcher=suyuti?require('./recover-mishkat-suyuti'):null;
const shuabMatcher=shuab?require('./recover-mishkat-shuab'):null;
const {exactEvidence}=require(narrators?'./recover-mishkat-narrators':priority?'./recover-mishkat-priority':variants?'./recover-mishkat-variants':suyuti?'./recover-mishkat-suyuti':shuab?'./recover-mishkat-shuab':pass2?'./recover-mishkat-text-pass2':'./recover-mishkat-text-matches');
const artifact=narrators?'mishkat-narrator-recovery':priority?'mishkat-priority-recovery':variants?'mishkat-variants-recovery':suyuti?'mishkat-suyuti-recovery':shuab?'mishkat-shuab-recovery':pass2?'mishkat-text-pass2':'mishkat-text-recovery';
const {norm,parse}=require('./import-mishkat-epub');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
async function main(){
 const planBytes=fs.readFileSync(`temp/${artifact}.json`),plan=JSON.parse(planBytes),planSha=sha(planBytes);
 const db=mysql.createConnection(require('./initializeHadithAttributions').connectionSettings()),q=util.promisify(db.query).bind(db);
 try {
 const book=(await q("SELECT * FROM books WHERE alias='mishkat' AND `virtual`=1"))[0];if(!book)throw Error('Missing virtual Mishkat book');
 const props=typeof book.properties==='string'?JSON.parse(book.properties):book.properties;
 const existing=await q('SELECT * FROM hadiths_virtual WHERE bookId=? ORDER BY ordinal,id',[book.id]);
 if(props.mishkatTextRecovery?.planSha256===planSha){for(const h of plan.recovered)for(const l of h.links)if(!existing.some(x=>Math.floor(x.num0)===h.number&&x.hadithId===l.id))throw Error('Applied recovery is incomplete');console.log(JSON.stringify({unchanged:true,bookId:book.id}));return;}
 const baseBytes=fs.readFileSync('temp/mishkat-import-review.json'),report=JSON.parse(baseBytes),originalReport=JSON.parse(baseBytes);
 if(variants)report.entries=variantsMatcher.splitEntries(report.entries);
 const byNumber=new Map(report.entries.map(h=>[h.number,h]));
 if(sha(baseBytes)!==plan.baseReportSha256||parse().sha256!==plan.sourceSha256)throw Error('Source or baseline report changed');
 if(priority)await priorityMatcher.validateBooks(q);
 const priorityBooks=priority?JSON.parse(fs.readFileSync('temp/mishkat-priority-books.json')):null;
 const ids=[...new Set(plan.recovered.flatMap(h=>h.links.map(l=>l.id)))];
 const targets=await q('SELECT h.*,b.alias FROM hadiths h JOIN books b ON b.id=h.bookId WHERE h.id IN (?)',[ids]),byId=new Map(targets.map(h=>[h.id,h]));
 for(const h of plan.recovered){const b=byNumber.get(h.number);if(!b||!(variants||priority?!b.links.length&&b.numbers.length===1:suyuti?suyutiMatcher.eligible(b):shuab?shuabMatcher.eligible(b,report.entries):isTextRejection(b))||b.text!==h.text||existing.some(x=>Math.floor(x.num0)===h.number))throw Error('Recovery would alter an existing or out-of-scope entry');for(const l of h.links){const c=byId.get(l.id);if(!c||!(priority?priorityMatcher.policy(b,priorityBooks).aliases.includes(c.alias):suyuti?c.alias==='suyuti'&&l.footerSha256===sha(c.footnote||''):shuab?c.alias===(shuabMatcher.citations(report.entries).get(b.number)?.alias||'shuab')&&shuabMatcher.citations(report.entries).has(b.number):b.sources.includes(c.alias))||l.ref!==`${c.alias}:${c.num}`||l.targetSha256!==sha(JSON.stringify([c.id,c.bookId,c.num,c.chain,c.body,c.text]))||!exactEvidence(suyuti||variants||priority?b:h,c))throw Error(`Invalid or changed match ${h.number} ${l.ref}`);}}
 const toc=await q('SELECT * FROM toc WHERE bookId=? ORDER BY ordinal,id',[book.id]);
 const key=h=>[h.level,h.h1,h.h2,h.h3].join(':'),tocByPosition=new Map(toc.map(h=>[key(h),h])),sourceHeadings=new Map(report.headings.map(h=>[h.key,h]));
 console.log(JSON.stringify({apply:process.argv.includes('--apply'),entries:plan.recovered.length,links:plan.stats.links}));if(!process.argv.includes('--apply'))return;
 const backup=`temp/${artifact}-before-${Date.now()}.json`;
 fs.writeFileSync(backup,JSON.stringify({book,toc,hadiths_virtual:existing,hadiths:targets,report:originalReport},null,2));
 await q('START TRANSACTION');
 try {
 let ordinal=Math.max(...existing.map(h=>h.ordinal));const values=[];
 for(const h of plan.recovered){const t=tocByPosition.get(key(sourceHeadings.get(h.headingKey)));if(!t)throw Error('Missing heading');for(const [i,l]of h.links.entries()){const multiple=h.links.length>1;values.push([++ordinal,book.id,t.id,0,t.h1,t.h2,t.h3,multiple?`${h.number}${String.fromCharCode(97+i)}`:String(h.number),multiple?h.number+(i+1)/1000:h.number,l.id,l.ref,i===0?h.text:null,i===0?l.ref.split(':')[0]:null,i===0&&norm(h.text).includes('متفق عليه')?1:null,byNumber.get(h.number).footnote||null,'epub:mishkat-text']);}}
 for(let i=0;i<values.length;i+=100)await q('INSERT INTO hadiths_virtual (ordinal,bookId,tocId,numInChapter,h1,h2,h3,num,num0,hadithId,ref_num,textActual,bookActual,muttafaq,note,lastmod_user) VALUES ?',[values.slice(i,i+100)]);
 const rows=await q('SELECT id,tocId,h1,h2,h3,num,num0 FROM hadiths_virtual WHERE bookId=? ORDER BY num0,id',[book.id]);
 if(rows.length!==existing.length+values.length)throw Error('Row count mismatch');
 const chapterCounts=new Map();const ordering=rows.map((r,i)=>{const n=(chapterCounts.get(r.tocId)||0)+1;chapterCounts.set(r.tocId,n);return [r.id,i+1,n];});
 await q('CREATE TEMPORARY TABLE mishkat_recovery_order (id INT PRIMARY KEY, ordinal INT, numInChapter INT)');
 await q('INSERT INTO mishkat_recovery_order VALUES ?',[ordering]);
 await q('UPDATE hadiths_virtual hv JOIN mishkat_recovery_order r ON r.id=hv.id SET hv.ordinal=r.ordinal,hv.numInChapter=r.numInChapter WHERE hv.bookId=? AND (hv.ordinal<>r.ordinal OR hv.numInChapter<>r.numInChapter)',[book.id]);
 const bounds=toc.map(t=>{const members=rows.filter(r=>r.h1===t.h1&&(t.level===1||r.h2===t.h2&&(t.level===2||r.h3===t.h3)));return [t.id,members.length?String(Math.floor(members[0].num0)):null,members.length?Math.floor(members[0].num0):null,members.length?String(Math.floor(members.at(-1).num0)):null,members.length?Math.floor(members.at(-1).num0):null,members.length];});
 await q('CREATE TEMPORARY TABLE mishkat_recovery_bounds (id INT PRIMARY KEY, `start` VARCHAR(15),start0 DECIMAL(10,3),`end` VARCHAR(15),end0 DECIMAL(10,3),`count` INT)');await q('INSERT INTO mishkat_recovery_bounds VALUES ?',[bounds]);
 await q('UPDATE toc t JOIN mishkat_recovery_bounds b ON b.id=t.id SET t.start=b.start,t.start0=b.start0,t.end=b.end,t.end0=b.end0,t.count=b.count WHERE t.bookId=?',[book.id]);
 for(const h of plan.recovered){const b=byNumber.get(h.number);if(priority){b.priorityRecovery={scope:h.scope};if(h.scope.mode==='cited-books')b.sources=[...new Set([...b.sources,...h.scope.aliases])];}if(shuab){b.sources=[...new Set([...b.sources,...h.links.map(l=>l.ref.split(':')[0])])];b.sourceEvidence=h.sourceEvidence;}b.links=h.links;b.review=b.review.filter(x=>!h.links.some(l=>l.ref.startsWith(x.alias+':')));b.textRecovery={planSha256:planSha,methods:h.links.map(l=>l.evidence.method)};}
 if(priority)for(const h of plan.pending){const b=byNumber.get(h.number);b.priorityReview={scope:h.scope,reasons:h.reasons};}
 if(shuab)for(const h of plan.pending){const b=byNumber.get(h.number);b.sources=[...new Set([...b.sources,...h.reasons.map(x=>x.alias)])];b.sourceEvidence=h.sourceEvidence;b.review=b.review.filter(x=>!h.reasons.some(y=>y.alias===x.alias)).concat(h.reasons);}
 if(variants){report.stats.sourcePassages=originalReport.stats.sourcePassages||originalReport.stats.entries;report.stats.entries=report.entries.length;report.stats.linkedEntries=report.entries.filter(h=>h.links.length).length;report.stats.links=report.entries.reduce((n,h)=>n+h.links.length,0);report.stats.unlinked=report.entries.filter(h=>!h.links.length).length;}else{report.stats.linkedEntries+=plan.recovered.length;report.stats.links+=plan.stats.links;report.stats.unlinked-=plan.recovered.length;}
 const nextReport=JSON.stringify(report,null,2);
 props.mishkatImport.reportSha256=sha(nextReport);props.mishkatImport.importedEntries=report.stats.linkedEntries;props.mishkatImport.importedAliases=report.stats.links;
 props.mishkatTextRecovery={planSha256:planSha,entries:plan.recovered.length,links:plan.stats.links,backup};
 await q('UPDATE books SET properties=?,content_lastmod=CURRENT_TIMESTAMP() WHERE id=?',[JSON.stringify(props),book.id]);
 const final=await q('SELECT num,hadithId,ref_num,tocId,textActual FROM hadiths_virtual WHERE bookId=?',[book.id]),check=new Map(final.map(r=>[r.num,r]));
 for(const old of existing){const row=check.get(old.num);if(!row||row.hadithId!==old.hadithId||row.ref_num!==old.ref_num||row.tocId!==old.tocId||row.textActual!==old.textActual)throw Error('Existing alias changed');}
 await q('COMMIT');fs.writeFileSync('temp/mishkat-import-review.json',nextReport);
 }catch(e){await q('ROLLBACK');throw e;}
 await q('CALL refresh_v_hadiths_virtual_snapshot(?)',[book.id]);
 fs.writeFileSync(`temp/${artifact}-applied.json`,JSON.stringify({bookId:book.id,planSha256:planSha,backup,stats:report.stats},null,2));
 console.log(JSON.stringify({applied:true,bookId:book.id,backup,stats:report.stats}));
 }finally{db.end();}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
