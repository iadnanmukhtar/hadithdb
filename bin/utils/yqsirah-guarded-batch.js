#!/usr/bin/env node
'use strict';
// Local Sirah maintenance runner. The original publication lock, state and backup
// guards remain in publish-reviewed.js. This file is not a production deploy step.
const fs=require('node:fs');
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const crypto=require('node:crypto');
const path=require('node:path');
const BOOK=100427;
const DIR='var/imports/yqsirah/formatting/';
const PUB=DIR+'publication/';
const PUBLISHER=PUB+'publish-reviewed.js';
const DRAFT=DIR+'draft.json';
const LEDGER='data/yqsirah-formatting.json';
const SOURCE='var/imports/yqsirah/reimport/full-source-plan.json';
const KEYS=['body_en','text','body_en_search','footnote_en','footnote_en_search'];
const hashed=x=>crypto.createHash('sha256').update(x).digest('hex');
const same=(x,y)=>require('node:util').isDeepStrictEqual(x,y);
const stateValid=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const backupValid=x=>typeof x==='string'&&/^yqsirah_format_h_\d+$/.test(x);
const trimmed=x=>typeof x==='string'?x.trim():x;
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));

function args(values){
 const has=new Map();
 for(const v of values){
  const m=v.match(/^--(ids|expected-state)=(.+)$/);
  const key=m?.[1]||v;
  assert(m||v==='--apply'||v==='--resume-index-only','Unexpected argument');
  assert(!has.has(key),'Duplicate argument');
  has.set(key,m?.[2]||true);
 }
 const csv=has.get('ids');
 assert(typeof csv==='string'&&/^[1-9]\d{0,3}(?:,[1-9]\d{0,3})*$/.test(csv),'Use --ids with exact passage numbers');
 const ids=csv.split(',').map(Number).sort((a,b)=>a-b);
 assert(ids.length>0&&ids.length<=25&&ids.every(n=>n<=1023),'Use a bounded batch of 1–25 corpus passages');
 assert.equal(new Set(ids).size,ids.length,'Duplicate passage ID');
 assert(!(has.has('--apply')&&has.has('--resume-index-only')),'Apply and index-only resume are separate modes');
 const mode=has.has('--apply')?'apply':has.has('--resume-index-only')?'resume':'dry';
 const state=has.get('expected-state');
 if(mode==='dry')assert(state===undefined,'State is only valid for apply or index-only resume');
 else assert(stateValid(state),'Exact --expected-state is required');
 return {ids,state,mode};
}
function checkReport(report, ids, options={}){
 assert.equal(report.bookId, BOOK);
 assert.equal(report.applied, !!options.applied);
 assert.deepEqual(report.changed,ids,'Guarded publisher changed set does not exactly match requested IDs');
 assert(stateValid(report.state),'Invalid publisher state');
 if(options.state)assert.equal(report.state,options.state,'Live state changed');
 if(options.sourceHash)assert.equal(report.source_sha256,options.sourceHash,'Publication source fingerprint mismatch');
 if(options.applied)assert(backupValid(report.backup),'Invalid committed backup reference');
 else assert.equal(report.backup,null);
}
function staged(ids){
 const source=read(SOURCE), ledgerRaw=fs.readFileSync(LEDGER,'utf8'), draftRaw=fs.readFileSync(DRAFT,'utf8');
 const manifest=JSON.parse(ledgerRaw), draft=JSON.parse(draftRaw).draft;
 const entries=ids.map(n=>source.entries.find(e=>e.num===n));
 const selected=ids.map(n=>draft.find(e=>e.num===n));
 for(let i=0;i<ids.length;i++){
  const p=manifest.passages[ids[i]];
  assert(p?.status==='reviewed'&&!p.citationFlags?.length&&p.retainOriginalTranscript===true,'Passage is not reviewed with exact archived source: '+ids[i]);
  assert.equal(selected[i]?.fields.title.text,entries[i]?.title,'Title differs from original');
  const strip=require('./yqsirah-quote-separator').stripQuoteSeparators;
  for(const field of ['body','footnotes'])assert.equal(strip(selected[i].fields[field].text).removed,0,'Synthetic quote separator still present: '+ids[i]+'/'+field);
 }
 const rebuilt=require('./format-yqsirah').buildDraft({entries},manifest);
 assert.deepEqual(rebuilt,selected,'Generated draft is stale');
 return {entries,selected,sourceHash:source.source_sha256,unchanged(){
  assert.equal(hashed(fs.readFileSync(LEDGER,'utf8')),hashed(ledgerRaw),'Ledger changed during run');
  assert.equal(hashed(fs.readFileSync(DRAFT,'utf8')),hashed(draftRaw),'Generated draft changed during run');
 }};
}
function fieldPlan(row, before, doc, source, draft){
 const n=source.num,id=Number(row.id),s=doc._source;
 const bookPath='yqsirah/'+[source.h1,source.h2,source.h3].filter(x=>Number(x)>0).join('/');
 for(const r of [row,before]){
  assert.equal(Number(r.id),id,'Unexpected database stable ID');
  assert.equal(Number(r.bookId),BOOK,'Unexpected database book');
  assert.equal(Number(r.num),n,'Unexpected database passage');
  for(const key of ['h1','h2','h3'])assert.equal(Number(r[key])||null,Number(source[key])||null,'Unexpected database heading');
  assert.equal(r.title_en,source.title,'Unexpected database title');
 }
 assert.equal(String(doc._id),String(id),'Index response ID mismatch');
 assert.equal(Number(s.hId),id,'Indexed stable ID mismatch');
 assert.equal(Number(s.book_id),BOOK,'Indexed book mismatch');
 assert.equal(Number(s.num),n,'Indexed passage mismatch');
 assert.equal(s.book_alias,'yqsirah');
 assert.equal(s.ref,'yqsirah:'+n);
 assert.equal(s.path?.replace(/^\//,''),bookPath,'Indexed canonical path mismatch');
 assert.equal(s.title_en,source.title,'Indexed title mismatch');
 assert(Number.isInteger(doc._seq_no)&&Number.isInteger(doc._primary_term),'No conditional index write token');
 const wish=draft.fields;
 const expected={body_en:wish.body.text,text_en:wish.body.text,footnote_en:wish.footnotes.text};
 for(const k of Object.keys(expected))
  assert(same(row[k],before[k])||same(row[k],expected[k]),'Unexpected database content '+n+'/'+k);
 const old={body_en:before.body_en,text:before.text_en,body_en_search:trimmed(before.body_en)};
 const desired={body_en:expected.body_en,text:expected.text_en,body_en_search:trimmed(expected.body_en)};
 if(!same(expected.footnote_en,before.footnote_en)){
  assert(trimmed(expected.footnote_en)&&trimmed(before.footnote_en),'Unexpected addition or removal of full footnotes');
  old.footnote_en=before.footnote_en;old.footnote_en_search=trimmed(before.footnote_en);
  desired.footnote_en=expected.footnote_en;desired.footnote_en_search=trimmed(expected.footnote_en);
 }
 for(const k of Object.keys(desired)){
  assert(KEYS.includes(k)&&Object.hasOwn(s,k),'Missing pre-existing index field '+n+'/'+k);
  assert(same(s[k],old[k])||same(s[k],desired[k]),'Unexpected indexed revision '+n+'/'+k);
 }
 const patch=Object.fromEntries(Object.entries(desired).filter(([k,v])=>!same(v,s[k])));
 return {n,id,bookPath,doc,desired,patch,expected};
}
function verifyPatch(plan, fetched){
 const s=fetched._source;
 assert.equal(String(fetched._id),String(plan.id),'Index receipt ID changed');
 for(const [k,v] of Object.entries(plan.desired))assert.deepEqual(s[k],v,'Index readback mismatch '+plan.n+'/'+k);
 const unrelated=x=>Object.fromEntries(Object.entries(x).filter(([k])=>!Object.hasOwn(plan.desired,k)));
 assert.deepEqual(unrelated(s),unrelated(plan.doc._source),'Unrelated indexed fields changed '+plan.n);
}
function receipts(state,data){
 const file=PUB+'scoped-index-'+state+'-'+data.startedMs+'.json',tmp=file+'.'+process.pid+'.tmp';
 fs.writeFileSync(tmp,JSON.stringify(data,null,2)+'\n',{mode:0o600});fs.renameSync(tmp,file);return file;
}
function reportFor(ids,state){
 const list=fs.readdirSync(PUB).filter(x=>/^published-\d+\.json$/.test(x))
  .map(x=>read(PUB+x)).filter(x=>x.state===state&&same(x.changed,ids));
 assert.equal(list.length,1,'No unique verified commit receipt for exact requested IDs/state');
 checkReport(list[0],ids,{applied:true,state});
 return list[0];
}
function publish(args=[]){
 const gen=cp.spawnSync(process.execPath,[PUBLISHER,...args],{encoding:'utf8'});
 if(gen.error)throw gen.error;
 if(gen.status!==0)throw Error('Guarded publisher stopped: '+(gen.stderr||'unknown').trim().split('\n')[0]);
 return JSON.parse(gen.stdout);
}
const isExpected=(row,expected)=>Object.entries(expected).every(([k,v])=>same(row[k],v));
function openServices(){
 const mysql=require('mysql'),{promisify}=require('node:util'),settings=read(path.join(require('node:os').homedir(),'.hadithdb/settings.json'));
 global.settings={search:settings.search};
 const connection=mysql.createConnection({...settings.mysql.connection,connectTimeout:10000});
 const query=promisify(connection.query).bind(connection), http=require('../../lib/SearchHttp');
 const base=settings.search.domain.replace(/\/$/,'')+'/hadiths/';
 return {
  close:()=>connection.destroy(),
  async rows(table,ids){
   assert(table==='hadiths'||backupValid(table),'Unexpected SQL table');
   const rows=await query('SELECT id,num,bookId,h1,h2,h3,title_en,body_en,text_en,footnote_en FROM '+table+' WHERE bookId=? AND num IN (?) ORDER BY CAST(num AS UNSIGNED)',[BOOK,ids]);
   assert.deepEqual(rows.map(x=>Number(x.num)),ids,'Unexpected SQL selection');
   return rows;
  },
  get:async id=>(await http.get(base+'_doc/'+id)).data,
  async patch(plan){
   const url=base+'_update/'+plan.id+'?refresh=wait_for&if_seq_no='+plan.doc._seq_no+'&if_primary_term='+plan.doc._primary_term;
   const result=(await http.post(url,{doc:plan.patch},{timeout:45000})).data;
   assert.equal(String(result._id),String(plan.id));assert(['updated','noop'].includes(result.result));return result.result;
  }
 };
}
async function preflight(sv, scope, current, baseline, options={}){
 const work=[];
 for(let i=0;i<current.length;i++){
  const online=await sv.get(current[i].id);
  const workItem=fieldPlan(current[i],baseline[i],online,scope.entries[i],scope.selected[i]);
  if(options.committed)assert(isExpected(current[i],workItem.expected),'DB commit not present '+workItem.n);
  work.push(workItem);
 }
 return work;
}
function safeError(error){
 if(error.code==='ERR_ASSERTION')return String(error.message).split('\n')[0];
 if(error.response?.status)return 'Search HTTP '+error.response.status;
 return error.code||String(error.message||'Unexpected failure').split('\n')[0];
}
async function run(argv){
 const p=args(argv), scope=staged(p.ids);
 if(p.mode==='dry'){
  const dry=publish();checkReport(dry,p.ids,{sourceHash:scope.sourceHash});console.log(JSON.stringify({mode:'dry',commit:null,dry}));return;
 }
 let commit,sv;
 try{
  if(p.mode==='apply'){
   const already=fs.readdirSync(PUB).filter(x=>/^published-\d+\.json$/.test(x))
    .map(x=>read(PUB+x)).some(x=>x.applied&&x.state===p.state&&same(x.changed,p.ids));
   assert(!already,'Commit receipt already exists; use --resume-index-only');
   const dry=publish();checkReport(dry,p.ids,{state:p.state,sourceHash:scope.sourceHash});
   sv=openServices();
   const original=await sv.rows('hadiths',p.ids);
   await preflight(sv,scope,original,original);
   scope.unchanged();
   commit=publish(['--apply','--expected-state='+p.state]);
   checkReport(commit,p.ids,{applied:true,state:p.state,sourceHash:scope.sourceHash});
   console.log(JSON.stringify({mode:'apply',commit}));
  }else{
   commit=reportFor(p.ids,p.state);checkReport(commit,p.ids,{applied:true,state:p.state,sourceHash:scope.sourceHash});sv=openServices();console.log(JSON.stringify({mode:'resume',commit}));
  }
  const report={commit,startedMs:Date.now(),stage:'index-preflight',docs:[]};
  const flush=()=>receipts(p.state,report);
  flush();
  const current=await sv.rows('hadiths',p.ids),baseline=await sv.rows(commit.backup,p.ids);
  const work=await preflight(sv,scope,current,baseline,{committed:true});
  scope.unchanged();
  report.stage='index';
  for(const plan of work){
   const result={passage:plan.n,id:plan.id,path:plan.bookPath,fields:Object.keys(plan.patch),status:'already current'};
   try{
    if(result.fields.length)result.status=await sv.patch(plan);
    verifyPatch(plan,await sv.get(plan.id));result.exact=true;
   }catch(error){
    result.status='unconfirmed; no retry';result.error=safeError(error);
    try{verifyPatch(plan,await sv.get(plan.id));result.status='verified after uncertain response';result.exact=true;}catch{}
   }
   report.docs.push(result);flush();console.log(JSON.stringify(result));
   if(!result.exact)throw Error('Index stopped at '+plan.n+'; DB remains committed; use index-only resume after investigating');
  }
  report.stage='index-complete';console.log(JSON.stringify({receipt:flush(),updated:report.docs.length}));
 }finally{sv?.close();}
}
if(require.main===module)run(process.argv.slice(2)).catch(e=>{console.error(safeError(e));process.exitCode=1;});
module.exports={args,checkReport,fieldPlan,verifyPatch};
