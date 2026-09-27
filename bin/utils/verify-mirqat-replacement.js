#!/usr/bin/env node
'use strict';
// Database integration check: every mutation is rolled back, including legacy
// membership/snapshot trigger effects. Never commits a user's hadith replacement.
require('dotenv').config();
const assert=require('assert/strict'),mysql=require('mysql'),{promisify}=require('util');
async function verify(alias='suyuti',bookId=100419){
  const db=mysql.createConnection(require('../initializeHadithAttributions').connectionSettings()),q=promisify(db.query).bind(db);
  try {
    await q('START TRANSACTION');
    const [v]=await q(`SELECT hv.* FROM hdith_virtual_sharh_links vl JOIN hadiths_virtual hv ON hv.id=vl.virtual_id JOIN hadiths h ON h.id=hv.hadithId JOIN books b ON b.id=h.bookId WHERE hv.bookId=? AND (? IS NULL OR b.alias=?) ORDER BY hv.id LIMIT 1`,[bookId,alias,alias]);
    assert(v,'No linked placeholder to test');
    const [target]=await q(`SELECT h.id,CONCAT(b.alias,':',h.num) ref,b.alias FROM hadiths h JOIN books b ON b.id=h.bookId WHERE h.id=(SELECT hadithId FROM hadiths_virtual WHERE bookId=100419 AND num='1' LIMIT 1)`);
    const before=await q('SELECT hs.* FROM hdith_hadith_sharh hs JOIN hdith_virtual_sharh_links vl ON vl.sharh_id=hs.id WHERE vl.virtual_id=?',[v.id]);
    assert(before.length);
    const unrelated=await q('SELECT * FROM hdith_hadith_sharh WHERE hadith_id IN (?,?) AND id NOT IN (?) ORDER BY id',[v.hadithId,target.id,before.map(r=>r.id)]);
    await q('UPDATE hadiths_virtual SET hadithId=?,ref_num=?,bookActual=? WHERE id=?',[target.id,target.ref,target.alias,v.id]);
    const after=await q('SELECT hs.* FROM hdith_hadith_sharh hs JOIN hdith_virtual_sharh_links vl ON vl.sharh_id=hs.id WHERE vl.virtual_id=?',[v.id]);
    assert.deepEqual(after.map(r=>({...r})),before.map(r=>({...r,hadith_id:target.id})));
    assert.deepEqual(await q('SELECT * FROM hdith_hadith_sharh WHERE hadith_id IN (?,?) AND id NOT IN (?) ORDER BY id',[v.hadithId,target.id,before.map(r=>r.id)]),unrelated);
    await assert.rejects(q('UPDATE hadiths_virtual SET ref_num=NULL,hadithId=NULL WHERE id=?',[v.id]),/must select an original hadith/);
    await q('SAVEPOINT before_delete');
    await q('DELETE FROM hadiths_virtual WHERE id=?',[v.id]);
    assert.equal((await q('SELECT id FROM hdith_hadith_sharh WHERE id IN (?)',[before.map(r=>r.id)])).length,0);
    assert.deepEqual(await q('SELECT * FROM hdith_hadith_sharh WHERE hadith_id IN (?,?) AND id NOT IN (?) ORDER BY id',[v.hadithId,target.id,before.map(r=>r.id)]),unrelated);
    await q('ROLLBACK TO SAVEPOINT before_delete');
    await q('ROLLBACK');
    assert.deepEqual(await q('SELECT hs.* FROM hdith_hadith_sharh hs JOIN hdith_virtual_sharh_links vl ON vl.sharh_id=hs.id WHERE vl.virtual_id=?',[v.id]),before);
    console.log(JSON.stringify({placeholder:alias,virtualId:v.id,reference:v.num,oldReference:v.ref_num,oldHadithId:v.hadithId,targetHadithId:target.id,moved:before.length,unrelatedPreserved:unrelated.length,nullRejected:true,deletionScoped:true,rolledBack:true}));
  } finally {await q('ROLLBACK');db.end();}
}
if(require.main===module)verify('suyuti').then(()=>verify('misc')).then(()=>verify(null,61)).then(()=>verify(null,57)).catch(e=>{console.error(e.stack);process.exitCode=1;});
module.exports={verify};
