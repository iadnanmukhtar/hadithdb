#!/usr/bin/env node
'use strict';
const fs=require('fs'),os=require('os'),path=require('path'),mysql=require('mysql');
(async()=>{
 const s=JSON.parse(fs.readFileSync(path.join(os.homedir(),'.hadithdb/settings.json'),'utf8'));
 global.dbPool=mysql.createPool({...require('./initializeHadithAttributions').connectionSettings(),charset:'utf8mb4_unicode_ci',timezone:'Z'});
 try{const hosts=[s.site?.url,s.blog.url].filter(Boolean).map(u=>new URL(u).host);console.log(JSON.stringify(await require('../lib/CommunityBlogImages').migrate(s.blog.dir,hosts,process.argv.includes('--apply'),path.join(__dirname,'../temp'),process.argv.filter(a=>a.startsWith('--allow-missing=')).map(a=>a.slice('--allow-missing='.length))),null,2));}
 finally{global.dbPool.end();}
})().catch(err=>{console.error(err.message);process.exitCode=1;});
