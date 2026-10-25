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
    const likes = await q("SELECT l.user_uid,l.user_name,l.user_email FROM hadiths_likes l JOIN community_authors a ON a.uid=CONVERT(l.user_uid USING utf8mb4) COLLATE utf8mb4_bin ORDER BY l.createdAt DESC,l.id DESC");
    const seen = new Set();
    for (const row of likes) {
      if (seen.has(row.user_uid)) continue;
      seen.add(row.user_uid);
      await Reflections.authorFor(q,row,'hadiths_likes');
    }
    const after = (await q('SELECT COUNT(*) AS n FROM community_authors'))[0].n;
    console.log(JSON.stringify({ eligibleReflections: sources, authorProfilesCreated: after - before, contentCopied: 0 }));
  } finally { await promisify(pool.end).call(pool); }
}
if (require.main === module) main().catch(err => { console.error(err.message); process.exitCode = 1; });
