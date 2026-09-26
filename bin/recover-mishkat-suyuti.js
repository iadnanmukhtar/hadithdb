#!/usr/bin/env node
'use strict';
const fs=require('fs'),crypto=require('crypto');
const {normalize,narratorMatches}=require('./recover-mishkat-text-matches');
const {canonical}=require('./recover-mishkat-text-pass2');
const {entryExtract}=require('./recover-mishkat-shuab');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const patterns={
 bukhari:/البخاري(?! في (?:الادب|التاريخ|تاريخه))/,muslim:/(^| )مسلم( |$)/,abudawud:/اب[وي] داود(?! الطيالسي)/,tirmidhi:/الترمذي(?! في الشمايل)/,
 ibnmajah:/ابن ماجه/,nasai:/النسايي(?! في (?:الكبري|عمل اليوم))/,ahmad:/احمد(?! في الزهد)/,darimi:/الدارمي/,malik:/(^| )مالك( |$)|الموطا/,daraqutni:/الدارقطني/,
 hakim:/الحاكم|\[ك\]/,ibnhibban:/ابن حبان/,shuab:/شعب الايمان|في الشعب|\[هب\]/,
 'sharh-sunnah':/شرح السنه/,'bayhaqi-dua':/الدعوات/,'bayhaqi-dalail':/البيهقي في (?:كتاب )?(?:دلايل|الدلايل)/,'bayhaqi-bath':/البعث والنشور|البيهقي في البعث/,'bayhaqi-madkhal':/المدخل/,
 hilya:/الحليه|حليه الاوليا/,'shamail':/الشمايل/,'nasai-kubra':/النسايي في الكبري/,'adab':/الادب المفرد/,'ahmad-zuhd':/احمد في الزهد/,
 razin:/رزين/,shafii:/الشافعي/,'bayhaqi-unspecified':/البيهقي/,
 bayhaqi:/البيهقي في (?:السنن|سننه)|\[ق\]/
};
function sourceKeys(h){
 const n=normalize(h.text),out=new Set(h.sources||[]);
 for(const k of ['sharh-sunnah','bayhaqi-dua','bayhaqi-dalail','bayhaqi-bath','bayhaqi-madkhal','hilya','shamail','nasai-kubra','adab','ahmad-zuhd','razin','shafii'])if(patterns[k].test(n))out.add(k);
 if(/رواه البيهقي\s*$/.test(n)&&![...out].some(k=>k==='shuab'||k.startsWith('bayhaqi')))out.add('bayhaqi-unspecified');
 return [...out].filter(k=>patterns[k]);
}
function footerEvidence(h,c){
 const raw=String(c.footnote||''),n=normalize(raw).split(/ عن | من حديث /u)[0];if(!n)return null;
 const keys=sourceKeys(h).filter(k=>patterns[k].test(n));
 const unvocalized=raw.normalize('NFKD').replace(/[\u064b-\u065f\u0670\u06d6-\u06edـ]/gu,'');
 const start=unvocalized.search(/(?:عن|من حديث) /u);
 const narratorText=start<0?'':unvocalized.slice(start).split(/\[[^\]]+\]|[()]/u)[0];
 return keys.length?{sourceKeys:keys,footer:raw,narratorText,footerSha256:sha(raw)}:null;
}
function eligible(h){return !h.links.length&&h.numbers.length===1;}
const reviewedPath='docs/imports/mishkat-suyuti-reviewed.json';
const reviewed=fs.existsSync(reviewedPath)?JSON.parse(fs.readFileSync(reviewedPath)):[];
const reviewedByNumber=new Map();
for(const row of reviewed){if(!reviewedByNumber.has(row.number))reviewedByNumber.set(row.number,new Map());reviewedByNumber.get(row.number).set(row.id,row);}
function exactEvidence(h,c){
 if(c.alias!=='suyuti'||c.bookId!==1000)return null;
 const foot=footerEvidence(h,c);if(!foot)return null;
 const approved=reviewedByNumber.get(h.number)?.get(c.id);
 if(approved&&approved.sourceTextSha256===sha(h.text)&&approved.targetSha256===sha(JSON.stringify([c.id,c.bookId,c.num,c.chain,c.body,c.text]))&&approved.footerSha256===foot.footerSha256)return {...foot,method:'reviewed-suyuti-footer-match',note:approved.note,differences:approved.differences};
 const e=entryExtract(h),segments=e.segments.map(canonical),words=segments.reduce((n,s)=>n+s.split(' ').length,0),body=canonical(c.body).replace(/ /g,'');
 if(words<8||!segments.length||!narratorMatches(e.narrator,normalize(foot.narratorText))||!segments.every(s=>body.includes(s.replace(/ /g,''))))return null;
 return {...foot,method:'suyuti-exact-body-narrator-footer',narrator:e.narrator,segments,words};
}
async function main(){
 if(process.argv.includes('--fetch-corpus')){
  require('dotenv').config();
  const mysql=require('mysql'),util=require('util');
  const db=mysql.createConnection(require('./initializeHadithAttributions').connectionSettings()),q=util.promisify(db.query).bind(db);
  try {const rows=await q("SELECT h.id,h.bookId,h.num,h.chain,h.body,h.text,h.footnote FROM hadiths h JOIN books b ON b.id=h.bookId WHERE b.alias='suyuti' ORDER BY h.id");
   if(!rows.length||rows.some(c=>c.bookId!==1000))throw Error('Unexpected Suyuti corpus');
   fs.writeFileSync('temp/mishkat-suyuti-corpus.json',JSON.stringify(rows));console.log({records:rows.length});return;
  }finally{db.end();}
 }

 const bytes=fs.readFileSync('temp/mishkat-import-review.json'),r=JSON.parse(bytes),corpus=JSON.parse(fs.readFileSync('temp/mishkat-suyuti-corpus.json')),byId=new Map(),grams=new Map();
 for(const c of corpus){c.alias='suyuti';c.normal=canonical(c.body);c.compact=c.normal.replace(/ /g,'');byId.set(c.id,c);const w=c.normal.split(' ');for(let j=0;j<w.length-3;j++){const g=w.slice(j,j+4).join(' ');if(!grams.has(g))grams.set(g,new Set());grams.get(g).add(c.id);}}
 const recovered=[],pending=[];
 for(const h of r.entries.filter(h=>!h.links.length)){
  const e=entryExtract(h),w=canonical(e.segments.join(' ')||e.raw).split(' '),votes=new Map();for(let j=0;j<w.length-3;j++)for(const id of grams.get(w.slice(j,j+4).join(' '))||[])votes.set(id,(votes.get(id)||0)+1);
  const ranked=[...votes].sort((a,b)=>b[1]-a[1]).slice(0,12).map(([id,hits])=>{const c=byId.get(id);return {id,ref:'suyuti:'+c.num,hits,footerSupported:!!footerEvidence(h,c),body:c.body,footer:c.footnote};});
  const anchor=canonical(e.segments.slice().sort((a,b)=>b.length-a.length)[0]||'').replace(/ /g,'');const matches=[];
  if(eligible(h)){for(const c of corpus){if(!reviewedByNumber.get(h.number)?.has(c.id)&&(!anchor||!c.compact.includes(anchor)))continue;const ev=exactEvidence(h,c);if(ev)matches.push({c,ev});}}
  const manual=matches.filter(x=>reviewedByNumber.get(h.number)?.has(x.c.id));const equivalent=matches.length>1&&new Set(matches.map(x=>x.c.normal)).size===1;
  matches.sort((a,b)=>a.c.num.localeCompare(b.c.num,'en',{numeric:true}));const chosen=manual.length===1?manual[0]:matches.length===1||equivalent?matches[0]:null;
  let links=[];if(chosen){const {c,ev}=chosen;if(equivalent)ev.equivalentReferences=matches.map(x=>'suyuti:'+x.c.num);links=[{id:c.id,ref:'suyuti:'+c.num,evidence:ev,targetSha256:sha(JSON.stringify([c.id,c.bookId,c.num,c.chain,c.body,c.text])),footerSha256:sha(c.footnote)}];}
  const item={number:h.number,headingKey:h.headingKey,text:h.text,sources:h.sources,links,reasons:[{alias:'suyuti',reason:h.numbers.length>1?'grouped-report':matches.length>1&&!chosen?'multiple-matches':!sourceKeys(h).length?'source-citation-unresolved':links.length?'matched':'needs-review',candidates:ranked.slice(0,5),exactCandidates:matches.map(x=>'suyuti:'+x.c.num)}]};(links.length?recovered:pending).push(item);
 }
 const result={sourceSha256:r.sha256,baseReportSha256:sha(bytes),stats:{examined:recovered.length+pending.length,recovered:recovered.length,links:recovered.length,pending:pending.length},recovered,pending};fs.writeFileSync('temp/mishkat-suyuti-recovery.json',JSON.stringify(result,null,2));console.log(result.stats);
}
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});module.exports={sourceKeys,footerEvidence,eligible,exactEvidence};
