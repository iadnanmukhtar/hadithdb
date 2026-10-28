'use strict';
const communityName = require('./CommunityName');
const error=require('http-errors');
const sources=['hadiths_comments','blog_comments'];
const C=()=>require('./Community');
const R=()=>require('./CommunityReflections');
function counts(item) {return Object.fromEntries(['likeCount','liked','dislikeCount','disliked','repostCount','reposted','commentCount'].filter(key=>item[key]!==undefined).map(key=>[key,item[key]]));}
function validate(source) {if(!['post','comment',...sources].includes(source)) throw error(400,'Invalid contribution.');}
async function target(q,source,id,lock=false) {
  validate(source);
  let row;
  if(sources.includes(source)) {
    row=(await q(`SELECT * FROM ${source} WHERE id=? AND COALESCE(deleted,0)=0 AND text IS NOT NULL AND TRIM(text)<>''${lock?' FOR UPDATE':''}`,[id]))[0];
  } else if(source==='post') row=(await q(`SELECT * FROM community_posts WHERE id=? AND status='published'${lock?' FOR UPDATE':''}`,[id]))[0];
  else row=(await q(`SELECT c.* FROM community_comments c JOIN community_posts p ON p.id=c.post_id WHERE c.id=? AND c.deleted=0 AND p.status='published'${lock?' FOR UPDATE':''}`,[id]))[0];
  if(!row) throw error(404,'This contribution is no longer public.');
  return row;
}
async function vote(user,source,value,direction) {
  const id=C().id(value); validate(source);
  if(!['up','down',null].includes(direction)) throw error(400,'Invalid vote.');
  await C().authorFor(user);
  return C().transaction(async q=>{
    await target(q,source,id,true);
    await q('DELETE FROM community_dislikes WHERE source=? AND target_id=? AND user_uid=?',[source,id,user.uid]);
    await require('./CommunityLikes').set(q,source,id,user,direction==='up');
    if(sources.includes(source)) {
      await q(`DELETE FROM ${source}_votes WHERE commentId=? AND user_uid=?`,[id,user.uid]);
      if(direction) await q(`INSERT INTO ${source}_votes (commentId,user_uid,direction) VALUES (?,?,?)`,[id,user.uid,direction]);
      await q(`UPDATE ${source} SET up_vote=(SELECT COUNT(*) FROM ${source}_votes WHERE commentId=? AND direction='up'),down_vote=(SELECT COUNT(*) FROM ${source}_votes WHERE commentId=? AND direction='down') WHERE id=?`,[id,id,id]);
    }
    if(direction==='down') await q('INSERT INTO community_dislikes (source,target_id,user_uid,created_at) VALUES (?,?,?,CURRENT_TIMESTAMP(3))',[source,id,user.uid]);
    const item={id,activity:source,likeSource:source,likeId:id};
    await require('./CommunityLikes').decorate(q,[item],user); await decorate(q,[item],user);
    return counts(item);
  });
}
async function repost(user,source,value,enabled) {
  validate(source); const id=C().id(value);
  if(typeof enabled!=='boolean')throw error(400,'Choose repost or undo repost.');
  await C().authorFor(user);
  return C().transaction(async q=>{
    await target(q,source,id,true);
    if(enabled) await q('INSERT IGNORE INTO community_reposts (source,target_id,user_uid) VALUES (?,?,?)',[source,id,user.uid]);
    else await q('DELETE FROM community_reposts WHERE source=? AND target_id=? AND user_uid=?',[source,id,user.uid]);
    const item={likeSource:source,likeId:id}; await decorate(q,[item],user); return counts(item);
  });
}
async function decorate(q,items,user) {
  for(const source of ['post','comment',...sources]) {
    const matching=items.filter(i=>i.likeSource===source && (!i.status||i.status==='published'));
    if(!matching.length) continue;
    const ids=[...new Set(matching.map(i=>i.likeId||i.id))];
    const sourceVote=sources.includes(source);
    const downs=await q(`SELECT ${sourceVote?'commentId':'target_id'} id,COUNT(DISTINCT user_uid) n,MAX(user_uid=?) chosen FROM ${sourceVote?source+'_votes':'community_dislikes'} WHERE ${sourceVote?"direction='down'":'source=?'} AND ${sourceVote?'commentId':'target_id'} IN (?) GROUP BY ${sourceVote?'commentId':'target_id'}`,[user?.uid||'',...(sourceVote?[]:[source]),ids]);
    const reposts=await q('SELECT target_id id,COUNT(*) n,MAX(user_uid=?) chosen FROM community_reposts WHERE source=? AND target_id IN (?) GROUP BY target_id',[user?.uid||'',source,ids]);
    const replyTable=sourceVote?source:'community_comments', field=sourceVote?'parentId':source==='post'?'post_id':'parent_id';
    const replies=await q(`SELECT ${field} id,COUNT(*) n FROM ${replyTable} WHERE COALESCE(deleted,0)=0 AND ${field} IN (?) GROUP BY ${field}`,[ids]);
    for(const item of matching) {
      const id=Number(item.likeId||item.id),down=downs.find(r=>Number(r.id)===id),repost=reposts.find(r=>Number(r.id)===id);
      Object.assign(item,{dislikeCount:Number(down?.n||0),disliked:!!down?.chosen,repostCount:Number(repost?.n||0),reposted:!!repost?.chosen,commentCount:Number(replies.find(r=>Number(r.id)===id)?.n||0)});
    }
  }
}
async function discussion(source,value,user,offset=0) {
  validate(source);const id=C().id(value); offset=Number(offset);
  if(!Number.isSafeInteger(offset)||offset<0||offset>10000)throw error(400,'Invalid page.');
  await C().ensure(); const q=C().sql,root=await target(q,source,id);
  let rows;
  if(sources.includes(source)) rows=await q(`WITH RECURSIVE replies AS (
    SELECT c.*,0 AS depth FROM ${source} c WHERE parentId=?
    UNION ALL SELECT c.*,r.depth+1 FROM ${source} c JOIN replies r ON c.parentId=r.id WHERE r.depth<30
  ) SELECT * FROM replies ORDER BY createdAt,id LIMIT 51 OFFSET ?`,[id,offset]);
  else if(source==='comment') rows=await q(`WITH RECURSIVE replies AS (
    SELECT c.*,0 AS depth FROM community_comments c WHERE c.parent_id=? AND c.post_id=?
    UNION ALL SELECT c.*,r.depth+1 FROM community_comments c JOIN replies r ON c.parent_id=r.id WHERE r.depth<30 AND c.post_id=?
  ) SELECT r.*,a.handle,a.name, a.custom_name FROM replies r JOIN community_authors a ON a.uid=r.author_uid ORDER BY r.created_at,r.id LIMIT 51 OFFSET ?`,[id,root.post_id,root.post_id,offset]);
  else rows=await q('SELECT c.*,a.handle,a.name, a.custom_name FROM community_comments c JOIN community_authors a ON a.uid=c.author_uid WHERE c.post_id=? ORDER BY c.created_at,c.id LIMIT 51 OFFSET ?',[source==='post'?id:root.post_id,offset]);
  const more=rows.length>50;rows=rows.slice(0,50);
  const items=[];
  for(const row of rows) {
    const sourceRow=sources.includes(source);
    const author=sourceRow?await R().authorFor(q,row,source):{handle:row.handle,name: communityName(row.name, row.custom_name)};
    items.push({id:row.id,parentId:sourceRow?(row.parentId===id?null:row.parentId):(source==='comment' && row.parent_id===id?null:row.parent_id),deleted:!!row.deleted,
      html:row.deleted?'':C().content(sourceRow?row.text:row.markdown).html,author,activityAt:sourceRow?row.createdAt:row.created_at,
      likeSource:sourceRow?source:'comment',likeId:row.id});
  }
  await require('./UserAvatar').decorateAuthors(items.map(i=>i.author));
  await require('./CommunityLikes').decorate(q,items.filter(i=>!i.deleted),user);await decorate(q,items.filter(i=>!i.deleted),user);
  return {items,hasMore:more,offset:offset+50};
}
async function reply(user,source,value,input) {
  validate(source); const id=C().id(value);
  if(typeof input.markdown!=='string'||!input.markdown.trim()||input.markdown.length>10000)throw error(400,'Reply must be between 1 and 10000 characters.');
  const markdown=C().content(input.markdown).markdown;
  await C().authorFor(user);
  if(!sources.includes(source)) {
    const root=await target(C().sql,source,id);
    await C().addComment(user,source==='post'?id:root.post_id,{markdown,parentId:source==='comment'?id:null});
    return {saved:true};
  }
  await C().transaction(async q=>{
    const root=await target(q,source,id,true);
    const fields=source==='blog_comments'?['post_slug']:['hadithId','type','ref_num'];
    await q(`INSERT INTO ${source} (${fields.join(',')},parentId,user_uid,user_provider,user_name,user_email,user_photo,text,createdAt,deleted) VALUES (${fields.map(()=>'?').join(',')},?,?,?,?,?,?,?,NOW(),0)`,[...fields.map(k=>root[k]),id,user.uid,user.provider||'google.com',user.name||'Community member',user.email||null,user.photo||null,markdown]);
  });
  return {saved:true};
}
async function feed(q,{scope,user,author,limit},kind) {
  const params=[]; let where='';
  if(scope==='mine'){where+=' AND r.user_uid=?';params.push(user.uid);}
  if(scope==='following'){where+=' AND EXISTS (SELECT 1 FROM community_follows f WHERE f.author_uid=r.user_uid AND f.follower_uid=?)';params.push(user.uid);}
  if(author){where+=' AND r.user_uid=?';params.push(author.uid);}
  // Filter visibility before LIMIT so removed originals do not starve pagination.
  const rows=await q(`SELECT r.*,a.handle,a.name, a.custom_name FROM community_reposts r JOIN community_authors a ON a.uid=r.user_uid WHERE (
    (r.source=? AND EXISTS(SELECT 1 FROM community_posts p WHERE p.id=r.target_id AND p.status='published')) OR
    (r.source=? AND EXISTS(SELECT 1 FROM community_comments c JOIN community_posts p ON p.id=c.post_id WHERE c.id=r.target_id AND c.deleted=0 AND p.status='published')) OR
    (r.source=? AND EXISTS(SELECT 1 FROM hadiths_comments c WHERE c.id=r.target_id AND COALESCE(c.deleted,0)=0 AND c.text IS NOT NULL AND TRIM(c.text)<>'')) OR
    (r.source=? AND EXISTS(SELECT 1 FROM blog_comments c WHERE c.id=r.target_id AND COALESCE(c.deleted,0)=0 AND c.text IS NOT NULL AND TRIM(c.text)<>''))
  ) ${where} ORDER BY r.created_at DESC,r.id DESC LIMIT ?`,['post','comment',...sources,...params,limit]);
  const items=[];
  for(const row of rows) {
    let original; try {
      const targetRow=await target(q,row.source,row.target_id);
      if(row.source==='post') original=await C().post(row.target_id);
      else if(row.source==='comment') {
        const post=await C().post(targetRow.post_id);
        const author=(await q('SELECT handle,name FROM community_authors WHERE uid=?',[targetRow.author_uid]))[0];
        original={kind:'comment',author,title:post.title,html:C().content(targetRow.markdown).html,url:post.url+'#comment-'+targetRow.id};
      } else original={kind:'comment',author:await R().authorFor(q,targetRow,row.source),title:row.source==='blog_comments'?'Discussion on '+targetRow.post_slug:'Reflection on '+(targetRow.ref_num||targetRow.hadithId),html:C().content(targetRow.text).html,url:R().sourceUrl(targetRow,row.source)};
    } catch(e) {if(e.status===404)continue;throw e;}
    if(kind!=='all'&&original.kind!==kind)continue;
    items.push({...original,...(original.kind!=='comment'?{mediaHtml:require('./CommunityMedia').extract(original.html||'')}:{}),id:row.id,activity:'repost',activityAt:row.created_at,likeSource:row.source,likeId:row.target_id,repostedBy:{handle:row.handle,name: communityName(row.name, row.custom_name)}});
  }
  return items;
}
module.exports={vote,repost,decorate,discussion,reply,feed};
