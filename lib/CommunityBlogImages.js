'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const C=require('./Community'),Media=require('./CommunityMedia');
function legacyPath(value,hosts=[]){
 let ref=String(value||'').trim();
 if(/^https?:\/\//i.test(ref)){const u=new URL(ref);if(!hosts.includes(u.host))return null;ref=u.pathname;}
 try{ref=decodeURIComponent(ref);}catch{return null;}
 ref=ref.replace(/^\/blog\//,'').replace(/^\.\//,'');
 if(!ref.startsWith('Attachments/')||ref.includes('\\')||ref.split('/').some(p=>p==='..'||p===''))return null;
 return ref;
}
function rewrite(markdown,resolve){
 if(typeof markdown!=='string')return markdown;
 return markdown.replace(/!\[\[([^|\]\n]+)(?:\|([^\]\n]+))?\]\]/g,(all,file,label)=>{
   const ref=file.startsWith('Attachments/')?file:'Attachments/'+file;
   const replacement=resolve(ref,!path.extname(file));
   if(replacement===false)return label||file;
   return replacement?'!['+(label||path.basename(file)).replace(/[\[\]]/g,'')+']('+replacement+')':all;
 }).replace(/(!\[[^\]\n]*\]\()([^\s)]+)(\))/g,(all,start,ref,end)=>{
   const replacement=resolve(ref,false);return replacement===false?start.slice(2,-2):replacement?start+replacement+end:all;
 });
}
async function migrate(dir,hosts,apply=false,backupDir=path.join(__dirname,'../temp'),allowMissingImages=[]){
 await C.ensure();
 const rows=await C.sql('SELECT p.*,l.attributes_json FROM community_posts p JOIN community_blog_imports l ON l.post_id=p.id');
 const assets=new Map(),unresolved=new Set();
 function inspect(row,ref,note=false){
  const relative=legacyPath(ref,hosts);if(!relative)return null;
  const key=row.author_uid+'\0'+relative;
  if(assets.has(key))return assets.get(key).url;
  const file=path.resolve(dir,relative),root=fs.realpathSync(dir)+path.sep;
  if(!fs.existsSync(file)){if(note||allowMissingImages.includes(relative)){unresolved.add(relative);return false;}throw Error('Missing image: '+relative);}
  if(!fs.realpathSync(file).startsWith(root))throw Error('Image outside blog directory: '+relative);
  const data=fs.readFileSync(file),mime=Media.imageType(data),sha=crypto.createHash('sha256').update(data).digest('hex');
  assets.set(key,{uid:row.author_uid,relative,data,mime,sha,id:null,url:'/pending/'+sha});return '/pending/'+sha;
 }
 for(const row of rows){const attrs=JSON.parse(row.attributes_json);if(attrs.cover)inspect(row,attrs.cover);rewrite(row.markdown,(r,n)=>inspect(row,r,n));rewrite(row.public_markdown,(r,n)=>inspect(row,r,n));}
 const summary={mode:apply?'apply':'preview',articles:rows.length,images:assets.size,bytes:[...assets.values()].reduce((n,a)=>n+a.data.length,0),missingNoteEmbeds:[...unresolved].filter(r=>!path.extname(r)),missingImages:[...unresolved].filter(r=>path.extname(r)),updated:0,inserted:0};
 if(!apply)return summary;
 await C.transaction(async q=>{
  const locked=await q('SELECT p.*,l.attributes_json FROM community_posts p JOIN community_blog_imports l ON l.post_id=p.id FOR UPDATE');
  for(const row of locked){const old=rows.find(r=>r.id===row.id);if(!old||old.version!==row.version||old.markdown!==row.markdown||old.public_markdown!==row.public_markdown||old.attributes_json!==row.attributes_json)throw Error('Article changed during migration. Retry.');}
  const backup=path.join(backupDir,'blog-images-before-'+Date.now()+'.json');fs.writeFileSync(backup,JSON.stringify({posts:locked,assets:[...assets.values()].map(({data,...a})=>a)}),{mode:0o600,flag:'wx'});summary.backup=path.basename(backup);
  for(const asset of assets.values()){
   const existing=(await q('SELECT media_id,source_sha256 FROM community_blog_media_imports WHERE user_uid=? AND legacy_path=?',[asset.uid,asset.relative]))[0];
   if(existing&&existing.source_sha256!==asset.sha)throw Error('Source image changed: '+asset.relative);
   let id=existing?.media_id;
   if(!id){const duplicate=(await q('SELECT media_id FROM community_blog_media_imports WHERE user_uid=? AND source_sha256=? LIMIT 1',[asset.uid,asset.sha]))[0];id=duplicate?.media_id||crypto.randomBytes(16).toString('hex');
    if(!duplicate){await q('INSERT INTO community_media (id,user_uid,mime,bytes,data) VALUES (?,?,?,?,?)',[id,asset.uid,asset.mime,asset.data.length,asset.data]);summary.inserted++;}
    await q('INSERT INTO community_blog_media_imports (user_uid,legacy_path,media_id,source_sha256) VALUES (?,?,?,?)',[asset.uid,asset.relative,id,asset.sha]);}
   asset.id=id;asset.url='/community/media/'+id;
  }
  for(const row of locked){
   const resolve=(ref,note=false)=>{const relative=legacyPath(ref,hosts);if(!relative)return null;return assets.get(row.author_uid+'\0'+relative)?.url || (unresolved.has(relative)?false:null);};
   const attrs=JSON.parse(row.attributes_json);if(attrs.cover)attrs.cover=resolve(attrs.cover)||attrs.cover;
   const markdown=rewrite(row.markdown,resolve),published=rewrite(row.public_markdown,resolve),metadata=JSON.stringify(attrs);
   if(markdown===row.markdown && published===row.public_markdown && metadata===row.attributes_json)continue;
   await q('UPDATE community_posts SET markdown=?,public_markdown=?,cover_url=?,public_cover_url=?,version=version+1 WHERE id=?',[markdown,published,resolve(row.cover_url)||row.cover_url,resolve(row.public_cover_url)||row.public_cover_url,row.id]);
   await q('UPDATE community_blog_imports SET attributes_json=? WHERE post_id=?',[metadata,row.id]);
   await q('INSERT INTO community_revisions (post_id,version,title,markdown,tags) VALUES (?,?,?,?,?)',[row.id,row.version+1,row.title,markdown,row.tags]);summary.updated++;
  }
 });return summary;
}
async function publicLegacyImage(value) {
 const relative=legacyPath(value);if(!relative)return null;
 await C.ensure();
 const rows=await C.sql('SELECT DISTINCT media_id FROM community_blog_media_imports WHERE legacy_path=?',[relative]);
 for(const row of rows){try{await Media.image(row.media_id,null);return row.media_id;}catch(err){if(err.status!==404)throw err;}}
 return null;
}
module.exports={legacyPath,rewrite,migrate,publicLegacyImage};
