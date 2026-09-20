#!/usr/bin/env node
'use strict';
require('dotenv').config();
const fs=require('fs'),path=require('path'),os=require('os'),{promisify}=require('util');
const {sha256}=require('./import-riyad-dalil-sharh');
const plan=require('./riyad-dalil-reference-repairs.json');
function stable(row){return JSON.stringify(Object.fromEntries(Object.keys(row).filter(k=>!['lastmod','lastfixed','lastmod_user'].includes(k)).sort().map(k=>[k,row[k]])));}
function state(current,before,changes){
 if(!current)throw Error(`Missing reviewed row ${before.id}`);
 if(stable(current)===stable({...before,...changes}))return 'applied';
 if(stable(current)===stable(before))return 'pending';
 throw Error(`Reviewed row changed: ${before.id}`);
}
async function main(){
 const apply=process.argv.includes('--apply'),db=require('mysql').createConnection(require('../initializeHadithAttributions').connectionSettings()),q=promisify(db.query).bind(db);let committed=false;
 try{
  await q('START TRANSACTION');
  const ids=[...plan.corrections.map(p=>p.before.id),...plan.remove.map(p=>p.before.id)];
  const virtual=await q('SELECT * FROM hadiths_virtual WHERE id IN (?) FOR UPDATE',[ids]);
  const headings=await q('SELECT * FROM toc WHERE id IN (?) FOR UPDATE',[plan.toc.map(t=>t.id)]);
  const sharhs=await q('SELECT * FROM hdith_hadith_sharh WHERE id IN (?) FOR UPDATE',[plan.sharhMoves.map(s=>s.before.id)]);
  const targets=await q('SELECT id,bookId,num,chain,body,text FROM hadiths WHERE id IN (?) FOR UPDATE',[plan.corrections.map(p=>p.target.id)]);
  const affectedIds=[...new Set([...plan.corrections.flatMap(p=>[p.before.hadithId,p.after.hadithId]),...plan.remove.map(p=>p.before.hadithId)])];
  const memberships=await q('SELECT id,books FROM hadiths WHERE id IN (?) FOR UPDATE',[affectedIds]);
  const pending=[];for(const p of plan.corrections){const t=targets.find(t=>t.id===p.target.id);if(!t||sha256(JSON.stringify([t.id,t.bookId,t.num,t.chain,t.body,t.text]))!==p.targetHash)throw Error('Target changed '+p.target.id);if(state(virtual.find(v=>v.id===p.before.id),p.before,p.after)==='pending')pending.push(p);}
  const deletions=plan.remove.filter(p=>virtual.some(v=>v.id===p.before.id));for(const p of deletions)if(stable(virtual.find(v=>v.id===p.before.id))!==stable(p.before))throw Error('Delete candidate changed');
  const headingChanges=plan.toc.filter(t=>state(headings.find(h=>h.id===t.id),t,{count:t.count-1})==='pending');
  const moves=plan.sharhMoves.filter(p=>state(sharhs.find(s=>s.id===p.before.id),p.before,{hadith_id:p.hadithId})==='pending');
  if(deletions.length!==headingChanges.length/2)throw Error('Count/reference repair state inconsistent');
  const stats={apply,references:pending.length,extraReferencesRemoved:deletions.length,chapterCounts:headingChanges.length,validatedSharhMoves:moves.length};
  if(!apply){await q('ROLLBACK');console.log(stats);return;}
  const backup=path.join(os.homedir(),'.hadithdb','backups',`riyad-dalil-references-${Date.now()}.json`);fs.mkdirSync(path.dirname(backup),{recursive:true});fs.writeFileSync(backup,JSON.stringify({virtual,headings,sharhs,targets,memberships},null,2));
  for(const p of pending)await q('UPDATE hadiths_virtual SET hadithId=?,ref_num=?,bookActual=?,lastfixed=NOW(),lastmod_user=? WHERE id=?',[p.after.hadithId,p.after.ref_num,p.after.bookActual,'repair:riyad-dalil-pass4',p.before.id]);
  for(const p of deletions)await q('DELETE FROM hadiths_virtual WHERE id=?',[p.before.id]);
  for(const t of headingChanges)await q('UPDATE toc SET count=?,lastfixed=NOW(),lastmod_user=? WHERE id=?',[t.count-1,'repair:riyad-dalil-pass4',t.id]);
  for(const p of moves)await q('UPDATE hdith_hadith_sharh SET hadith_id=? WHERE id=?',[p.hadithId,p.before.id]);
  const linked=new Set((await q('SELECT DISTINCT hadithId FROM hadiths_virtual WHERE bookId=61 AND hadithId IN (?)',[affectedIds])).map(r=>r.hadithId));
  const membershipChanges=[];
  for(const row of memberships){
   const has=(row.books||'').includes('{riyad}');if(has===linked.has(row.id))continue;
   const next=linked.has(row.id)?(row.books||'')+'{riyad}':(row.books||'').replace(/\{riyad\}/g,'').trim()||null;
   await q('UPDATE hadiths SET books=? WHERE id=?',[next,row.id]);membershipChanges.push({id:row.id,before:row.books,after:next});
  }
  const after=await q('SELECT * FROM hadiths_virtual WHERE id IN (?)',[ids]);for(const p of plan.corrections)if(state(after.find(v=>v.id===p.before.id),p.before,p.after)!=='applied')throw Error('Reference post-audit failed');
  if(after.some(v=>plan.remove.some(p=>p.before.id===v.id)))throw Error('Extraneous reference remains');
  const headingsAfter=await q('SELECT * FROM toc WHERE id IN (?)',[plan.toc.map(t=>t.id)]);for(const t of plan.toc)if(state(headingsAfter.find(h=>h.id===t.id),t,{count:t.count-1})!=='applied')throw Error('Heading post-audit failed');
  const sharhsAfter=await q('SELECT * FROM hdith_hadith_sharh WHERE id IN (?)',[plan.sharhMoves.map(p=>p.before.id)]);for(const p of plan.sharhMoves)if(state(sharhsAfter.find(s=>s.id===p.before.id),p.before,{hadith_id:p.hadithId})!=='applied')throw Error('Sharh preservation failed');
  await q('COMMIT');committed=true;
  fs.mkdirSync('temp/dalil-audit/pass4',{recursive:true});fs.writeFileSync('temp/dalil-audit/pass4/'+(pending.length?'repairs-applied.json':'repairs-followup.json'),JSON.stringify({...stats,backup,membershipChanges,exactPostAudit:true,at:new Date().toISOString()},null,2));
  await q('CALL refresh_v_hadiths_virtual_snapshot(?)',[61]);console.log({...stats,backup,snapshotRefreshed:true});
 }catch(e){if(!committed)await q('ROLLBACK').catch(()=>{});throw e;}finally{db.end();}
}
module.exports={state,stable};
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1});
