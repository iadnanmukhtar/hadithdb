#!/usr/bin/env node
'use strict';
const fs=require('fs'), os=require('os'), path=require('path'), mysql=require('mysql');
async function main() {
  const settings=JSON.parse(fs.readFileSync(path.join(os.homedir(),'.hadithdb/settings.json'),'utf8'));
  global.dbPool=mysql.createPool({...require('./initializeHadithAttributions').connectionSettings(),timezone:'Z',charset:'utf8mb4_unicode_ci'});
  const Community=require('../lib/Community'), Import=require('../lib/CommunityBlogImport');
  try {
    await Community.ensure();
    const matches=await Community.sql('SELECT uid FROM community_authors WHERE LOWER(email)=LOWER(?)',[settings.blog.email]);
    if(matches.length!==1)throw new Error('Blog owner email must resolve to exactly one community author.');
    const result=await Import.migrate(settings.blog.dir,matches[0].uid,process.argv.includes('--apply'));
    console.log(JSON.stringify(result,null,2));
  } finally {global.dbPool.end();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
