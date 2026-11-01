#!/usr/bin/env node
'use strict';
// No model calls. Public WordPress content API; database access is READ ONLY.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const cheerio = require('cheerio');
const API = 'https://www.abuaminaelias.com/dailyhadithonline/wp-json/wp/v2/posts';
const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const latin = value => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[‘’ʿʾ']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const arabic = value => clean(cheerio.load(String(value || '')).text()).normalize('NFKD').replace(/صلى الله عليه وسلم/g, '').replace(/[\u064b-\u065f\u0670]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/[^\u0621-\u063a\u0641-\u064a]/g, '');
const BOOKS = new Map(Object.entries({
 'Sahih al-Bukhari':1, 'Sahih Muslim':2, 'Sunan al-Nasai':3,
 'Sunan Abi Dawud':4, 'Sunan Abu Dawud':4, 'Sunan al-Tirmidhi':5,
 'Sunan Ibn Majah':6, 'Muwatta Malik':7, 'Musnad Ahmad':8,
 'Sunan al-Darimi':9, 'al-Mustadrak ala al-Sahihayn':10,
 'Sahih Ibn Hibban':11, 'al-Mujam al-Kabir lil-Tabarani':12,
 'al-Adab al-Mufrad lil-Bukhari':15, 'al-Adab al-Mufrad':15,
 'Sahih Ibn Khuzaymah':17, 'Sunan al-Daraqutni':18
}).map(([name,id]) => [latin(name),id]));
function reference(text) {
 const m = clean(text).replace(/^Source:\s*/i, '').match(/^(.+?)\s+(\d+[a-z]?)$/i);
 return m && BOOKS.has(latin(m[1])) ? {bookId:BOOKS.get(latin(m[1])), number:m[2]} : null;
}
function parse(post) {
 if (!Number.isInteger(post.id) || !post.link?.startsWith('https://www.abuaminaelias.com/dailyhadithonline/')) throw Error('Invalid source record');
 const $ = cheerio.load(post.content?.rendered || '');
 const paragraphs = $('p').map((_,p) => clean($(p).text())).get().filter(Boolean);
 const sourceIndex = paragraphs.findIndex(p => /^Source:/i.test(p));
 const sources = paragraphs.filter(p => /^Source:/i.test(p));
 const grades = paragraphs.filter(p => /^Grade:/i.test(p));
 const arabicParagraphs = paragraphs.filter(p => (p.match(/[\u0621-\u064a]/g)||[]).length > 40 && !/^\d/.test(p));
 return {id:post.id,url:post.link,modified:post.modified,title:clean(cheerio.load(post.title?.rendered || '').text()),
  translation:sourceIndex > 0 ? paragraphs.slice(0,sourceIndex).join('\n\n') : null,
  arabic:arabicParagraphs[0] || null, sources, grades, reference:reference(sources[0]),
  // Multiple reports/commentaries must be reviewed, even if a reference is known.
  singleReport:sources.length===1 && arabicParagraphs.length===1,
  paragraphs};
}
function protectedRecord(row) {
 return Boolean(clean(row.title) || clean(row.title_en) || row.lastfixed || row.lastmod_user || row.arabic_revised || row.temp_trans || row.verified);
}
function proposal(post, rows) {
 const matches = rows.filter(row => row.bookId===post.reference?.bookId && String(row.num)===post.reference.number);
 const confirmed = matches.filter(row => {
  const body=arabic(row.body), source=arabic(post.arabic);
  return body.length>=60 && source.includes(body) && body.length/source.length>=0.75;
 });
 if (confirmed.length!==1) return {sourceId:post.id,reason:confirmed.length>1?'ambiguous':'no-full-text-match'};
 const row=confirmed[0];
 if(protectedRecord(row)) return {sourceId:post.id,hadithId:row.id,reason:'existing-title-or-revision'};
 if(!post.singleReport) return {sourceId:post.id,hadithId:row.id,reason:'multiple-source-blocks'};
 return {sourceId:post.id,hadithId:row.id,url:post.url,reason:'candidate',
  missing:{title_en:post.title,...(!clean(row.body_en) && !clean(row.text_en) ? {body_en:post.translation}: {})},
  // Preserve the named scholar's wording; do not infer or automatically map a grade.
  gradeForReview:row.gradeId==null || row.gradeId===-1 ? post.grades : [],
  translator:'Abu Amina Elias (Justin Parrott)'};
}
function writeJson(file, data) {fs.writeFileSync(file+'.tmp',JSON.stringify(data,null,2)+'\n');fs.renameSync(file+'.tmp',file);}
function fetchPage(page) {
 const url=`${API}?per_page=100&page=${page}&orderby=id&order=asc&_fields=id,link,title,content,modified`;
 const headers=path.join(os.tmpdir(),`abuamina-headers-${process.pid}`);
 try {
  const data=JSON.parse(execFileSync('curl',['--fail','--location','--silent','--show-error','--retry','3','--max-time','60','--dump-header',headers,url],{maxBuffer:20*1024*1024}).toString());
  const h=fs.readFileSync(headers,'utf8');
  const total=Number(h.match(/x-wp-total:\s*(\d+)/i)?.[1]);
  const pages=Number(h.match(/x-wp-totalpages:\s*(\d+)/i)?.[1]);
  if(!Array.isArray(data)||!total||!pages) throw Error('Missing pagination metadata');
  return {data,total,pages};
 } finally {fs.rmSync(headers,{force:true});}
}
async function planDb(posts, out) {
 const mysql=require('mysql'),util=require('util');
 const config=JSON.parse(fs.readFileSync(path.join(os.homedir(),'.hadithdb/settings.json'),'utf8')).mysql.connection;
 const db=mysql.createConnection(config),query=util.promisify(db.query).bind(db);
 try {
  await query('SET TRANSACTION READ ONLY');
  await query('START TRANSACTION WITH CONSISTENT SNAPSHOT');
  const exists=await query("SHOW TABLES LIKE 'hadith_arabic_revision_state'");
  const rows=[];
  for(const bookId of new Set(posts.map(p=>p.reference?.bookId).filter(Boolean))) {
   const numbers=[...new Set(posts.filter(p=>p.reference?.bookId===bookId).map(p=>p.reference.number))];
   rows.push(...await query(`SELECT h.id,h.bookId,h.num,h.title,h.title_en,h.body,h.body_en,h.text_en,h.gradeId,h.lastfixed,h.lastmod_user,h.temp_trans,h.verified,
    ${exists.length?'EXISTS(SELECT 1 FROM hadith_arabic_revision_state r WHERE r.hadith_id=h.id)':'0'} AS arabic_revised
    FROM hadiths h WHERE h.bookId=? AND h.num IN (?)`,[bookId,numbers]));
  }
  const report=posts.map(post=>post.reference?proposal(post,rows):{sourceId:post.id,reason:'unsupported-reference'});
  const counts=new Map();
  report.filter(p=>p.reason==='candidate').forEach(p=>counts.set(p.hadithId,(counts.get(p.hadithId)||0)+1));
  report.forEach(p=>{if(p.reason==='candidate' && counts.get(p.hadithId)>1){p.reason='multiple-articles-for-record';delete p.missing;}});
  writeJson(path.join(out,'enrichment-plan.json'),report);
  console.log(JSON.stringify(report.reduce((a,p)=>(a[p.reason]=(a[p.reason]||0)+1,a),{})));
 } finally {await query('ROLLBACK').catch(()=>{});db.end();}
}
async function main(args=process.argv.slice(2)) {
 const allowed=new Set(['--out','--offline','--plan-db','--identify-db','--help']);
 for(let i=0;i<args.length;i++){if(!allowed.has(args[i]))throw Error(`Unknown option: ${args[i]}`);if(args[i]==='--out'){if(!args[i+1]||args[i+1].startsWith('--'))throw Error('--out needs a directory');i++;}}
 if(args.includes('--help')) {console.log('node bin/utils/download-abuamina-hadiths.js [--out DIR] [--offline] [--plan-db] [--identify-db]\nDownloads public articles; --offline rebuilds from cache; --plan-db produces the conservative enrichment plan; --identify-db expands read-only identification with evidence and review candidates. No database writes or AI calls.');return;}
 const out=path.resolve(args.includes('--out')?args[args.indexOf('--out')+1]:'data/abuamina');
 fs.mkdirSync(out,{recursive:true});
 const manifestFile=path.join(out,'manifest.json');
 let manifest;
 if(args.includes('--offline')) manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
 else {
  const first=fetchPage(1);
  manifest={api:API,total:first.total,pages:first.pages,downloadedAt:new Date().toISOString(),order:'id-asc'};
  writeJson(path.join(out,'page-1.json'),first.data);
  for(let page=2;page<=first.pages;page++) {
   const batch=fetchPage(page);
   if(batch.total!==first.total||batch.pages!==first.pages)throw Error('Source changed during download; rerun before using this dataset');
   writeJson(path.join(out,`page-${page}.json`),batch.data);
   if(page%10===0)console.log(`Downloaded ${page}/${first.pages} pages`);
   await new Promise(resolve=>setTimeout(resolve,400));
  }
  writeJson(manifestFile,manifest);
 }
 const raw=[];
 for(let page=1;page<=manifest.pages;page++)raw.push(...JSON.parse(fs.readFileSync(path.join(out,`page-${page}.json`),'utf8')));
 if(raw.length!==manifest.total || new Set(raw.map(p=>p.id)).size!==manifest.total)throw Error('Incomplete or duplicate source dataset');
 const posts=raw.map(parse);
 fs.writeFileSync(path.join(out,'hadiths.jsonl'),posts.map(p=>JSON.stringify(p)).join('\n')+'\n');
 writeJson(path.join(out,'summary.json'),{articles:posts.length,mappedReferences:posts.filter(p=>p.reference).length,singleReports:posts.filter(p=>p.singleReport).length,aiTokens:0});
 console.log(`Saved ${posts.length} articles to ${out}; AI tokens: 0`);
 if(args.includes('--plan-db'))await planDb(posts,out);
 if(args.includes('--identify-db'))await require('./identify-abuamina-hadiths').run(out);
}
module.exports={parse,reference,protectedRecord,proposal,arabic};
if(require.main===module)main().catch(err=>{console.error(err.message);process.exitCode=1;});
