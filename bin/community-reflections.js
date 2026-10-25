#!/usr/bin/env node
'use strict';
const mysql = require('mysql');
const { promisify } = require('util');
const Community = require('../lib/Community');
const Reflections = require('../lib/CommunityReflections');
async function main() {
  const pool = mysql.createPool(require('./initializeHadithAttributions').connectionSettings());
  global.dbPool = pool;
  const q = promisify(pool.query).bind(pool);
  try {
    await Community.ensure();
    const before = (await q('SELECT COUNT(*) AS n FROM community_authors'))[0].n;
    const sources = await Reflections.backfill(q);
    const after = (await q('SELECT COUNT(*) AS n FROM community_authors'))[0].n;
    console.log(JSON.stringify({ eligibleReflections: sources, authorProfilesCreated: after - before, contentCopied: 0 }));
  } finally { await promisify(pool.end).call(pool); }
}
if (require.main === module) main().catch(err => { console.error(err.message); process.exitCode = 1; });
