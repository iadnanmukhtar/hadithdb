#!/usr/bin/env node
'use strict';
const mysql = require('mysql');
const {promisify} = require('util');
const Index = require('../lib/CommunityActivityIndex');
async function inspect(q) {
  const counts = {};
  for (const source of Index.sources) counts[source.key] = (await q(`SELECT COUNT(*) AS n FROM ${source.table} s WHERE ${source.valid('s')}`))[0].n;
  return counts;
}
async function main() {
  const args = new Set(process.argv.slice(2));
  if ([...args].some(arg=>!['--apply','--disable'].includes(arg))) throw Error('Usage: node bin/community-activity-index.js [--apply] [--disable]');
  const pool = mysql.createPool(require('./initializeHadithAttributions').connectionSettings());
  const q = promisify(pool.query).bind(pool);
  try {
    if (args.has('--disable')) {
      if (args.has('--apply')) await q('UPDATE community_activity_state SET version=0 WHERE id=1');
      console.log(JSON.stringify({apply:args.has('--apply'),operation:'disable indexed reads; retain records and triggers'}));
      return;
    }
    console.log(JSON.stringify({apply:args.has('--apply'),eligible:await inspect(q)}));
    if (!args.has('--apply')) return;
    // Explicit migration only; web requests never install triggers or backfill.
    const transaction = async work => {
      const connection = await promisify(pool.getConnection).call(pool);
      try {
        await promisify(connection.beginTransaction).call(connection);
        const result = await work(promisify(connection.query).bind(connection));
        await promisify(connection.commit).call(connection);return result;
      }catch(err){await promisify(connection.rollback).call(connection);throw err;}
      finally{connection.release();}
    };
    // One installer per database. This does not block normal source writes.
    const lock = await promisify(pool.getConnection).call(pool);
    const lockQuery = promisify(lock.query).bind(lock);
    try {
      const acquired = (await lockQuery("SELECT GET_LOCK(CONCAT(DATABASE(), ':community-activity-v1'),0) AS acquired"))[0].acquired;
      if (!acquired) throw Error('Another activity-index migration is running.');
      await Index.install(q);
      const coverage = await Index.backfill(q,transaction,progress=>console.log(JSON.stringify(progress)));
      console.log(JSON.stringify({active:true,version:1,coverage}));
    } finally {await lockQuery("SELECT RELEASE_LOCK(CONCAT(DATABASE(), ':community-activity-v1'))");lock.release();}
  } finally {await promisify(pool.end).call(pool);}
}
if(require.main===module)main().catch(err=>{console.error(err.message);process.exitCode=1;});
module.exports={inspect};
