#!/usr/bin/env node
'use strict';
// One-time historical Google/Firebase reconciliation. Never matches display names,
// anonymous rows, or private notebook data. Dry-run unless --apply is supplied.
const mysql = require('mysql');
const {promisify} = require('util');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sources = ['hadiths_comments', 'blog_comments', 'hadiths_likes'];
function planIdentities(records, accounts) {
  const email = value => String(value || '').trim().toLowerCase();
  const targets = new Map(), identities = new Map();
  for (const account of accounts) {
    if (!/^\d{21}$/.test(account.user_uid) || !email(account.user_email)) continue;
    const key = email(account.user_email);
    if (!targets.has(key)) targets.set(key, new Set());
    targets.get(key).add(account.user_uid);
  }
  for (const row of records) {
    if (!row.user_uid || /^\d{21}$/.test(row.user_uid)) continue;
    if (!identities.has(row.user_uid)) identities.set(row.user_uid, []);
    identities.get(row.user_uid).push(row);
  }
  const result = [];
  for (const [oldUid, rows] of identities) {
    const emails = new Set(rows.map(row => email(row.user_email)));
    if (emails.size !== 1 || emails.has('') || rows.some(row => row.user_provider !== 'google.com')) continue;
    const matches = targets.get([...emails][0]);
    if (matches?.size !== 1) continue;
    result.push({oldUid, uid:[...matches][0], name:rows[0].user_name || 'Community member'});
  }
  return result;
}
async function main() {
  const db = mysql.createConnection(require('./initializeHadithAttributions').connectionSettings());
  const q = promisify(db.query).bind(db);
  try {
    const data = {};
    for (const table of sources) data[table] = await q(`SELECT * FROM ${table}`);
    const plan = planIdentities(sources.flatMap(t=>data[t]), await q('SELECT user_uid,user_email FROM user_settings'));
    const authors = await q('SELECT * FROM community_authors');
    console.log(JSON.stringify({mode:process.argv.includes('--apply')?'apply':'dry-run', identities:plan.map(p=>({name:p.name, sourceRecords:sources.reduce((n,t)=>n+data[t].filter(r=>r.user_uid===p.oldUid).length,0)}))}));
    if (!process.argv.includes('--apply') || !plan.length) return;
    // Refuse a generic account merge if either historical identity owns newer community data.
    const oldUids = plan.map(p=>p.oldUid);
    for (const [table, columns] of Object.entries({community_posts:['author_uid'],community_comments:['author_uid'],community_follows:['author_uid','follower_uid'],community_likes:['user_uid'],community_reports:['reporter_uid'],community_email_outbox:['follower_uid']})) {
      const rows = await q(`SELECT * FROM ${table} WHERE ${columns.map(c=>`${c} IN (?)`).join(' OR ')}`, columns.map(()=>oldUids));
      if (rows.length) throw new Error(`Manual reconciliation needed for ${table}; no changes applied.`);
    }
    await q(`CREATE TABLE IF NOT EXISTS community_author_aliases (handle VARCHAR(40) CHARACTER SET ascii COLLATE ascii_general_ci PRIMARY KEY, author_uid VARCHAR(128) COLLATE utf8mb4_bin NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await promisify(db.beginTransaction).call(db);
    try {
      const backup = {authors, plan, tables:{}};
      for (const table of [...sources,'hadiths_comments_votes','blog_comments_votes']) backup.tables[table] = await q(`SELECT * FROM ${table} WHERE BINARY user_uid IN (?) FOR UPDATE`, [[...oldUids,...plan.map(p=>p.uid)]]);
      backup.voteCounters = {};
      for (const source of sources.slice(0,2)) {
        const ids=[...new Set(backup.tables[source+'_votes'].map(r=>r.commentId))];
        backup.voteCounters[source] = ids.length ? await q(`SELECT id,up_vote,down_vote FROM ${source} WHERE id IN (?) FOR UPDATE`,[ids]) : [];
      }
      const lockedPlan=planIdentities(sources.flatMap(t=>backup.tables[t]),await q('SELECT user_uid,user_email FROM user_settings'));
      for (const entry of plan) if (!lockedPlan.some(p=>p.oldUid===entry.oldUid && p.uid===entry.uid)) throw new Error('Identity evidence changed; no changes applied.');
      const dir=path.join(process.cwd(),'temp'); fs.mkdirSync(dir,{recursive:true});
      const backupPath=path.join(dir,`community-identities-before-${Date.now()}.json`);
      fs.writeFileSync(backupPath,JSON.stringify(backup,null,2),{mode:0o600,flag:'wx'});
      for (const entry of plan) {
        const original=authors.find(a=>a.uid===entry.oldUid);
        await q('INSERT IGNORE INTO community_authors (uid,handle,name) VALUES (?,?,?)',[entry.uid,'author-'+crypto.randomBytes(8).toString('hex'),original?.name || entry.name]);
        if (original) await q('INSERT INTO community_author_aliases (handle,author_uid) VALUES (?,?) ON DUPLICATE KEY UPDATE author_uid=VALUES(author_uid)',[original.handle,entry.uid]);
        for (const table of Object.keys(backup.tables)) await q(`UPDATE ${table} SET user_uid=? WHERE BINARY user_uid=?`,[entry.uid,entry.oldUid]);
        await q('DELETE FROM community_authors WHERE uid=?',[entry.oldUid]);
      }
      // Keep one reaction per person/target; newest vote determines its direction.
      for (const [table, keys] of Object.entries({hadiths_likes:['hadithId','type'],hadiths_comments_votes:['commentId'],blog_comments_votes:['commentId']})) {
        await q(`DELETE older FROM ${table} older JOIN ${table} newer ON BINARY older.user_uid=BINARY newer.user_uid AND ${keys.map(k=>`older.${k}<=>newer.${k}`).join(' AND ')} AND older.id<newer.id WHERE BINARY older.user_uid IN (?)`,[plan.map(p=>p.uid)]);
      }
      for (const source of sources.slice(0,2)) {
        const ids=[...new Set(backup.tables[source+'_votes'].map(r=>r.commentId))];
        if(ids.length) await q(`UPDATE ${source} c SET up_vote=(SELECT COUNT(*) FROM ${source}_votes v WHERE v.commentId=c.id AND direction='up'),down_vote=(SELECT COUNT(*) FROM ${source}_votes v WHERE v.commentId=c.id AND direction='down') WHERE c.id IN (?)`,[ids]);
      }
      for (const table of Object.keys(backup.tables)) {
        const remaining=await q(`SELECT COUNT(*) n FROM ${table} WHERE BINARY user_uid IN (?)`,[oldUids]);
        if (remaining[0].n) throw new Error('Identity migration verification failed');
      }
      for (const table of sources.slice(0,2)) {
        const before=backup.tables[table];
        if (!before.length) continue;
        const after=await q(`SELECT * FROM ${table} WHERE id IN (?)`,[before.map(r=>r.id)]);
        if (after.length!==before.length) throw new Error('Reflection count changed');
        for (const row of before) {
          const current=after.find(r=>r.id===row.id);
          for (const key of Object.keys(row).filter(k=>!['user_uid','up_vote','down_vote'].includes(k)))
            require('assert').deepStrictEqual(current[key],row[key],`${table}.${key} changed`);
        }
      }
      await promisify(db.commit).call(db);
      console.log(JSON.stringify({mergedIdentities:plan.length,people:new Set(plan.map(p=>p.uid)).size,backup:backupPath}));
    } catch(e) {await promisify(db.rollback).call(db);throw e;}
  } finally {db.end();}
}
module.exports={planIdentities};
if(require.main===module) main().catch(e=>{console.error(e.message);process.exitCode=1;});
