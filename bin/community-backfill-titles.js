#!/usr/bin/env node
'use strict';
const fs=require('fs'),os=require('os'),path=require('path'),mysql=require('mysql');
async function main(){
 const settings=JSON.parse(fs.readFileSync(path.join(os.homedir(),'.hadithdb/settings.json'),'utf8'));
 global.dbPool=mysql.createPool({...require('./initializeHadithAttributions').connectionSettings(),timezone:'Z',charset:'utf8mb4_unicode_ci'});
 const C=require('../lib/Community'),Posts=require('../lib/CommunityHadithPosts');
 try {
  const handle=process.argv.find(arg=>arg.startsWith('--author='))?.slice(9);
  const authors=await C.sql('SELECT uid,handle,name FROM community_authors WHERE '+(handle?'handle=?':'LOWER(email)=LOWER(?)'),[handle||settings.blog.email]);
  if(authors.length!==1)throw new Error('Blog owner must resolve to exactly one existing Community profile');
  const rows=await C.sql("SELECT h.id AS hId,CONCAT(b.alias,':',h.num) AS ref,h.title,h.title_en,h.lastmod FROM hadiths h JOIN books b ON b.id=h.bookId WHERE NULLIF(TRIM(h.title_en),'') IS NOT NULL ORDER BY h.id");
  if(new Set(rows.map(r=>String(r.hId))).size!==rows.length)throw new Error('Duplicate source hadith identities');
  console.log(JSON.stringify({author:authors[0].handle,dateSource:'hadiths.lastmod',apply:process.argv.includes('--apply')}));
  console.log(JSON.stringify(await Posts.backfillTitles(authors[0],rows,process.argv.includes('--apply'),p=>console.log(JSON.stringify(p)))));
 } finally {global.dbPool.end();}
}
main().catch(err=>{console.error(err.message);process.exitCode=1;});
