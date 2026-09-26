#!/usr/bin/env node
'use strict';
const fs=require('fs'),crypto=require('crypto');
const {normalize,extract,narratorMatches,isTextRejection}=require('./recover-mishkat-text-matches');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
// Only honorific phrases tied to their named subject, plus whitespace. No content-word stemming.
function canonical(s){return normalize(s).replace(/الله (?:عز وجل|تبارك وتعالي|سبحانه وتعالي|تعالي|جل جلاله)/gu,'الله').replace(/(?:رسول الله|النبي)(?: عليه السلام)/gu,'رسول الله').replace(/(^| )النبي(?= |$)/gu,'$1رسول الله').replace(/\s+/gu,' ').trim();}
function sourceExtract(h,alias){
 const e=extract(h); let text=h.text;
 // Split only an explicit terminal collection variant; never guess the source of a quotation.
 const plain=text.normalize('NFKD').replace(/[\u064b-\u065f\u0670\u06d6-\u06edـ]/gu,'');
 const m=plain.match(/(?:هذا لفظ البخاري|هذه رواية البخاري)\s*[.،]?\s*ولمسلم/);
 if(m&&h.sources.includes('bukhari')&&h.sources.includes('muslim')){
  // Use normalized text with punctuation/quotes retained; indices refer to this same string.
  const before=plain.slice(0,m.index), after=plain.slice(m.index+m[0].length);
  if(alias==='bukhari')return {...extract({...h,text:before}),method:'explicit-bukhari-variant'};
  if(alias==='muslim')return {...extract({...h,text:after}),narrator:e.narrator,method:'explicit-muslim-variant'};
 }
 return e;
}
const reviewed=JSON.parse(fs.readFileSync(require('path').join(__dirname,'../docs/imports/mishkat-text-pass2-reviewed.json')));
function exactEvidence(h,c){
 if(!h.sources.includes(c.alias))return null;
 const approved=reviewed.find(r=>r.number===h.number&&r.id===c.id&&r.ref===c.alias+':'+c.num);
 if(approved&&approved.sourceTextSha256===sha(h.text)&&approved.targetSha256===sha(JSON.stringify([c.id,c.bookId,c.num,c.chain,c.body,c.text])))return {method:'individually-reviewed-wording-variant',narrator:approved.narrator,source:approved.source,target:approved.target,differences:approved.differences,note:approved.note};
 const e=sourceExtract(h,c.alias),target=canonical([c.chain,c.body,c.text].join(' '));
 if(!e.narrator||!narratorMatches(e.narrator,normalize([c.chain,c.body,c.text].join(' '))))return null;
 const segments=e.segments.map(canonical),words=segments.reduce((n,s)=>n+s.split(' ').length,0);
 if(words<12||!segments.length||!segments.every(s=>target.replace(/ /g,'').includes(s.replace(/ /g,''))))return null;
 return {method:'honorific-spacing-exact/'+e.method,narrator:e.narrator,words,segments};
}
function main(){
 const base=fs.readFileSync('temp/mishkat-import-review.json'),report=JSON.parse(base),corpus=JSON.parse(fs.readFileSync('temp/mishkat-corpus.json'));
 const books=new Map(JSON.parse(fs.readFileSync('temp/mishkat-books.json')).map(b=>[b.id,b.alias]));
 const pools=new Map();for(const c of corpus){c.alias=books.get(c.bookId);c.compact=canonical([c.chain,c.body,c.text].join(' ')).replace(/ /g,'');if(!pools.has(c.alias))pools.set(c.alias,[]);pools.get(c.alias).push(c);}
 const recovered=[],pending=[];
 for(const h of report.entries.filter(isTextRejection)){
  const links=[],reasons=[];
  for(const alias of h.sources){const e=sourceExtract(h,alias),anchor=e.segments.slice().sort((a,b)=>b.length-a.length)[0];let candidates=[];
   if(anchor&&e.narrator){const needle=canonical(anchor).replace(/ /g,'');for(const c of pools.get(alias)||[]){if(!c.compact.includes(needle))continue;const evidence=exactEvidence(h,c);if(evidence)candidates.push({c,evidence});}}
   for(const approved of reviewed.filter(r=>r.number===h.number&&r.ref.startsWith(alias+':'))){const c=(pools.get(alias)||[]).find(c=>c.id===approved.id);const evidence=c&&exactEvidence(h,c);if(evidence&&!candidates.some(x=>x.c.id===c.id))candidates.push({c,evidence});}
   const equivalent=candidates.length>1&&new Set(candidates.map(x=>normalize(x.c.body))).size===1;
   if(candidates.length===1||equivalent){candidates.sort((a,b)=>a.c.num.localeCompare(b.c.num,'en',{numeric:true}));const {c,evidence}=candidates[0];if(equivalent)evidence.equivalentReferences=candidates.map(x=>alias+':'+x.c.num);links.push({id:c.id,ref:alias+':'+c.num,evidence,targetSha256:sha(JSON.stringify([c.id,c.bookId,c.num,c.chain,c.body,c.text]))});}
   else reasons.push({alias,reason:candidates.length?'multiple-exact-matches':'needs-individual-review',candidates:candidates.map(x=>alias+':'+x.c.num)});
  }
  const item={number:h.number,headingKey:h.headingKey,text:h.text,sources:h.sources,links,reasons};(links.length?recovered:pending).push(item);
 }
 const plan={sourceSha256:report.sha256,baseReportSha256:sha(base),stats:{examined:recovered.length+pending.length,recovered:recovered.length,links:recovered.reduce((n,h)=>n+h.links.length,0),pending:pending.length},recovered,pending};
 fs.writeFileSync('temp/mishkat-text-pass2.json',JSON.stringify(plan,null,2));console.log(plan.stats);
}
if(require.main===module)main();module.exports={canonical,sourceExtract,exactEvidence};
