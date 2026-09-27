#!/usr/bin/env node
'use strict';
const fs=require('fs'),assert=require('assert/strict'),crypto=require('crypto'),Match=require('./utils/mishkat-match-evidence'),{canonical}=require('./recover-mishkat-text-pass2'),{normalize}=require('./recover-mishkat-text-matches');
const prefix='mishkat-muttafaq-pass2',live=JSON.parse(fs.readFileSync(`temp/${prefix}-live.json`)),flags=new Set(JSON.parse(fs.readFileSync(`temp/${prefix}-flags.json`))),bytes=fs.readFileSync('temp/mishkat-import-review.json'),report=JSON.parse(bytes),original=require('./import-mishkat-epub').parse();assert.equal(original.sha256,report.sha256);
const raw=new Map(original.entries.flatMap(e=>e.numbers.map(n=>[n,{...e,number:n}]))),entries=Match.prepareEntries(report.entries.map(h=>({...h,...raw.get(h.number),splitNarrator:h.splitNarrator,splitSegments:h.splitSegments}))),byNum=new Map(entries.map(h=>[h.number,h]));
const grams=s=>{const w=canonical(s).split(' ');return new Set(w.slice(0,-1).map((x,i)=>x+' '+w[i+1]));},ix=new Map(),byId=new Map(live.candidates.map(c=>[c.id,c]));
for(const c of live.candidates)for(const g of grams(c.chain+' '+c.body)){if(!ix.has(g))ix.set(g,[]);ix.get(g).push(c.id);}
const previous=fs.existsSync(`temp/${prefix}-plan.json`)?JSON.parse(fs.readFileSync(`temp/${prefix}-plan.json`)):null;
const prior=new Map([...(previous?.resolved||[]),...(previous?.pending||[])].map(h=>[h.aliasId,h]));
const resolved=[],pending=[];

for(const a of live.aliases){const h=byNum.get(Math.floor(a.num0));assert(h);if(!normalize(h.text+' '+a.note).includes('متفق عليه'))continue;const e=Match.mainWording(h,entries),votes=new Map();const old=prior.get(a.id);if(old?.targetId&&JSON.stringify(old.segments)===JSON.stringify(e.segments)){(old.targetId?resolved:pending).push(old);continue;}for(const g of grams(e.segments.join(' ')))for(const id of ix.get(g)||[])votes.set(id,(votes.get(id)||0)+1);
 const candidates=[...votes].sort((a,b)=>b[1]-a[1]).slice(0,100).map(([id])=>{const c=byId.get(id);return {...c,lexicalHits:votes.get(id),ref:c.alias+':'+c.num,evidence:Match.evidence(e,c),marked:flags.has(id)};}).filter(c=>e.narrator||c.alias==='bukhari'&&c.marked);
 candidates.sort((a,b)=>b.evidence.coverage-a.evidence.coverage||b.evidence.score-a.evidence.score||(a.evidence.score===0?b.lexicalHits-a.lexicalHits:0)||Number(b.evidence.narrator)-Number(a.evidence.narrator)||Number(b.alias==='bukhari')-Number(a.alias==='bukhari')||a.ref.localeCompare(b.ref,'en',{numeric:true}));
 const best=candidates[0],item={aliasId:a.id,number:h.number,oldId:a.hadithId,from:a.ref_num,originalText:raw.get(h.number).text,sourceFile:raw.get(h.number).file,narrator:e.narrator,segments:e.segments,matchingText:e.matchingText,explicitVariantSeparated:e.boundary,excludedText:e.excludedText,scope:{mode:'cited-books',aliases:['bukhari','muslim']},candidates:candidates.slice(0,4)};
 if(best&&best.evidence.coverage===1&&best.evidence.words>=6){item.targetId=best.id;item.ref=best.ref;item.method='muttafaq-original-epub-approximate-wording';resolved.push(item);}else pending.push(item);
 if((resolved.length+pending.length)%50===0)console.log({examined:resolved.length+pending.length});
}
const stats={examined:resolved.length+pending.length,resolved:resolved.length,pending:pending.length,fromMisc:resolved.filter(h=>h.from.startsWith('misc:')).length,fromSuyuti:resolved.filter(h=>h.from.startsWith('suyuti:')).length};fs.writeFileSync(`temp/${prefix}-plan.json`,JSON.stringify({sourceSha256:original.sha256,baseReportSha256:crypto.createHash('sha256').update(bytes).digest('hex'),stats,resolved,pending},null,2));console.log(stats);
