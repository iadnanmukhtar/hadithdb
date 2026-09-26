#!/usr/bin/env node
'use strict';
const fs = require('fs');
const crypto = require('crypto');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
function normalize(value) {
 return String(value || '').normalize('NFKD').replace(/[\u064b-\u065f\u0670\u06d6-\u06edـ]/gu, '')
  .replace(/[إأآٱ]/gu, 'ا').replace(/ى/gu, 'ي').replace(/ة/gu, 'ه')
  .replace(/رضي الله عنه(?:ما|م|ا)?|صلي الله عليه وسلم|ﷺ|ؓ/gu, ' ')
  .replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/gu, ' ').trim();
}
function isTextRejection(h) {
 if (h.links.length || h.numbers.length > 1 || !h.sources.length) return false;
 const candidates = h.review.flatMap(r => r.candidates.slice(0, 1));
 return candidates.length > 0 && !candidates.some(b => b.hits >= 8 && b.recall >= .85 && b.score >= .45);
}
function extract(h) {
 const raw = h.text.replace(/^(?:\[\d+\]\s*)?\([^)]*\)\s*/u, '').split(/رَوَاهُ|رَوَاهُمَا|رواه|رواهما/u)[0];
 const normalized = normalize(raw);
 const narrator = normalized.match(/^(?:و?عن) (.*?) (?:قال|قالت|ان|انه|انها) /u)?.[1] || '';
 const quoted = [...raw.matchAll(/«([^»]+)»|"([^"]+)"/gu)].map(m => normalize(m[1] || m[2])).filter(Boolean);
 let segments=quoted,method='all-quoted-matn-exact';
 if(segments.reduce((n,s)=>n+s.split(' ').length,0)<8&&narrator){let body=normalized.replace(/^(?:و?عن) .*? (?:قال|قالت|ان|انه|انها) /u,'');body=body.replace(/^(?:قال |سمعت |سمع )?(?:رسول الله|النبي)(?: يقول| قال)? /u,'');if(body.split(' ').length>=8){segments=[body];method='unquoted-passage-exact';}}
 return { narrator, segments, method, raw: normalized };
}
function narratorMatches(name, target) {
 if (!name || name.split(' ').length > 9) return false;
 // Honorifics and grammatical Abu/Abi forms do not change narrator identity.
 const fold = s => s.replace(/(^| )(?:ابي|ابو|ابا)(?= |$)/gu, '$1ابو');
 const words = fold(name).split(' ').filter(x => !['عن','بن','ابن','و'].includes(x));
 const set = new Set(fold(target).split(' '));
 return words.length > 0 && words.every(w => set.has(w));
}
function exactEvidence(h, c) {
 const e = extract(h), target = normalize([c.chain,c.body,c.text].join(' '));
 if (!e.segments.length || !narratorMatches(e.narrator, target)) return null;
 const words = e.segments.reduce((n,s) => n+s.split(' ').length,0);
 // Every quoted passage must occur intact. Short common expressions cannot establish identity.
 if (words < 8 || !e.segments.every(s => (' '+target+' ').includes(' '+s+' '))) return null;
 return {method:e.method,narrator:e.narrator,words,segments:e.segments};
}
function main() {
 const report = JSON.parse(fs.readFileSync('temp/mishkat-import-review.json'));
 const corpus = JSON.parse(fs.readFileSync('temp/mishkat-corpus.json'));
 const books = new Map(JSON.parse(fs.readFileSync('temp/mishkat-books.json')).map(b=>[b.id,b.alias]));
 const selected = report.entries.filter(isTextRejection);
 const needed = new Set(selected.flatMap(h=>h.sources));
 const pools = new Map();
 for(const c of corpus){c.alias=books.get(c.bookId);if(!needed.has(c.alias))continue;c.normal=normalize([c.chain,c.body,c.text].join(' '));if(!pools.has(c.alias))pools.set(c.alias,[]);pools.get(c.alias).push(c);}
 const recovered=[],pending=[];
 for(const h of selected){const e=extract(h),links=[],reasons=[];
  for(const alias of h.sources){const candidates=[];
   if(e.segments.length&&e.narrator){const anchor=e.segments.slice().sort((a,b)=>b.length-a.length)[0];for(const c of pools.get(alias)||[]){if(!c.normal.includes(anchor))continue;const evidence=exactEvidence(h,c);if(evidence)candidates.push({c,evidence});}}
   const equivalent=candidates.length>1&&new Set(candidates.map(x=>normalize(x.c.body))).size===1&&normalize(candidates[0].c.body).split(' ').length>=8;
   if(candidates.length===1||equivalent){candidates.sort((a,b)=>a.c.num.localeCompare(b.c.num,'en',{numeric:true}));const {c,evidence}=candidates[0];if(equivalent)evidence.equivalentReferences=candidates.map(x=>alias+':'+x.c.num);links.push({id:c.id,ref:alias+':'+c.num,evidence,targetSha256:sha(JSON.stringify([c.id,c.bookId,c.num,c.chain,c.body,c.text]))});}
   else reasons.push({alias,reason:candidates.length?'multiple-exact-matches':'no-exact-matn-and-narrator-match',candidates:candidates.map(x=>alias+':'+x.c.num)});
  }
  const item={number:h.number,headingKey:h.headingKey,text:h.text,sources:h.sources,links,reasons};
  (links.length?recovered:pending).push(item);
 }
 const result={sourceSha256:report.sha256,baseReportSha256:sha(fs.readFileSync('temp/mishkat-import-review.json')),stats:{examined:selected.length,recovered:recovered.length,links:recovered.reduce((n,h)=>n+h.links.length,0),pending:pending.length},recovered,pending};
 fs.writeFileSync('temp/mishkat-text-recovery.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result.stats));
}
if(require.main===module)main();module.exports={normalize,isTextRejection,extract,narratorMatches,exactEvidence};
