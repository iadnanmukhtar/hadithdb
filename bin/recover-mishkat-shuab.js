#!/usr/bin/env node
'use strict';
const fs=require('fs'),crypto=require('crypto');
const {normalize,extract,narratorMatches}=require('./recover-mishkat-text-matches');
const {canonical}=require('./recover-mishkat-text-pass2');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
function citations(entries){
 const out=new Map(),counts={الثلاثه:3,الاربعه:4,الخمسه:5};
 entries.forEach((h,i)=>{const n=normalize(h.text);if(/البيهقي في سننه الكبير/.test(n)){out.set(h.number,{citationNumber:h.number,citationText:h.text,alias:'bayhaqi'});return;}if(!/في (?:كتاب )?شعب الايمان/.test(n))return;out.set(h.number,{citationNumber:h.number,citationText:h.text});if([1761,1886,2308,2756,3097,3730,4567,5052,5205,5210,5264].includes(h.number)&&/رواهما البيهقي في شعب الايمان/.test(n)&&i>0)out.set(entries[i-1].number,{citationNumber:h.number,citationText:h.text,shared:true});const m=n.match(/روي البيهقي الاحاديث (الثلاثه|الاربعه|الخمسه) في شعب الايمان/);if(m){let remaining=counts[m[1]];for(let j=i;j>=0&&remaining>0;j--){const prior=entries[j];out.set(prior.number,{citationNumber:h.number,citationText:h.text,shared:true});remaining--;}if(remaining)throw Error('Incomplete shared citation');}});return out;
}
function entryExtract(h){
 let plain=h.text.replace(/^\[\d+\]\s*/u,'').normalize('NFKD').replace(/[\u064b-\u065f\u0670\u06d6-\u06edـ]/gu,'');
 // Source labels are not matn. Preserve citation-led entries for individual review.
 const at=plain.search(/(?:رواه|رواهما|روى|روي) /u);if(at>10)plain=plain.slice(0,at);
 const e=extract({...h,text:plain});e.narrator=e.narrator.split(/ عن (?:النبي|رسول الله)/u)[0].replace(/ مرسلا$| وكانت له صحبه$/u,'');return e;
}
let approvedCache;
function approved(){if(approvedCache)return approvedCache;const p='docs/imports/mishkat-shuab-reviewed.json';return approvedCache=fs.existsSync(p)?JSON.parse(fs.readFileSync(p)):[];}
function exactEvidence(h,c){
 if(!h.sources.includes(c.alias)||!['shuab','bayhaqi'].includes(c.alias))return null;
 if(c.alias==='bayhaqi'&&!/البيهقي في سننه الكبير/.test(normalize(h.text)))return null;
 const a=approved().find(a=>a.number===h.number&&a.id===c.id);
 if(a&&a.sourceTextSha256===sha(h.text)&&a.targetSha256===sha(JSON.stringify([c.id,c.bookId,c.num,c.chain,c.body,c.text])))return {method:'reviewed-shuab-match',note:a.note,differences:a.differences};
 if(c.alias!=='shuab')return null;
 const e=entryExtract(h),target=canonical([c.chain,c.body,c.text].join(' '));const words=e.segments.reduce((n,s)=>n+s.split(' ').length,0);
 if(words<8||!narratorMatches(e.narrator,normalize([c.chain,c.body,c.text].join(' ')))||!e.segments.every(s=>target.replace(/ /g,'').includes(canonical(s).replace(/ /g,''))))return null;
 return {method:'shuab-exact-matn-narrator',narrator:e.narrator,segments:e.segments,words};
}
function eligible(h,entries){return !h.links.length&&h.numbers.length===1&&citations(entries).has(h.number);}
function main(){
 const bytes=fs.readFileSync('temp/mishkat-import-review.json'),r=JSON.parse(bytes),refs=citations(r.entries),corpus=JSON.parse(fs.readFileSync('temp/mishkat-shuab-corpus.json'));const approvals=approved();const bayhaqiIds=new Set(approvals.filter(a=>a.ref.startsWith('bayhaqi:')).map(a=>a.id));if(bayhaqiIds.size)corpus.push(...JSON.parse(fs.readFileSync('temp/mishkat-corpus.json')).filter(c=>bayhaqiIds.has(c.id)));
 const grams=new Map();for(const c of corpus){c.alias=bayhaqiIds.has(c.id)?'bayhaqi':'shuab';c.normal=canonical([c.chain,c.body,c.text].join(' '));const w=c.normal.split(' ');for(let i=0;i<w.length-3;i++){const g=w.slice(i,i+4).join(' ');if(!grams.has(g))grams.set(g,new Set());grams.get(g).add(c.id);}}
 const byId=new Map(corpus.map(c=>[c.id,c])),recovered=[],pending=[];
 for(const base of r.entries.filter(h=>!h.links.length&&refs.has(h.number))){const sourceAlias=refs.get(base.number).alias||'shuab';const h={...base,sources:[...new Set([...base.sources,sourceAlias])]},e=entryExtract(h),votes=new Map();const words=canonical(e.segments.join(' ')||h.text).split(' ');for(let i=0;i<words.length-3;i++)for(const id of grams.get(words.slice(i,i+4).join(' '))||[])votes.set(id,(votes.get(id)||0)+1);
 const ranked=[...votes].filter(([id])=>byId.get(id).alias===sourceAlias).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([id,hits])=>({id,ref:sourceAlias+':'+byId.get(id).num,hits,text:byId.get(id).body}));const anchor=canonical(e.segments.slice().sort((a,b)=>b.length-a.length)[0]||'').replace(/ /g,'');const matches=h.numbers.length===1?corpus.filter(c=>c.alias===sourceAlias&&(approvals.some(a=>a.number===h.number&&a.id===c.id)||(anchor&&c.normal.replace(/ /g,'').includes(anchor)))&&exactEvidence(h,c)):[];let chosen=null;
 const manual=matches.filter(c=>approvals.some(a=>a.number===h.number&&a.id===c.id));if(manual.length===1)chosen=manual[0];else if(matches.length===1)chosen=matches[0];
 const links=chosen?[{id:chosen.id,ref:sourceAlias+':'+chosen.num,evidence:exactEvidence(h,chosen),targetSha256:sha(JSON.stringify([chosen.id,chosen.bookId,chosen.num,chosen.chain,chosen.body,chosen.text]))}]:[];
 const item={number:h.number,headingKey:h.headingKey,text:h.text,sources:h.sources,sourceEvidence:refs.get(h.number),links,reasons:[{alias:sourceAlias,reason:h.numbers.length>1?'grouped-report':matches.length>1?'multiple-matches':links.length?'matched':'needs-review',candidates:ranked,exactCandidates:matches.map(c=>sourceAlias+':'+c.num)}]};(links.length?recovered:pending).push(item);
 }
 const plan={sourceSha256:r.sha256,baseReportSha256:sha(bytes),stats:{examined:recovered.length+pending.length,recovered:recovered.length,links:recovered.length,pending:pending.length},recovered,pending};fs.writeFileSync('temp/mishkat-shuab-recovery.json',JSON.stringify(plan,null,2));console.log(plan.stats);
}
if(require.main===module)main();module.exports={citations,entryExtract,exactEvidence,eligible};
