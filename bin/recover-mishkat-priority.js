#!/usr/bin/env node
'use strict';
const fs=require('fs'),crypto=require('crypto');
const {canonical}=require('./recover-mishkat-text-pass2');
const {entryExtract}=require('./recover-mishkat-shuab');
const variants=require('./recover-mishkat-variants');
const {sourceKeys}=require('./recover-mishkat-suyuti');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const plain=s=>String(s).normalize('NFKD').replace(/[\u064b-\u065f\u0670\u06d6-\u06edـ]/gu,'');
const names={bukhari:/البخاري/,muslim:/مسلم/,abudawud:/اب[وي] داود/,tirmidhi:/الترمذي/,nasai:/النسايي|النسائي/,ibnmajah:/ابن ماجه/,darimi:/الدارمي/,ahmad:/احمد/,malik:/مالك|الموطا/,hakim:/الحاكم/,ibnhibban:/ابن حبان/,ibnkhuzaymah:/ابن خزيمه/,bazzar:/البزار/,daraqutni:/الدارقطني/,tayalisi:/الطيالسي/};
function policy(h,books){
 const n=canonical(h.text),keys=new Set([...h.sources,...(h.editorialCitationKeys||[]),...sourceKeys(h)]);
 const citationParts=[...n.matchAll(/(?:رواه|رواهما|روي|اخرجه|اخرجاه|زاد|وكذا|ولفظه ل|هذا لفظ|وفي روايه) (.{0,130})/g)].map(m=>m[1].split(/ عن | قال | وفيه | الا انه /)[0]).join(' ');
 for(const [alias,re]of Object.entries(names))if(re.test(citationParts))keys.add(alias);
 if(/لفظه للبخاري|لفظ البخاري/.test(n))keys.add('bukhari');
 if(keys.has('shamail'))keys.delete('tirmidhi');
 if(keys.has('nasai-kubra'))keys.delete('nasai');
 if(keys.has('adab'))keys.delete('bukhari');
 if(keys.has('ahmad-zuhd'))keys.delete('ahmad');
 const explicit=keys.size>0||/(?:رواه|رواهما|اخرجه|اخرجاه) (?:ال|ابن|ابو|ابي|احمد|رزين|في)|شرح السنه|في الدعوات|في المدخل/.test(n);
 if(explicit)return {mode:'cited-books',aliases:[...keys].filter(k=>books.some(b=>b.alias===k)),unavailable:[...keys].filter(k=>!books.some(b=>b.alias===k))};
 return {mode:'ordinal-fallback',aliases:books.filter(b=>b.ordinal>=100&&b.ordinal<=199&&!b.virtual).sort((a,b)=>a.ordinal-b.ordinal||a.id-b.id).map(b=>b.alias),unavailable:[]};
}
function extract(h,entries){
 if(h.splitNarrator)return variants.extraction(h);
 let raw=plain(h.text).replace(/^\[\d+\]\s*/,'').replace(/^\([^)]*\)\s*/,'');
 const e=entryExtract(h);let narrator=e.narrator;
 if(!narrator){const m=raw.match(/^(?:وفي رواية(?: عن)?|ورواه)\s+(.+?)(?=\s*(?:[:«"]|مع اختلاف|وفيه|رضي|قال))/);if(m)narrator=canonical(m[1]);}
 if(!narrator&&/^(?:وعنه|وعنها)\b/.test(raw)){
  const i=entries.findIndex(x=>x.number===h.number);for(let j=i-1;j>=Math.max(0,i-8);j--){if(entries[j].headingKey!==h.headingKey)break;const prior=entryExtract(entries[j]);if(prior.narrator){narrator=prior.narrator;break;}}
 }
 if(!narrator&&/^(?:والبيهقي|ورواه|رواه|وروي)/.test(raw))narrator=canonical(raw.match(/عن (.+?)(?= وكذا| الا انه| نحوه|$)/)?.[1]||'');
 let segments=[...raw.matchAll(/«([^»]+)»|"([^"]+)"/gu)].map(m=>canonical(m[1]||m[2])).filter(Boolean);
 const quotePositions=[...raw.matchAll(/"/g)].map(m=>m.index);
 if(quotePositions.length%2===1&&quotePositions.at(-1)<raw.length*.8){const fragment=raw.slice(quotePositions.at(-1)+1).split(/(?:رواه|رواهما|اخرجه) /)[0];if(fragment.trim())segments.push(canonical(fragment));}
 if(!segments.length){let matn=raw.replace(/(?<!و)(?:رواه|رواهما|اخرجه|اخرجاه) .*/s,'');matn=matn.replace(/^(?:وعن|عن) .+?(?:قالت|قال):?\s*/,'').replace(/^(?:قال |سمعت )?(?:رسول الله|النبي)(?: صلى الله عليه وسلم| ﷺ)?(?: يقول| قال)?\s*:?\s*/,'').replace(/["«»]/g,'').trim();if(matn&&canonical(matn).split(' ').length>=4&&matn!==raw&&narrator)segments=[canonical(matn)];}
 let contextNumber;
 if(!segments.length&&narrator&&/(?:ورواه|رواه|وروي|والبيهقي)|نحوه|اخصر منه/.test(raw)){
  const i=entries.findIndex(x=>x.number===h.number),prior=entries[i-1];if(prior&&prior.headingKey===h.headingKey){segments=entryExtract(prior).segments;contextNumber=prior.number;}
 }
 // Keep established extraction if quotation parsing would lose a complete unquoted matn.
 if(!segments.length||segments.join(' ').split(' ').length<8&&e.segments.join(' ').split(' ').length>=8)segments=e.segments;
 return {...e,narrator:narrator.replace(/ مرسلا$/,''),segments,contextNumber};
}
function evidence(h,c,entries,books){
 const scope=policy(h,books);if(!scope.aliases.includes(c.alias)||c.num&&!/^\d/.test(c.num))return null;
 const a=reviewed().find(a=>a.number===h.number&&a.id===c.id);
 if(a&&(!a.contextNumber||a.contextTextSha256===sha(entries.find(h=>h.number===a.contextNumber)?.text||''))&&a.sourceTextSha256===sha(h.text)&&a.targetSha256===sha(JSON.stringify([c.id,c.bookId,c.num,c.chain,c.body,c.text])))return {method:'reviewed-priority-match',score:1,sourceNarrator:a.narrator,note:a.note,scope,segments:[]};
 const e=extract(h,entries),n=variants.narratorEvidence(e.narrator,c);if(!n||!e.segments.length)return null;
 const segments=e.segments.map(s=>variants.bodyEvidence(s,c.body));if(segments.some(s=>!s))return null;
 const words=segments.reduce((n,s)=>n+s.words,0);if(words<4)return null;
 return {method:'priority-narrator-verified',score:segments.reduce((n,s)=>n+s.score*s.words,0)/words,...n,scope,contextNumber:e.contextNumber,segments};
}
let decisions;
function reviewed(){if(decisions)return decisions;const p='docs/imports/mishkat-priority-reviewed.json';return decisions=fs.existsSync(p)?JSON.parse(fs.readFileSync(p)):[];}
function grams(s){const w=canonical(s).split(' ');return new Set(w.slice(0,Math.max(0,w.length-2)).map((_,i)=>w.slice(i,i+3).join(' ')));}
async function validateBooks(q){const expected=JSON.parse(fs.readFileSync('temp/mishkat-priority-books.json')).filter(b=>b.ordinal>=100&&b.ordinal<=199).map(b=>[b.id,b.alias,b.ordinal,b.virtual]).sort((a,b)=>a[0]-b[0]);const live=(await q('SELECT id,alias,ordinal,`virtual` FROM books WHERE ordinal BETWEEN 100 AND 199')).map(b=>[b.id,b.alias,b.ordinal,b.virtual]).sort((a,b)=>a[0]-b[0]);if(JSON.stringify(live)!==JSON.stringify(expected))throw Error('Fallback book order changed');}
async function main(options={}){
 const extractMatch=options.extract||extract,evidenceMatch=options.evidence||evidence,artifact=options.artifact||'mishkat-priority-recovery';
 const bytes=fs.readFileSync('temp/mishkat-import-review.json'),report=JSON.parse(bytes);
 if(process.argv.includes('--fetch-corpus')){
  require('dotenv').config();const mysql=require('mysql'),util=require('util'),db=mysql.createConnection(require('./initializeHadithAttributions').connectionSettings()),q=util.promisify(db.query).bind(db);
  try{const books=await q('SELECT id,alias,name,ordinal,`virtual` FROM books WHERE `virtual`=0');const allowed=[...new Set(report.entries.filter(h=>!h.links.length).flatMap(h=>policy(h,books).aliases))];const rows=await q('SELECT h.id,h.bookId,h.num,h.chain,h.body,h.text,b.alias FROM hadiths h JOIN books b ON b.id=h.bookId WHERE b.alias IN (?) AND b.`virtual`=0',[allowed]);fs.writeFileSync('temp/mishkat-priority-books.json',JSON.stringify(books));fs.writeFileSync('temp/mishkat-priority-corpus.json',JSON.stringify(rows));console.log({records:rows.length,aliases:allowed});return;}finally{db.end();}
 }
 const books=JSON.parse(fs.readFileSync('temp/mishkat-priority-books.json')),corpus=JSON.parse(fs.readFileSync('temp/mishkat-priority-corpus.json')),byId=new Map(corpus.map(c=>[c.id,c])),indexes=new Map();
 for(const c of corpus){if(!indexes.has(c.alias))indexes.set(c.alias,new Map());const ix=indexes.get(c.alias);for(const g of grams(c.body)){if(!ix.has(g))ix.set(g,[]);ix.get(g).push(c.id);}}
 const recovered=[],pending=[];
 for(const h of report.entries.filter(h=>!h.links.length)){
  const scope=policy(h,books),e=extractMatch(h,report.entries),links=[],reasons=[];
  for(const alias of scope.aliases){const ix=indexes.get(alias);if(!ix)continue;const votes=new Map();for(const g of grams(e.segments.join(' ')))for(const id of ix.get(g)||[])votes.set(id,(votes.get(id)||0)+1);
   const ids=[...votes].sort((a,b)=>b[1]-a[1]).slice(0,60).map(x=>x[0]);for(const a of reviewed().filter(a=>a.number===h.number&&a.ref.startsWith(alias+':')))if(!ids.includes(a.id))ids.push(a.id);
   const matches=ids.map(id=>{const c=byId.get(id);return {c,evidence:evidenceMatch(h,c,report.entries,books)};}).filter(x=>x.evidence),best=variants.choose(matches);
   if(best){const {c,evidence}=best;evidence.alternatives=matches.map(x=>({ref:alias+':'+x.c.num,score:x.evidence.score}));links.push({id:c.id,ref:alias+':'+c.num,evidence,targetSha256:sha(JSON.stringify([c.id,c.bookId,c.num,c.chain,c.body,c.text]))});if(scope.mode==='ordinal-fallback')break;}
   else reasons.push({alias,reason:options.reason?options.reason(e,scope):!e.narrator?'narrator-context':!e.segments.length?'no-matn':'unverified-variant',candidates:ids.slice(0,4).map(id=>({id,ref:alias+':'+byId.get(id).num}))});
  }
  const item={...h,scope,links,reasons};(links.length?recovered:pending).push(item);
 }
 const plan={sourceSha256:report.sha256,baseReportSha256:sha(bytes),stats:{examined:recovered.length+pending.length,recovered:recovered.length,links:recovered.reduce((n,h)=>n+h.links.length,0),pending:pending.length,fallback:recovered.filter(h=>h.scope.mode==='ordinal-fallback').length},recovered,pending};fs.writeFileSync(`temp/${artifact}.json`,JSON.stringify(plan,null,2));console.log(plan.stats);
}
let validationContext;
function exactEvidence(h,c){validationContext ||= {entries:JSON.parse(fs.readFileSync('temp/mishkat-import-review.json')).entries,books:JSON.parse(fs.readFileSync('temp/mishkat-priority-books.json'))};return evidence(h,c,validationContext.entries,validationContext.books);}
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});module.exports={policy,extract,evidence,exactEvidence,validateBooks,run:main};
