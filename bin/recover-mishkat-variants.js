#!/usr/bin/env node
'use strict';
const fs=require('fs'),crypto=require('crypto');
const {canonical}=require('./recover-mishkat-text-pass2');
const {entryExtract,citations}=require('./recover-mishkat-shuab');
const {sources}=require('./import-mishkat-epub');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const reviewedPath='docs/imports/mishkat-variants-reviewed.json';
const reviewed=fs.existsSync(reviewedPath)?JSON.parse(fs.readFileSync(reviewedPath)):[];
const groupNames={4316:['عمر','أنس','ابن الزبير','أبي أمامة'],4456:['ابن عمر','الزبير'],4871:['عبد الرحمن بن غنم','أسماء بنت يزيد'],4874:['أبي سعيد','جابر'],4998:['أنس','عبد الله'],5091:['أنس','ابن عباس'],5229:['أبي هريرة','أبي خلاد'],5375:['أبي عبيدة','معاذ بن جبل'],5608:['حذيفة','أبي هريرة']};
function splitEntries(entries){
 const refs=citations(entries),byNumber=new Map(entries.map(h=>[h.number,h]));
 return entries.flatMap(h=>{
  if(h.numbers.length===1)return h;
  if(h.links.length)throw Error('Refusing to split an already linked group');
  const names=groupNames[h.number];if(!names||names.length!==h.numbers.length)throw Error('Unreviewed group '+h.number);
  const contextNumber=({4456:4455,5091:5090})[h.number];
  const context=contextNumber?byNumber.get(contextNumber):h;
  const segments=entryExtract(context).segments;
  const allowed=[...new Set([...sources(h.text),...(refs.has(h.number)?[refs.get(h.number).alias||'shuab']:[])])];
  return h.numbers.map((number,i)=>({...h,number,numbers:[number],sources:allowed,links:[],review:[],
   text:h.text,
   splitNarrator:names[i],splitSegments:segments,groupSource:{number:h.number,numbers:h.numbers,text:h.text,contextNumber,contextText:contextNumber?context.text:undefined,citation:refs.get(h.number)}}));
 });
}
const fold=s=>canonical(s).replace(/(^| )(?:ابي|ابا)(?= |$)/g,'$1ابو').replace(/(^| )ابن(?= |$)/g,'$1بن');
function narratorEvidence(name,c){
 if(!name||name.split(' ').length>9)return null;
 const wanted=fold(name).replace(/^(?:و?عن) /,'').trim();
 const explicitChain=c.chain||String(c.body||'').split(/[«"“]/)[0];
 const chain=fold(explicitChain);
 // Use a contiguous name; do not collect its words from unrelated people in the chain.
 const names=[wanted];
 if(/^بن (?:عباس|عمر|عمرو|مسعود|الزبير)$/.test(wanted))names.push('عبد الله '+wanted);
 if(wanted==='عمر بن الخطاب')names.push('عمر');
 if(wanted==='انس بن مالك')names.push('انس');
 if(wanted==='ابي سعيد الخدري'||wanted==='ابو سعيد الخدري')names.push('ابو سعيد');
 for(const n of names){
  // Primary narrator must be in the last chain transmission, allowing a subsequent prophetic attribution.
  const parts=chain.split(/(?:^| )(?:عن|سمعت|انه سمع|قال سمعت) /).filter(Boolean);
  const tail=parts.slice(-2).join(' ');
  if(!(' '+tail+' ').includes(' '+n+' '))continue;
  if(n==='عمر'&&/بن عمر/.test(tail)&&!tail.includes('عمر بن الخطاب'))continue;
  if(n==='الزبير'&&/بن الزبير/.test(tail))continue;
  return {sourceNarrator:name,targetChain:explicitChain,matchedName:n};
 }
 return null;
}
function extraction(h){const e=entryExtract(h);if(h.splitNarrator)return {...e,narrator:h.splitNarrator,segments:h.splitSegments};return e;}
function tokenCounts(words){const m=new Map();for(const w of words)m.set(w,(m.get(w)||0)+1);return m;}
function overlap(a,b){const x=tokenCounts(a),y=tokenCounts(b);let n=0;for(const [w,count]of x)n+=Math.min(count,y.get(w)||0);return n;}
function grams(w,k){return new Set(w.slice(0,Math.max(0,w.length-k+1)).map((_,i)=>w.slice(i,i+k).join(' ')));}
function bodyEvidence(source,target){
 const a=canonical(source).split(' ').filter(Boolean),b=canonical(target).split(' ').filter(Boolean);if(a.length<4||!b.length)return null;
 const normal=canonical(source),text=canonical(target);
 if((' '+text+' ').includes(' '+normal+' '))return {method:'exact-segment',score:1,words:a.length};
 // Reordered clauses are allowed; content and negation still require supporting evidence.
 if(a.length<8)return null;
 let best=null;
 const lengths=[Math.max(8,a.length-3),a.length,a.length+3,Math.ceil(a.length*1.15)];
 for(const len of lengths)for(let start=0;start<b.length;start++){
  const window=b.slice(start,start+len);if(window.length<Math.min(a.length*.8,8))continue;
  const common=overlap(a,window),recall=common/a.length,precision=common/window.length;
  if(recall<.88||precision<.83)continue;
  const counts=tokenCounts(window),ac=tokenCounts(a);
  if(['لا','لم','لن','ليس','الا','غير'].some(w=>(ac.get(w)||0)!==(counts.get(w)||0)))continue;
  if(a.some((w,i)=>['لا','لم','لن','ليس','الا','غير'].includes(w)&&!(' '+window.join(' ')+' ').includes(' '+a.slice(i,i+6).join(' ')+' ')))continue;
  const ag=grams(a,2),bg=grams(window,2),pairs=[...ag].filter(g=>bg.has(g)).length/Math.max(1,ag.size);
  if(pairs<.68)continue;
  const score=(2*recall*precision/(recall+precision))*.7+pairs*.3;
  if(!best||score>best.score)best={method:'reordered-or-close-wording',score,recall,precision,pairCoverage:pairs,words:a.length,targetWindow:window.join(' ')};
 }
 return best;
}
function exactEvidence(h,c){
 if(!h.sources.includes(c.alias))return null;
 const approved=reviewed.find(a=>a.number===h.number&&a.id===c.id);
 if(approved&&approved.sourceTextSha256===sha(h.text)&&approved.targetSha256===sha(JSON.stringify([c.id,c.bookId,c.num,c.chain,c.body,c.text])))return {method:'reviewed-narrator-wording-variant',score:1,sourceNarrator:approved.narrator,note:approved.note,segments:[]};
 const e=extraction(h),n=narratorEvidence(e.narrator,c);if(!n||!e.segments.length)return null;
 const segments=e.segments.map(s=>bodyEvidence(s,c.body));if(segments.some(s=>!s))return null;
 const words=segments.reduce((n,s)=>n+s.words,0);if(words<8&&!h.groupSource)return null;
 return {method:'narrator-verified-best-variant',...n,segments,score:segments.reduce((n,s)=>n+s.score*s.words,0)/words};
}
function choose(candidates){return candidates.sort((a,b)=>b.evidence.score-a.evidence.score||a.c.num.localeCompare(b.c.num,'en',{numeric:true})||a.c.id-b.c.id)[0];}
async function main(){
 const bytes=fs.readFileSync('temp/mishkat-import-review.json'),report=JSON.parse(bytes),expanded=splitEntries(report.entries);
 const file='temp/mishkat-variants-corpus.json';
 if(process.argv.includes('--fetch-corpus')){
  require('dotenv').config();const mysql=require('mysql'),util=require('util'),db=mysql.createConnection(require('./initializeHadithAttributions').connectionSettings()),q=util.promisify(db.query).bind(db);
  try{const aliases=[...new Set(expanded.filter(h=>!h.links.length).flatMap(h=>h.sources))];const rows=await q('SELECT h.id,h.bookId,h.num,h.chain,h.body,h.text,b.alias FROM hadiths h JOIN books b ON b.id=h.bookId WHERE b.alias IN (?) AND b.`virtual`=0',[aliases]);fs.writeFileSync(file,JSON.stringify(rows));console.log({records:rows.length,aliases});return;}finally{db.end();}
 }
 const corpus=JSON.parse(fs.readFileSync(file)),byId=new Map(corpus.map(c=>[c.id,c])),indexes=new Map();
 for(const c of corpus){if(!indexes.has(c.alias))indexes.set(c.alias,new Map());const ix=indexes.get(c.alias);for(const g of grams(canonical(c.body).split(' '),3)){if(!ix.has(g))ix.set(g,[]);ix.get(g).push(c.id);}}
 const recovered=[],pending=[];
 for(const h of expanded.filter(h=>!h.links.length)){
  const e=extraction(h),links=[],reasons=[];
  for(const alias of h.sources){const votes=new Map(),ix=indexes.get(alias);if(!ix)continue;
   for(const g of grams(canonical(e.segments.join(' ')).split(' '),3))for(const id of ix.get(g)||[])votes.set(id,(votes.get(id)||0)+1);
   const ids=[...votes].sort((a,b)=>b[1]-a[1]).slice(0,45).map(x=>x[0]);for(const old of h.review.filter(x=>x.alias===alias).flatMap(x=>x.candidates||[]))if(byId.has(old.id)&&!ids.includes(old.id))ids.push(old.id);
   for(const a of reviewed.filter(a=>a.number===h.number&&a.ref.startsWith(alias+':')))if(!ids.includes(a.id))ids.push(a.id);
   const candidates=ids.map(id=>{const c=byId.get(id);return {c,evidence:exactEvidence(h,c)};}).filter(x=>x.evidence);
   const best=choose(candidates);
   if(best){const {c,evidence}=best;evidence.alternatives=candidates.map(x=>({ref:alias+':'+x.c.num,score:x.evidence.score}));links.push({id:c.id,ref:alias+':'+c.num,evidence,targetSha256:sha(JSON.stringify([c.id,c.bookId,c.num,c.chain,c.body,c.text]))});}
   else reasons.push({alias,reason:!e.narrator?'narrator-context':!e.segments.length?'no-matn':'unverified-variant',candidates:ids.slice(0,5).map(id=>({id,ref:alias+':'+byId.get(id).num}))});
  }
  const item={...h,links,reasons};(links.length?recovered:pending).push(item);
 }
 const plan={sourceSha256:report.sha256,baseReportSha256:sha(bytes),stats:{examined:recovered.length+pending.length,recovered:recovered.length,links:recovered.reduce((n,h)=>n+h.links.length,0),pending:pending.length,splitGroups:report.entries.filter(h=>h.numbers.length>1).length},recovered,pending};fs.writeFileSync('temp/mishkat-variants-recovery.json',JSON.stringify(plan,null,2));console.log(plan.stats);
}
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});module.exports={splitEntries,extraction,narratorEvidence,bodyEvidence,exactEvidence,choose};
