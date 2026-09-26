#!/usr/bin/env node
'use strict';
const {canonical}=require('./recover-mishkat-text-pass2');
const fs=require('fs'),priority=require('./recover-mishkat-priority'),variants=require('./recover-mishkat-variants');
const plain=s=>String(s).normalize('NFKD').replace(/[\u064b-\u065f\u0670\u06d6-\u06edـ]/gu,'').replace(/^\[\d+\]\s*/,'').replace(/^\([^)]*\)\s*/,'');
const pronoun=/^(?:وعنه|وعنها|عنه|عنها)(?=[\s:،]|$)/u;
const contexts=new WeakMap();
function resolve(h,entries){
 let ctx=contexts.get(entries);if(!ctx){ctx={positions:new Map(entries.map((h,i)=>[h.number,i])),resolved:new Map()};contexts.set(entries,ctx);}
 if(ctx.resolved.has(h.number))return ctx.resolved.get(h.number);
 let result;
 if(pronoun.test(plain(h.text))){const index=ctx.positions.get(h.number),previous=index>0?entries[index-1]:null,prior=previous?resolve(previous,entries):null;result={narrator:prior?.narrator||'',via:[h.number,...(prior?.via||[])],inheritedFrom:previous?.number};}
 else result={narrator:priority.extract(h,entries).narrator,via:[h.number]};
 ctx.resolved.set(h.number,result);return result;
}
function extract(h,entries){
 const narrator=resolve(h,entries);const rewritten=narrator.inheritedFrom&&narrator.narrator?{...h,text:plain(h.text).replace(pronoun,'وعن '+narrator.narrator)}:h;
 return {...priority.extract(rewritten,entries),narrator:narrator.narrator,narratorResolution:narrator};
}
function evidence(h,c,entries,books){
 const scope=priority.policy(h,books);if(!scope.aliases.includes(c.alias)||c.num&&!/^\d/.test(c.num))return null;
 const reviewed=priority.evidence(h,c,entries,books);
 if(reviewed?.method==='reviewed-priority-match')return reviewed;
 const e=extract(h,entries),n=variants.narratorEvidence(e.narrator,c);
 if(!e.segments.length||scope.mode==='ordinal-fallback'&&!n)return null;
 const segments=e.segments.map(s=>variants.bodyEvidence(s,c.body));if(segments.some(s=>!s))return null;
 const words=segments.reduce((n,s)=>n+s.words,0);if(words<4)return null;
 if(!n&&words<8&&canonical(e.segments.join(' '))!==canonical(c.body))return null;
 return {method:n?'recursive-narrator-verified':'cited-book-text-match-narrator-not-required',score:segments.reduce((n,s)=>n+s.score*s.words,0)/words,
  sourceNarrator:e.narrator,targetChain:c.chain||String(c.body||'').split(/[«"“]/)[0],narratorStatus:n?'verified':'different-or-unconfirmed',narratorResolution:e.narratorResolution,scope,segments};
}
function reason(e,scope){return !e.segments.length?'no-matn':scope.mode==='ordinal-fallback'&&!e.narrator?'narrator-context':'unverified-variant';}
let context;
function exactEvidence(h,c){context ||= {entries:JSON.parse(fs.readFileSync('temp/mishkat-import-review.json')).entries,books:JSON.parse(fs.readFileSync('temp/mishkat-priority-books.json'))};return evidence(h,c,context.entries,context.books);}
if(require.main===module)priority.run({artifact:'mishkat-narrator-recovery',extract,evidence,reason}).catch(e=>{console.error(e.stack);process.exitCode=1;});
module.exports={policy:priority.policy,validateBooks:priority.validateBooks,resolve,extract,evidence,exactEvidence,reason};
