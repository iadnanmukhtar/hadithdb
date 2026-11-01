#!/usr/bin/env node
'use strict';
// Read-only identification. Expanded matches never become automatic write proposals.
const fs = require('fs');
const path = require('path');
const os = require('os');
const cheerio = require('cheerio');
const normalizeLatin = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[‘’ʿʾʼ']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const aliases = {
 bukhari: ['Sahih al-Bukhari'], muslim: ['Sahih Muslim'], nasai: ['Sunan al-Nasai'],
 abudawud: ['Sunan Abi Dawud', 'Sunan Abu Dawud'], tirmidhi: ['Sunan al-Tirmidhi', 'Jami al-Tirmidhi'],
 ibnmajah: ['Sunan Ibn Majah'], malik: ['Muwatta Malik', 'al-Muwatta', 'al-Muwatta li-Malik'],
 ahmad: ['Musnad Ahmad'], darimi: ['Sunan al-Darimi'], hakim: ['al-Mustadrak ala al-Sahihayn', 'al-Mustadrak'],
 ibnhibban: ['Sahih Ibn Hibban'], tabarani: ['al-Mujam al-Kabir', 'al-Mujam al-Kabir lil-Tabarani'],
 adab: ['al-Adab al-Mufrad', 'al-Adab al-Mufrad lil-Bukhari'], ibnkhuzaymah: ['Sahih Ibn Khuzaymah'],
 daraqutni: ['Sunan al-Daraqutni'], bazzar: ['Musnad al-Bazzar'],
 'nasai-kubra': ['al-Sunan al-Kubra lil-Nasai'], bayhaqi: ['al-Sunan al-Kubra lil-Bayhaqi', 'al-Sunan al-Kabir lil-Bayhaqi'],
 abdalrazzaq: ['Musannaf Abd al-Razzaq'], ibnabishaybah: ['Musannaf Ibn Abi Shaybah'],
 'tabarani-awsat': ['al-Mujam al-Awsat', 'al-Mujam al-Awsat lil-Tabarani'],
 'tabarani-saghir': ['al-Mujam al-Saghir', 'al-Mujam al-Saghir lil-Tabarani'],
 abuyaala: ['Musnad Abi Yala', 'Musnad Abi Yala al-Mawsili'], tayalisi: ['Musnad al-Tayalisi'],
 'ahmad-zuhd': ['al-Zuhd li-Ahmad ibn Hanbal'], shuab: ['Shuab al-Iman', 'Shuab al-Iman lil-Bayhaqi'],
};
const bookNames = new Map(Object.entries(aliases).flatMap(([alias,names]) => names.map(name => [normalizeLatin(name),alias])));
function parseReference(value) {
 const text = String(value || '').replace(/^Source:\s*/i, '').trim().replace(/[,;.]$/, '');
 const citations = text.split(/[,;]\s*(?=\p{L})/u);
 if (citations.length>1) {
  const primary = parseReference(citations[0]);
  return {...primary,raw:text,additionalReferences:citations.slice(1).map(parseReference)};
 }
 const match = text.match(/^(.+?)\s+(\d+[a-z]?(?:\s*[/,:–-]\s*\d+[a-z]?)*)(?:[.])?$/i);
 if (!match) return { raw: text, reason: 'unparsed-reference' };
 const alias = bookNames.get(normalizeLatin(match[1]));
 const locator = match[2].replace(/\s/g, '').toLowerCase();
 return { raw: text, bookName: match[1], alias: alias || null, locator,
  number: /^\d+[a-z]?$/.test(locator) ? locator : null,
  reason: alias ? null : 'unsupported-collection' };
}
function words(value, keepReportingPhrase = false) {
 const tokens = cheerio.load(String(value || '')).text().normalize('NFKD')
  .replace(/[\u064b-\u065f\u0670\u06d6-\u06ed\u0640]/g, '').replace(/[أإآٱ]/g, 'ا')
  .replace(/شىء/g, 'شيء')
  .replace(/صلى الله عليه وسلم|رضي الله عنهما|رضي الله عنها|رضي الله عنهم|رضي الله عنه|عليه السلام/g, ' ')
  .replace(/[^\u0621-\u063a\u0641-\u064a]+/g, ' ').trim().split(/\s+/).filter(Boolean);
 if (keepReportingPhrase) return tokens;
 return tokens.join(' ').replace(/(^| )او كما قال(?= |$)/g, '$1').trim().split(/\s+/).filter(Boolean);
}
function prepare(row) {
 const tokens = words(row.body);
 return { ...row, tokens, normalized: tokens.join(''), reportingPhraseIgnored:words(row.body,true).length !== tokens.length };
}
// Remove only the introductory attribution before an explicit speech marker.
// The remaining quotation retains negation, conditions and substantive wording.
function speechCore(tokens) {
 const text=tokens.join(' ');
 const marker=/(?:قال|قالت|ان|عن) (?:رسول الله|النبي) (?:(?:انه|انها) )?(?:(?:قال|يقول) )?/g;
 const match=marker.exec(text);
 if(match && match.index<140) return text.slice(match.index+match[0].length).split(' ').filter(Boolean);
 return text.replace(/^(?:كان يقول|كان يقول قال|يقول|قال) /,'').split(' ').filter(Boolean);
}
function protection(row) {
 return [row.title?.trim() || row.title_en?.trim() ? 'existing-title' : null,
  row.lastfixed || row.lastmod_user || row.arabic_revised || row.temp_trans || row.verified ? 'previously-revised' : null].filter(Boolean);
}
// Longest contiguous token span. No bag-of-words score can confirm a match.
function commonSpan(a,b) {
 let previous = new Uint16Array(b.length+1), best = 0, end = 0;
 for (let i=1;i<=a.length;i++) {
  const next = new Uint16Array(b.length+1);
  for (let j=1;j<=b.length;j++) if (a[i-1] === b[j-1]) {
   next[j] = previous[j-1]+1;
   if (next[j]>best) { best=next[j]; end=i; }
  }
  previous=next;
 }
 return { tokens: best, text: a.slice(end-best,end).join(' ') };
}
function evidence(source, row, sourcePhraseIgnored = false) {
 const joined = source.join(''), body = row.normalized;
 if (!joined || !body) return null;
 const reportingPhraseIgnored = row.reportingPhraseIgnored || sourcePhraseIgnored;
 const minimumBody = row.tokens.length>=8 ? 30 : 40;
 if (body.length>=minimumBody && joined.includes(body)) return { method:'full-body-contained', bodyCoverage:1, sourceCoverage:body.length/joined.length, matchedCharacters:body.length, matchedText:row.tokens.join(' '), reportingPhraseIgnored };
 if (joined.length>=60 && body.includes(joined)) return { method:'source-excerpt-contained', bodyCoverage:joined.length/body.length, sourceCoverage:1, matchedCharacters:joined.length, matchedText:source.join(' ') };
 const sourceCore=speechCore(source), bodyCore=speechCore(row.tokens);
 const sc=sourceCore.join(''),bc=bodyCore.join('');
 if (bc.length>=60 && bodyCore.length>=12 && sc.includes(bc) && bc.length/sc.length>=0.7)
  return {method:'full-speech-contained',bodyCoverage:bc.length/body.length,sourceCoverage:bc.length/sc.length,matchedCharacters:bc.length,matchedText:bodyCore.join(' ')};
 if (sc.length>=80 && sourceCore.length>=12 && bc.includes(sc) && sc.length/bc.length>=0.7)
  return {method:'substantial-speech-excerpt',bodyCoverage:sc.length/bc.length,sourceCoverage:1,matchedCharacters:sc.length,matchedText:sourceCore.join(' ')};
 const span = commonSpan(source, row.tokens);
 if (span.tokens<6 || span.text.replace(/ /g,'').length<35) return null;
 return { method:'shared-contiguous-span', bodyCoverage:span.tokens/row.tokens.length, sourceCoverage:span.tokens/source.length,
  matchedCharacters:span.text.replace(/ /g,'').length, matchedText:span.text };
}
function makeIndex(rows) {
 const index = new Map();
 rows.forEach((row,i) => {
  const grams = new Set();
  for(let j=0;j<row.tokens.length-2;j++) grams.add(row.tokens.slice(j,j+3).join(' '));
  for(const gram of grams) { if(!index.has(gram)) index.set(gram,[]); index.get(gram).push(i); }
 });
 return index;
}
function identify(post, rows, index = makeIndex(rows)) {
 const ref = parseReference(post.sources[0]);
 const source = words(post.arabic);
 const sourcePhraseIgnored = words(post.arabic,true).length !== source.length;
 const base = {sourceId:post.id, url:post.url, title:post.title, sourceArabic:post.arabic, reference:ref, singleReport:post.singleReport};
 if (!source.length) return {...base,status:'missing-arabic',matches:[]};
 const exact = rows.filter(r => ref.number && String(r.num).toLowerCase()===ref.number);
 const alternate = rows.filter(r => ref.number && String(r.numActual || '').toLowerCase()===ref.number && !exact.includes(r));
 const votes=new Map();
 for(let i=0;i<source.length-2;i++) for(const rowId of index.get(source.slice(i,i+3).join(' ')) || []) votes.set(rowId,(votes.get(rowId)||0)+1);
 const ranked=[...votes].sort((a,b)=>b[1]-a[1]);
 // Include ties at the retrieval cutoff: do not silently declare a tied match unique.
 const cutoff=ranked[19]?.[1] || 1;
 const retrieved=ranked.filter(([,n])=>n>=cutoff).map(([i])=>rows[i]);
 const pool=[...new Set([...exact,...alternate,...retrieved])];
 const matches=pool.map(row=>{
  const proof=evidence(source,row,sourcePhraseIgnored); if(!proof)return null;
  const numberMatch=exact.includes(row)?'canonical':alternate.includes(row)?'alternate':'different';
  const minimumConfirmed = row.tokens.length>=8 ? 30 : 60;
  const confirmed=numberMatch==='canonical' && (
   (proof.method==='full-body-contained' && proof.matchedCharacters>=minimumConfirmed && proof.sourceCoverage>=0.35)
   || ['full-speech-contained','substantial-speech-excerpt'].includes(proof.method));
  return {hadithId:row.id,ref:`${ref.alias}:${row.num}`,numberMatch,confirmed,protection:protection(row),...proof};
 }).filter(Boolean).sort((a,b)=>Number(b.confirmed)-Number(a.confirmed) || (b.method==='full-body-contained')-(a.method==='full-body-contained') || b.sourceCoverage-a.sourceCoverage || b.matchedCharacters-a.matchedCharacters);
 const confirmed=matches.filter(m=>m.confirmed);
 const status=confirmed.length===1?'identified':confirmed.length>1?'ambiguous':matches.length?'review-required':exact.length?'reference-text-mismatch':'reference-not-found';
 return {...base,status,matchedCount:matches.length,matches:matches.slice(0,10),
  ...(confirmed.length===1?{hadithId:confirmed[0].hadithId,titleEligibility:confirmed[0].protection.length?'protected':!post.singleReport?'multiple-source-blocks':'eligible'}:{})};
}
async function run(out) {
 const mysql=require('mysql'),util=require('util');
 const config=JSON.parse(fs.readFileSync(path.join(os.homedir(),'.hadithdb/settings.json'),'utf8')).mysql.connection;
 const db=mysql.createConnection(config),query=util.promisify(db.query).bind(db);
 const posts=fs.readFileSync(path.join(out,'hadiths.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 const report=[];
 try {
  await query('SET TRANSACTION READ ONLY');
  await query('START TRANSACTION WITH CONSISTENT SNAPSHOT');
  const books=await query('SELECT id,alias,name_en FROM books');
  const revisions=await query("SHOW TABLES LIKE 'hadith_arabic_revision_state'");
  const grouped=new Map();
  for(const post of posts) {
   const ref=parseReference(post.sources[0]);
   if(!ref.alias) {report.push({sourceId:post.id,url:post.url,title:post.title,reference:ref,status:ref.reason,matches:[]});continue;}
   if(!grouped.has(ref.alias))grouped.set(ref.alias,[]);grouped.get(ref.alias).push(post);
  }
  for(const [alias,batch] of grouped) {
   const book=books.find(b=>b.alias===alias);
   if(!book) {report.push(...batch.map(p=>({sourceId:p.id,status:'collection-not-in-database',matches:[]})));continue;}
   const rows=(await query(`SELECT h.id,h.num,h.numActual,h.body,h.title,h.title_en,h.lastfixed,h.lastmod_user,h.temp_trans,h.verified,
    ${revisions.length?'EXISTS(SELECT 1 FROM hadith_arabic_revision_state r WHERE r.hadith_id=h.id)':'0'} AS arabic_revised
    FROM hadiths h WHERE h.bookId=? AND h.remark<>2`,[book.id])).map(prepare);
   const index=makeIndex(rows);
   report.push(...batch.map(post=>identify(post,rows,index)));
   console.log(`${alias}: searched ${rows.length} records for ${batch.length} articles`);
  }
 } finally { await query('ROLLBACK').catch(()=>{}); db.end(); }
 const counts=new Map();
 for(const item of report.filter(r=>r.status==='identified')) counts.set(item.hadithId,(counts.get(item.hadithId)||0)+1);
 for(const item of report) if(item.titleEligibility==='eligible' && counts.get(item.hadithId)>1)item.titleEligibility='multiple-articles-for-record';
 report.sort((a,b)=>a.sourceId-b.sourceId);
 const summary={articles:report.length,statuses:{},titleEligibility:{},uniqueIdentifiedHadiths:counts.size,reviewEvidence:{},aiTokens:0,readOnly:true};
 for(const item of report){summary.statuses[item.status]=(summary.statuses[item.status]||0)+1;if(item.titleEligibility)summary.titleEligibility[item.titleEligibility]=(summary.titleEligibility[item.titleEligibility]||0)+1;}
 for(const item of report.filter(r=>r.status==='review-required')) {
  const top=item.matches[0],key=`${top.numberMatch}/${top.method}`;
  summary.reviewEvidence[key]=(summary.reviewEvidence[key]||0)+1;
 }
 fs.writeFileSync(path.join(out,'identification-report.json'),JSON.stringify(report,null,2)+'\n');
 fs.writeFileSync(path.join(out,'identification-summary.json'),JSON.stringify(summary,null,2)+'\n');
 console.log(JSON.stringify(summary));
 return summary;
}
module.exports={parseReference,words,prepare,evidence,identify,makeIndex,speechCore,run};
if(require.main===module)run(path.resolve(process.argv[2] || 'data/abuamina')).catch(e=>{console.error(e.message);process.exitCode=1;});
