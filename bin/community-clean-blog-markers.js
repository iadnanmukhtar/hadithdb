#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),mysql=require('mysql');
const clean=text=>typeof text==='string'?text.replace(/~~/g,''):text;
async function main(){
 global.dbPool=mysql.createPool({...require('./initializeHadithAttributions').connectionSettings(),charset:'utf8mb4_unicode_ci',timezone:'Z'});
 const C=require('../lib/Community');
 try{
  const rows=await C.sql("SELECT p.* FROM community_posts p JOIN community_blog_posts b ON b.post_id=p.id WHERE p.markdown LIKE '%~~%' OR p.public_markdown LIKE '%~~%'");
  for(const row of rows)for(const text of [row.markdown,row.public_markdown])for(const match of (text||'').matchAll(/~~([\s\S]*?)~~/g))if(match[1].trim()&&!/\p{Script_Extensions=Arabic}/u.test(match[1]))throw Error('Review non-Arabic strikethrough in article '+row.id);
  console.log(JSON.stringify({mode:process.argv.includes('--apply')?'apply':'preview',articles:rows.length,publicMarkers:rows.reduce((n,r)=>n+((r.public_markdown||'').match(/~~/g)||[]).length,0)}));
  if(!process.argv.includes('--apply')||!rows.length)return;
  const backup=path.join(__dirname,'../temp/blog-markers-before-'+Date.now()+'.json');
  await C.transaction(async q=>{
    const locked=await q('SELECT * FROM community_posts WHERE id IN (?) FOR UPDATE',[rows.map(r=>r.id)]);
    for(const row of locked){const prior=rows.find(r=>r.id===row.id);if(prior.version!==row.version||prior.markdown!==row.markdown||prior.public_markdown!==row.public_markdown)throw Error('Article changed during preparation: '+row.id);}
    fs.writeFileSync(backup,JSON.stringify(locked),{mode:0o600,flag:'wx'});
    for(const row of locked){await q('UPDATE community_posts SET markdown=?,public_markdown=?,version=version+1 WHERE id=?',[clean(row.markdown),clean(row.public_markdown),row.id]);
      await q('INSERT INTO community_revisions (post_id,version,title,markdown,tags) VALUES (?,?,?,?,?)',[row.id,row.version+1,row.title,clean(row.markdown),row.tags]);}
  });console.log(JSON.stringify({updated:rows.length,backup:path.basename(backup),datesPreserved:true}));
 }finally{global.dbPool.end();}
}
if(require.main===module)main().catch(err=>{console.error(err.message);process.exitCode=1;});
module.exports={clean};
