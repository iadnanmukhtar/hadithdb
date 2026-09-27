#!/usr/bin/env node
'use strict';
// Read-only, balanced per-book retrieval. Review candidates before applying.
require('dotenv').config();const fs=require('fs'),assert=require('assert/strict'),crypto=require('crypto'),mysql=require('mysql'),{promisify}=require('util'),axios=require('axios'),os=require('os'),path=require('path'),zlib=require('zlib');
const M=require('./utils/mishkat-match-evidence'),{sourceScope}=require('./recover-mishkat-context'),sha=x=>crypto.createHash('sha256').update(x).digest('hex');
async function main(){
 const bytes=fs.readFileSync('temp/mishkat-import-review.json'),report=JSON.parse(bytes),original=require('./import-mishkat-epub').parse();assert.equal(original.sha256,report.sha256);
 const reportMap=new Map(report.entries.map(h=>[h.number,h])),entries=M.prepareEntries(original.entries.flatMap(h=>h.numbers.map(number=>({...reportMap.get(number),...h,number,splitNarrator:null,splitSegments:null}))));
 const db=mysql.createConnection(require('./initializeHadithAttributions').connectionSettings()),q=promisify(db.query).bind(db);
 try{
 const aliases=await q("SELECT v.*,b.alias sourceAlias FROM hadiths_virtual v JOIN hadiths h ON h.id=v.hadithId JOIN books b ON b.id=h.bookId WHERE v.bookId=100419 AND b.alias IN ('misc','suyuti') ORDER BY v.num0,v.id"),books=await q("SELECT id,alias,name,ordinal,`virtual` FROM books WHERE type='hadith' AND `virtual`=0");
 const selected=aliases.map(a=>{const h=entries.find(e=>e.number===Math.floor(a.num0));assert(h);const e=M.contextualWording(h,entries),scope=sourceScope(h,books);scope.aliases=scope.aliases.filter(b=>!['misc','suyuti'].includes(b));return {aliasId:a.id,number:h.number,oldId:a.hadithId,from:a.ref_num,originalText:h.text,sourceFile:h.file,scope,...e,text:undefined,rankingText:M.rankingText(h,entries)};}).filter(h=>h.scope.mode==='cited-books'&&h.scope.aliases.length>1);
 const settings=JSON.parse(fs.readFileSync(path.join(os.homedir(),'.hadithdb/settings.json')));global.settings=settings;const config=require('../lib/SearchHttp').axiosConfig;
 const cacheFile='temp/mishkat-multisource-search.json',cache=fs.existsSync(cacheFile)?JSON.parse(fs.readFileSync(cacheFile)):{};
 const requests=selected.flatMap(h=>h.scope.aliases.map(alias=>({h,alias,key:h.aliasId+':'+alias,query:[h.rankingText,...h.segments].join(' ')}))).filter(r=>r.query.trim());
 for(let i=0;i<requests.length;i+=20){const batch=requests.slice(i,i+20).filter(r=>cache[r.key]?.querySha!==sha(r.query));if(!batch.length)continue;
 const body=batch.map(r=>JSON.stringify({index:'hadiths'})+'\n'+JSON.stringify({size:8,_source:['ref','book_alias','chain','body'],query:{bool:{filter:[{term:{book_alias:r.alias}}],must:[{multi_match:{query:r.query,fields:['body^3','chain'],type:'best_fields'}}]}}})).join('\n')+'\n';
 const result=await axios.post(settings.search.domain+'/_msearch',zlib.gzipSync(body),config({headers:{'Content-Type':'application/x-ndjson','Content-Encoding':'gzip'},timeout:120000}));assert.equal(result.data.responses.length,batch.length);
 result.data.responses.forEach((r,j)=>{assert(!r.error);cache[batch[j].key]={querySha:sha(batch[j].query),hits:r.hits.hits.map(hit=>({id:Number(hit._id),ref:hit._source.ref,alias:hit._source.book_alias,chain:hit._source.chain,body:hit._source.body}))};});fs.writeFileSync(cacheFile,JSON.stringify(cache));if(i%100===0)console.log({searched:Math.min(i+20,requests.length),total:requests.length});
 }
 const proposed=[],pending=[];
 for(const h of selected){const candidates=h.scope.aliases.flatMap(alias=>cache[h.aliasId+':'+alias]?.hits||[]).map(c=>({...c,wording:M.wordingSimilarity(h.rankingText,M.sourceMatn(c)),evidence:M.evidence(h,c)})).sort((a,b)=>M.compareCandidates(a,b,books));
 const best=candidates[0],item={...h,candidates:candidates.slice(0,6),perBook:h.scope.aliases.map(alias=>candidates.find(c=>c.alias===alias)).filter(Boolean)};
 if(best&&best.wording.words>=8&&best.wording.score>=.78){item.targetId=best.id;item.ref=best.ref;item.method='per-book-retrieval-best-wording-then-ordinal';proposed.push(item);}else pending.push(item);
 }
 const ids=[...new Set(proposed.map(h=>h.targetId))],candidates=ids.length?await q('SELECT h.id,h.bookId,h.num,h.chain,h.body,h.text,b.alias FROM hadiths h JOIN books b ON b.id=h.bookId WHERE h.id IN (?)',[ids]):[];
 for(const h of proposed){const c=candidates.find(c=>c.id===h.targetId);assert(c);assert.equal(c.chain,h.candidates[0].chain);assert.equal(c.body,h.candidates[0].body);}
 const stats={remaining:aliases.length,examined:selected.length,bookSearches:requests.length,proposed:proposed.length,pending:pending.length};
 fs.writeFileSync('temp/mishkat-multisource-live.json',JSON.stringify({aliases,books,candidates}));fs.writeFileSync('temp/mishkat-multisource-plan.json',JSON.stringify({sourceSha256:original.sha256,baseReportSha256:sha(bytes),stats,proposed,pending},null,2));console.log(stats);console.log([...proposed,...pending].find(h=>h.number===1078));
 }finally{db.destroy();}
}
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});
