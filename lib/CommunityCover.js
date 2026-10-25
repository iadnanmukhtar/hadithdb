'use strict';
async function migrate(sql) {
 for(const [table,column] of [['community_posts','cover_url'],['community_posts','public_cover_url'],['community_revisions','cover_url']]){
  try{await sql(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT NULL`);}catch(e){if(e.code!=='ER_DUP_FIELDNAME')throw e;}
 }
 await sql(`UPDATE community_posts p JOIN community_blog_imports b ON b.post_id=p.id SET
 p.cover_url=COALESCE(p.cover_url,NULLIF(JSON_UNQUOTE(JSON_EXTRACT(b.attributes_json,'$.cover')),'null'),''),
 p.public_cover_url=COALESCE(p.public_cover_url,NULLIF(JSON_UNQUOTE(JSON_EXTRACT(b.attributes_json,'$.cover')),'null'),'')
 WHERE p.cover_url IS NULL OR p.public_cover_url IS NULL`);
 await sql("UPDATE community_posts SET cover_url=COALESCE(cover_url,''),public_cover_url=COALESCE(public_cover_url,'') WHERE cover_url IS NULL OR public_cover_url IS NULL");
}
function url(value){return value && !/^(https?:\/\/|\/)/i.test(value)?'/blog/'+value:value||'';}
async function validate(q,user,value,previous){
 if(value===undefined)return previous||'';
 if(typeof value!=='string')throw require('http-errors')(400,'Choose a cover image.');
 if(value==='' || value===url(previous))return value;
 const match=value.match(/^\/community\/media\/([a-f0-9]{32})$/);
 if(!match || !(await q('SELECT id FROM community_media WHERE id=? AND user_uid=?',[match[1],user.uid])).length)throw require('http-errors')(400,'Choose an image uploaded to your account.');
 return value;
}
module.exports={migrate,url,validate};
