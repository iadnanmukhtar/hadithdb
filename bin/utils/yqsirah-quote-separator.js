#!/usr/bin/env node
'use strict';
// Dedicated separator-only migration. No broad publication, index, or cache work.
const fs=require('node:fs');
const a=require('node:assert/strict');
const crypto=require('node:crypto');
const cp=require('node:child_process');
const {load}=require('cheerio');
const fmt=require('./format-yqsirah');
const render=require('../../lib/ContentMarkdown').render;
const rpath='var/imports/yqsirah/formatting/publication/';
const draftPath='var/imports/yqsirah/formatting/draft.json';
const ledgerPath='data/yqsirah-formatting.json';
const sourcePath='var/imports/yqsirah/reimport/full-source-plan.json';
const exactCounts=new Map([[159,1],[347,3],[424,1],[576,1],[594,1],[632,2],[733,2],[774,1]]);
const ids=[...exactCounts.keys()];
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const digest=o=>hash(JSON.stringify(o));
const ref=/\]\((https:\/\/[^)\s]+)\)/g;
const initialScript=l=>l.match(/\p{L}/u)?.[0]||'';
const expectedReview=r=>r?.status==='reviewed'&&r.retainOriginalTranscript===true&&!r.citationFlags?.length;
const archiveSplit=s=>{const i=s.indexOf('\n\n%%\n');return i<0?[s,'']:[s.slice(0,i),s.slice(i)];};
function stripQuoteSeparators(raw){
 const [visible,archive]=archiveSplit(raw);
 let removed=0;
 const body=visible.replace(/^([ \t]*)<!-- -->\n\n(?=([ \t]*)>)/gm,(full,left,right,offset)=>{
  const prev=visible.slice(0,offset).trimEnd().split('\n').at(-1)||'';
  const next=visible.slice(offset+full.length).split('\n')[0];
  if(!prev.trimStart().startsWith('>')||!next.trimStart().startsWith('>'))return full;
  if(!/\p{Script_Extensions=Arabic}/u.test(initialScript(prev))||!/\p{Script_Extensions=Latin}/u.test(initialScript(next)))return full;
  const a=[...prev.matchAll(ref)].at(-1)?.[1], b=[...next.matchAll(ref)].at(-1)?.[1];
  if(!a||a!==b)return full;
  removed++;
  return left===right?'':left; // For existing source indentation, keep its own leading space.
 });
 return {body:body+archive,removed,archive};
}
function renderSignature(body,notes){
 const $=load(render(body+'\n\n'+notes));
 return {text:$('body').text().replace(/\s+/g,' ').trim(),quotes:$('blockquote').map((i,q)=>{
  const el=$(q);return JSON.stringify([el.attr('dir'),el.parents('li').length,el.parents('.footnotes').length,el.find('a').map((_,x)=>$(x).attr('href')).get(),el.find('em').map((_,x)=>$(x).attr('class')||'').get()]);
 }).get(),links:$('a').map((i,e)=>$(e).attr('href')).get(),markers:$('.footnote-ref').length};
}
function stage(ledger,plan,previous){
 const touched={};
 for(const [n,count] of exactCounts){
  const rev=ledger.passages[n],source=plan.entries.find(e=>e.num===n),old=previous.find(d=>d.num===n);
  a(expectedReview(rev)&&source&&old,'Expected previously reviewed archived record '+n);
  const oldRaw=old.fields.body.text, desired=stripQuoteSeparators(oldRaw);
  a.equal(desired.removed,count,'Unexpected separator count '+n);
  a(desired.archive,'Expected exact original transcript archive '+n);
  const cloned=JSON.parse(JSON.stringify(rev));let changed=0;
  for(const edit of (cloned.body||[])){
   const original=edit.after;
   if(edit.kind==='quran-translation-layout'&&!edit.blankSeparator&&/^[ \t]*<!-- -->\n\n/.test(original)){
    edit.blankSeparator=true;edit.after=original.replace(/^[ \t]*<!-- -->\n\n/,'');changed++;
   }else if(edit.kind==='evidence'){
    const patched=stripQuoteSeparators(original);if(patched.removed){edit.after=patched.body;changed+=patched.removed;}
   }
  }
  a.equal(changed,count,'Unexpected manifest separator count '+n);
  const next=fmt.buildDraft({entries:[source]},{passages:{[n]:cloned}})[0];
  a.equal(next.fields.body.text,desired.body,'Only the separator and its own whitespace may change '+n);
  a.deepEqual(next.fields.title,old.fields.title,'Source title changed');
  a.deepEqual(next.fields.footnotes,old.fields.footnotes,'Source footnotes changed');
  a.equal(fmt.undo(next.fields.body.text,next.fields.body.ledger),source.body,'Source body no longer reconstructs');
  a.deepEqual(renderSignature(next.fields.body.text,next.fields.footnotes.text),renderSignature(oldRaw,old.fields.footnotes.text),'Rendered content changed '+n);
  touched[n]={source,before:oldRaw,after:desired.body,footnotes:old.fields.footnotes.text,review:cloned,count};
 }
 return touched;
}
function receiptFor(only){
 const out=new Set();
 for(const file of fs.readdirSync(rpath).filter(f=>/^published-\d+\.json$/.test(f))){
  const p=JSON.parse(fs.readFileSync(rpath+file,'utf8'));
  if(p.applied&&p.bookId===100427&&p.backup)for(const n of p.changed)out.add(n);
 }
 a(only.every(n=>out.has(n)),'Missing durable guarded publication receipt');
}
const parse=x=>JSON.parse(fs.readFileSync(x,'utf8'));
function operation(argv){
 if(!argv.length)return {apply:false};
 a.equal(argv.length,2,'Apply requires exact prior dry-run state');
 a.equal(argv[0],'--apply');
 const m=argv[1].match(/^--expected-state=([a-f0-9]{64})$/);
 a(m,'Apply requires exact prior dry-run state');return {apply:true,expected:m[1]};
}
async function run(argv){
 const op=operation(argv),plan=parse(sourcePath),draftRaw=fs.readFileSync(draftPath,'utf8'),manifestRaw=fs.readFileSync(ledgerPath,'utf8'),manifest=JSON.parse(manifestRaw),set=stage(manifest,plan,JSON.parse(draftRaw).draft);
 receiptFor(ids);
 const mysql=require('mysql'),settings=parse(require('node:os').homedir()+'/.hadithdb/settings.json');
 const db=mysql.createConnection({...settings.mysql.connection,connectTimeout:10000}),q=require('node:util').promisify(db.query).bind(db);
 const query='SELECT id,num,bookId,h1,h2,h3,title_en,body_en,text_en,footnote_en FROM hadiths WHERE bookId=? AND num IN (?) ORDER BY CAST(num AS UNSIGNED)';
 const bind=[100427,ids];let inTx=false,committed=false,backup=null;
 try{
  const before=await q(query,bind);a.deepEqual(before.map(r=>Number(r.num)),ids,'Scope mismatch');
  for(const row of before){
   const t=set[row.num];a.equal(Number(row.bookId),100427);
   for(const k of ['h1','h2','h3'])a.equal(Number(row[k])||null,Number(t.source[k])||null,'Canonical heading mismatch');
   a.equal(row.title_en,t.source.title,'Canonical title mismatch');
   a(hash(row.body_en)===hash(t.before)&&hash(row.text_en)===hash(t.before)&&hash(row.footnote_en)===hash(t.footnotes),'Exact published raw baseline mismatch '+row.num);
  }
  const state=digest({before,manifest:hash(manifestRaw),draft:hash(draftRaw),source:plan.source_sha256});
  const evidence={applied:false,bookId:100427,state,source_sha256:plan.source_sha256,changes:before.map(row=>{const t=set[row.num];return {n:Number(row.num),id:row.id,count:t.count,before:hash(t.before),after:hash(t.after)};}),backup:null};
  const dryPath=rpath+'separator-dry-'+state+'.json';
  if(!op.apply){fs.writeFileSync(dryPath,JSON.stringify(evidence,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(evidence));return;}
  a.equal(state,op.expected,'Dry-run state changed');a.deepEqual(parse(dryPath),evidence,'Missing exact local dry-run receipt');
  a.equal(fs.readFileSync(draftPath,'utf8'),draftRaw);a.equal(fs.readFileSync(ledgerPath,'utf8'),manifestRaw);
  backup='yqsirah_separator_h_'+Date.now();
  await q('CREATE TABLE '+backup+' LIKE hadiths');
  await q('START TRANSACTION');inTx=true;
  a.equal(digest(await q(query+' FOR UPDATE',bind)),digest(before),'Live state changed before write');
  const stable=before.map(r=>r.id);
  const copied=await q('INSERT INTO '+backup+' SELECT * FROM hadiths WHERE bookId=? AND id IN (?)',[100427,stable]);
  a.equal(copied.affectedRows,ids.length,'Incomplete archive backup');
  for(const row of before){
   const t=set[row.num],result=await q('UPDATE hadiths SET body_en=?, text_en=? WHERE id=? AND bookId=?',[t.after,t.after,row.id,100427]);
   a.equal(result.affectedRows,1,'Unexpected update count');
  }
  const verify=await q(query,bind);a.deepEqual(verify.map(row=>({...row})),before.map(r=>({...r,body_en:set[r.num].after,text_en:set[r.num].after})),'Exact transaction readback failed');
  await q('COMMIT');inTx=false;committed=true;
  const result={...evidence,applied:true,backup,committed:true,localManifestSynced:false};
  const saved=rpath+'separator-published-'+state+'.json',save=()=>fs.writeFileSync(saved,JSON.stringify(result,null,2)+'\n',{mode:0o600});
  save();console.log(JSON.stringify(result));
  a.equal(fs.readFileSync(ledgerPath,'utf8'),manifestRaw,'Local ledger changed after commit; manual reconciliation needed');
  for(const n of ids)manifest.passages[n]=set[n].review;
  fs.writeFileSync(ledgerPath,JSON.stringify(manifest,null,2)+(manifestRaw.endsWith('\n')?'\n':''));
  const rebuild=cp.spawnSync(process.execPath,['bin/utils/format-yqsirah.js'],{encoding:'utf8'});
  a.equal(rebuild.status,0,'DB committed; regenerate the local draft before another task');
  result.localManifestSynced=true;save();console.log(JSON.stringify(result));
 }catch(e){
  if(inTx)await q('ROLLBACK').catch(()=>{});
  if(backup)console.error(JSON.stringify({backup,commitObserved:committed}));
  throw e;
 }finally{db.destroy();}
}
if(require.main===module)run(process.argv.slice(2)).catch(e=>{console.error(e.code||String(e.message).split('\n')[0]);process.exitCode=1;});
module.exports={stripQuoteSeparators,renderSignature,stage,operation};
