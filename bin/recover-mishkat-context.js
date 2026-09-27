#!/usr/bin/env node
'use strict';
// Read-only candidate generation from fresh EPUB, source-filtered ES, and live SQL.
require('dotenv').config();
const fs=require('fs'),assert=require('assert/strict'),crypto=require('crypto'),mysql=require('mysql'),{promisify}=require('util'),axios=require('axios'),os=require('os'),path=require('path'),zlib=require('zlib');
const Match=require('./utils/mishkat-match-evidence'),priority=require('./recover-mishkat-priority');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
function sourceScope(h,books){
 // A compiler's negative lookup is not an attribution to the two Sahihs.
 const plain=require('./recover-mishkat-text-pass2').canonical(h.text);
 if(/لم اجده في الصحيحين.*ولكن ذكره صاحب الجامع بروايه النسايي/.test(plain))return priority.policy({...h,sources:['nasai'],editorialCitationKeys:[]},books);
 return priority.policy(Match.isReferenceOnly(h)?{...h,sources:[...require('./import-mishkat-epub').sources(h.text),...(/البيهقي.*شعب الايمان/.test(require('./recover-mishkat-text-pass2').canonical(h.text))?['shuab']:[])],editorialCitationKeys:[]}:h,books);}
async function main(){
 const bytes=fs.readFileSync('temp/mishkat-import-review.json'),report=JSON.parse(bytes),original=require('./import-mishkat-epub').parse();assert.equal(original.sha256,report.sha256);
 const reportByNumber=new Map(report.entries.map(h=>[h.number,h]));
 const entries=Match.prepareEntries(original.entries.flatMap(h=>h.numbers.map(number=>({...reportByNumber.get(number),...h,number,splitNarrator:null,splitSegments:null}))));
 const db=mysql.createConnection(require('./initializeHadithAttributions').connectionSettings()),q=promisify(db.query).bind(db);
 try{
 const aliases=await q("SELECT v.*,b.alias sourceAlias FROM hadiths_virtual v JOIN hadiths h ON h.id=v.hadithId JOIN books b ON b.id=h.bookId WHERE v.bookId=100419 AND b.alias IN ('misc','suyuti') ORDER BY v.num0,v.id");
 const books=await q("SELECT id,alias,name,ordinal,`virtual` FROM books WHERE type='hadith' AND `virtual`=0");
 const selected=aliases.map(a=>{const h=entries.find(e=>e.number===Math.floor(a.num0));assert(h);const e=Match.contextualWording(h,entries),scope=sourceScope(h,books);scope.aliases=scope.aliases.filter(b=>!['misc','suyuti'].includes(b));return {aliasId:a.id,number:h.number,oldId:a.hadithId,from:a.ref_num,originalText:h.text,sourceFile:h.file,scope,...e,text:undefined,contextTexts:(e.contextNumbers||[]).map(n=>({number:n,text:entries.find(h=>h.number===n).text}))};});
 const settings=JSON.parse(fs.readFileSync(path.join(os.homedir(),'.hadithdb/settings.json')));global.settings=settings;const config=require('../lib/SearchHttp').axiosConfig;
 const cacheFile='temp/mishkat-context-search.json',cache=fs.existsSync(cacheFile)?JSON.parse(fs.readFileSync(cacheFile)):{};
 for(let i=0;i<selected.length;i+=20){const batch=selected.slice(i,i+20).filter(h=>h.scope.aliases.length&&h.segments.length&&cache[h.aliasId]?.querySha!==sha(JSON.stringify([h.segments,h.scope.aliases])));if(!batch.length)continue;
 const body=batch.map(h=>JSON.stringify({index:'hadiths'})+'\n'+JSON.stringify({size:10,_source:['hId','ref','book_alias','chain','body'],query:{bool:{filter:[{terms:{book_alias:h.scope.aliases}}],must:[{multi_match:{query:h.segments.join(' '),fields:['body^3','chain'],type:'best_fields'}}]}}})).join('\n')+'\n';
 const r=await axios.post(settings.search.domain+'/_msearch',zlib.gzipSync(body),config({headers:{'Content-Type':'application/x-ndjson','Content-Encoding':'gzip'},timeout:120000}));assert.equal(r.data.responses.length,batch.length);
 r.data.responses.forEach((response,j)=>{assert(!response.error);cache[batch[j].aliasId]={querySha:sha(JSON.stringify([batch[j].segments,batch[j].scope.aliases])),hits:response.hits.hits.map(hit=>({id:Number(hit._id),ref:hit._source.ref,alias:hit._source.book_alias,chain:hit._source.chain,body:hit._source.body,esScore:hit._score}))};});fs.writeFileSync(cacheFile,JSON.stringify(cache));if(i%100===0)console.log({searched:Math.min(i+20,selected.length),total:selected.length});
 }
 const flags=new Set(JSON.parse(fs.readFileSync('temp/mishkat-es-muttafaq-flags.json')));
 const resolved=[],pending=[];
 for(const h of selected){
 const candidates=(cache[h.aliasId]?.hits||[]).filter(c=>h.scope.aliases.includes(c.alias)).map(c=>({...c,evidence:Match.evidence(h,c)}));
 const supported=candidates.filter(c=>h.scope.mode==='cited-books'&&c.evidence.coverage===1&&((c.evidence.narrator&&c.evidence.words>=8&&c.evidence.score>=.9)||(c.evidence.words>=12&&c.evidence.score>=.97)||(h.referenceOnly&&c.evidence.narrator&&c.evidence.words>=6&&c.evidence.score===1))&&(!(!h.narrator&&/متفق عليه/.test(require('./recover-mishkat-text-matches').normalize(h.originalText)))||c.alias==='bukhari'&&flags.has(c.id)));
 supported.sort((a,b)=>b.evidence.score-a.evidence.score||Number(b.evidence.narrator)-Number(a.evidence.narrator)||Number(b.alias==='bukhari')-Number(a.alias==='bukhari')||a.ref.localeCompare(b.ref,'en',{numeric:true}));
 const best=supported[0],item={...h,candidates:(best?[best,...candidates.filter(c=>c.id!==best.id)]:candidates).slice(0,4)};
 if(best){item.targetId=best.id;item.ref=best.ref;item.method=h.referenceOnly?'recursive-reference-original-epub':'improved-original-epub-wording';resolved.push(item);}else{item.reason=h.referenceIssue||(!h.scope.aliases.length?'source-unavailable':!h.segments.length?'no-matching-text':'requires-individual-wording-review');pending.push(item);}
 }
 const ids=[...new Set(resolved.map(h=>h.targetId))],candidates=ids.length?await q('SELECT h.id,h.bookId,h.num,h.chain,h.body,h.text,b.alias FROM hadiths h JOIN books b ON b.id=h.bookId WHERE h.id IN (?)',[ids]):[];
 for(const h of resolved){const c=candidates.find(c=>c.id===h.targetId);assert(c&&h.scope.aliases.includes(c.alias));assert.deepEqual(Match.evidence(h,c),h.candidates[0].evidence);h.audit={approved:true,reason:'Fresh original EPUB, cited-source-only candidate, complete wording coverage meeting reviewed evidence criteria; target revalidated in live SQL.',targetSha256:sha(JSON.stringify([c.id,c.bookId,c.num,c.chain,c.body]))};h.noteAddition='\n\nلفظ الرواية في مشكاة المصابيح:\n'+h.originalText+(h.referenceOnly?'\n\nإحالة إلى الرواية السابقة في مشكاة المصابيح ('+h.contextNumbers.join('، ')+'):\n'+h.contextTexts.at(-1).text:'');}
 const stats={examined:selected.length,resolved:resolved.length,pending:pending.length,fromMisc:resolved.filter(h=>h.from.startsWith('misc:')).length,fromSuyuti:resolved.filter(h=>h.from.startsWith('suyuti:')).length,referenceOnly:selected.filter(h=>h.referenceOnly).length,referenceResolved:resolved.filter(h=>h.referenceOnly).length};
 fs.writeFileSync('temp/mishkat-context-live.json',JSON.stringify({aliases,books,candidates}));fs.writeFileSync('temp/mishkat-context-plan.json',JSON.stringify({sourceSha256:original.sha256,baseReportSha256:sha(bytes),stats,resolved,pending},null,2));console.log(stats);
 }finally{db.destroy();}
}
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});

module.exports={sourceScope};
