#!/usr/bin/env node
'use strict';
const fs=require('fs'),{canonical}=require('./recover-mishkat-text-pass2'),{normalize}=require('./recover-mishkat-text-matches'),narrators=require('./recover-mishkat-narrators'),variants=require('./recover-mishkat-variants');
const assert=require('assert/strict'),crypto=require('crypto');
const report=JSON.parse(fs.readFileSync('temp/mishkat-import-review.json')),live=JSON.parse(fs.readFileSync('temp/mishkat-muttafaq-live.json')),flags=new Set(JSON.parse(fs.readFileSync('temp/mishkat-muttafaq-flags.json')));
const original=require('./import-mishkat-epub').parse();assert.equal(original.sha256,report.sha256);
const originalByNumber=new Map(original.entries.flatMap(h=>h.numbers.map(number=>[number,{...h,number}])));
const sourceEntries=report.entries.map(h=>{const source=originalByNumber.get(h.number);assert(source,'Missing EPUB number '+h.number);return {...h,...source,splitNarrator:h.splitNarrator,splitSegments:h.splitSegments};});
fs.writeFileSync('temp/mishkat-muttafaq-original-extracts.json',JSON.stringify({sha256:original.sha256,entries:sourceEntries.map(({number,file,text,footnote})=>({number,file,text,footnote}))},null,2));
const grams=(s,k=3)=>{const w=canonical(s).split(' ');return new Set(w.slice(0,Math.max(0,w.length-k+1)).map((_,i)=>w.slice(i,i+k).join(' ')));};
function evidence(source,target){
 const a=canonical(source),b=canonical(target),w=a.split(' '),compact=a.replace(/ /g,'');
 if(compact.length>=18&&b.replace(/ /g,'').includes(compact))return {method:'exact-with-spacing-variation',score:1,words:w.length};
 const strict=variants.bodyEvidence(source,target);if(strict)return strict;
 if(w.length<8)return null;
 const targetWords=b.split(' '),ag=grams(a,2);let best=null;
 for(const size of [Math.ceil(w.length*.8),w.length,Math.ceil(w.length*1.25)])for(let i=0;i<targetWords.length;i++){
  const z=targetWords.slice(i,i+size),counts=new Map();for(const x of z)counts.set(x,(counts.get(x)||0)+1);let hits=0;for(const x of w)if(counts.get(x)>0){hits++;counts.set(x,counts.get(x)-1);}
  const recall=hits/w.length,precision=hits/z.length,bg=grams(z.join(' '),2),pairs=[...ag].filter(g=>bg.has(g)).length/Math.max(1,ag.size);
  if(recall<.75||precision<.7||pairs<.5)continue;
  const score=.7*(2*recall*precision/(recall+precision))+.3*pairs;
  if(!best||score>best.score)best={method:'close-wording-variant',score,words:w.length,recall,precision,pairs,targetWindow:z.join(' ')};
 }
 return best;
}
const moduleEvidence=evidence;
const byId=new Map(live.candidates.map(c=>[c.id,c])),ix=new Map();
for(const c of live.candidates)for(const g of grams([c.chain,c.body].join(' '))){if(!ix.has(g))ix.set(g,[]);ix.get(g).push(c.id);}
const entries=new Map(sourceEntries.map(h=>[h.number,h])),resolved=[],pending=[];
for(const row of live.aliases.filter(r=>normalize(r.note).includes('متفق عليه'))){
 if((resolved.length+pending.length)%50===0)console.log({examined:resolved.length+pending.length});
 const h=entries.get(Math.floor(row.num0)),e=narrators.extract(h,sourceEntries);const segments=e.segments.filter(s=>canonical(s).split(' ').length>=4);
 const votes=new Map();for(const g of grams(segments.join(' ')))for(const id of ix.get(g)||[])votes.set(id,(votes.get(id)||0)+1);
 const ranked=[...votes].sort((a,b)=>b[1]-a[1]).slice(0,100).map(([id,hits])=>{const c=byId.get(id),n=variants.narratorEvidence(e.narrator,c);const evidence=segments.map(s=>moduleEvidence(s,[c.chain,c.body].join(' ')));const words=segments.reduce((n,s)=>n+canonical(s).split(' ').length,0);const covered=evidence.reduce((n,s)=>n+(s?.words||0),0);return {id,ref:c.alias+':'+c.num,hits,narrator:!!n,marked:flags.has(id),score:words?evidence.reduce((n,s)=>n+(s?s.score*s.words:0),0)/words:0,coverage:words?covered/words:0,body:c.body,chain:c.chain,evidence};}).filter(c=>e.narrator||c.ref.startsWith('bukhari:')&&c.marked);
 ranked.sort((a,b)=>b.score-a.score||Number(b.narrator)-Number(a.narrator)||Number(b.ref.startsWith('bukhari:'))-Number(a.ref.startsWith('bukhari:'))||a.ref.localeCompare(b.ref,'en',{numeric:true}));
 const best=ranked[0];const item={aliasId:row.id,number:h.number,from:row.ref_num,oldId:row.hadithId,text:h.text,narrator:e.narrator,segments,candidates:ranked.slice(0,4)};
 // All meaningful quoted segments must be supported, including differences of word order.
 if(best&&best.coverage===1&&segments.reduce((n,s)=>n+canonical(s).split(' ').length,0)>=4){item.targetId=best.id;item.ref=best.ref;item.method='muttafaq-best-supported-wording';resolved.push(item);}else pending.push(item);
}
const result={sourceSha256:original.sha256,matchingSource:'fresh EPUB extraction with reviewed editorial separation',baseReportSha256:crypto.createHash('sha256').update(fs.readFileSync('temp/mishkat-import-review.json')).digest('hex'),stats:{examined:resolved.length+pending.length,resolved:resolved.length,pending:pending.length,fromMisc:resolved.filter(r=>r.from.startsWith('misc:')).length,fromSuyuti:resolved.filter(r=>r.from.startsWith('suyuti:')).length,noNarrator:resolved.filter(r=>!r.narrator).length},resolved,pending};fs.writeFileSync('temp/mishkat-muttafaq-plan.json',JSON.stringify(result,null,2));console.log(result.stats);
