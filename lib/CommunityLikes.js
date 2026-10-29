'use strict';
const communityName = require('./CommunityName');
const createError = require('http-errors');
const Reflections = require('./CommunityReflections');
const ActivitySource = require('./CommunityActivitySource');
const sourceTables = ['hadiths_comments', 'blog_comments'];
function validate(source) {
  if (!['post', 'comment', ...sourceTables].includes(source)) throw createError(400, 'Invalid like target.');
}
async function target(q, source, id, lock = false) {
  validate(source);
  let rows;
  if (source === 'post') rows = await q("SELECT id FROM community_posts WHERE id=? AND status='published'" + (lock ? ' FOR UPDATE' : ''), [id]);
  else if (source === 'comment') rows = await q("SELECT c.id FROM community_comments c JOIN community_posts p ON p.id=c.post_id WHERE c.id=? AND c.deleted=0 AND p.status='published'" + (lock ? ' FOR UPDATE' : ''), [id]);
  else rows = await q(`SELECT id FROM ${source} WHERE id=? AND COALESCE(deleted,0)=0` + (lock ? ' FOR UPDATE' : ''), [id]);
  if (!rows.length) throw createError(404, 'This activity is no longer public.');
}
async function stats(q, source, ids, uid) {
  if (!ids.length) return new Map();
  validate(source);
  const table = sourceTables.includes(source) ? source + '_votes' : 'community_likes';
  const where = sourceTables.includes(source) ? "direction='up'" : 'source=?';
  const field = sourceTables.includes(source) ? 'commentId' : 'target_id';
  const rows = await q(`SELECT ${field} AS id, COUNT(DISTINCT user_uid) AS n, MAX(user_uid=?) AS liked FROM ${table}
    WHERE ${where} AND ${field} IN (?) GROUP BY ${field}`, [uid || '', ...(table === 'community_likes' ? [source] : []), ids]);
  return new Map(rows.map(row => [Number(row.id), { likeCount: Number(row.n), liked: !!row.liked }]));
}
async function decorate(q, items, user) {
  for (const source of ['post','comment', ...sourceTables]) {
    const matching = items.filter(item => (item.likeSource || item.activity) === source && (!item.status || item.status === 'published'));
    const counts = await stats(q, source, matching.map(item => item.likeId || item.id), user?.uid);
    for (const item of matching) Object.assign(item, { likeSource: source, likeId: item.likeId || item.id, likeCount: 0, liked: false }, counts.get(Number(item.likeId || item.id)));
  }
}
async function set(q, source, id, user, enabled) {
  await target(q, source, id, true);
  if (sourceTables.includes(source)) {
    // Use the existing reflection vote, including converting a downvote to a like.
    await q(`DELETE FROM ${source}_votes WHERE commentId=? AND user_uid=?${enabled ? '' : " AND direction='up'"}`, [id, user.uid]);
    if (enabled) await q(`INSERT INTO ${source}_votes (commentId,user_uid,direction) VALUES (?,?,'up')`, [id,user.uid]);
    await q(`UPDATE ${source} SET up_vote=(SELECT COUNT(*) FROM ${source}_votes WHERE commentId=? AND direction='up'), down_vote=(SELECT COUNT(*) FROM ${source}_votes WHERE commentId=? AND direction='down') WHERE id=?`, [id,id,id]);
  }
  if (enabled) await q('DELETE FROM community_dislikes WHERE source=? AND target_id=? AND user_uid=?',[source,id,user.uid]);
  if (enabled) await q('INSERT IGNORE INTO community_likes (source,target_id,user_uid) VALUES (?,?,?)',[source,id,user.uid]);
  else await q('DELETE FROM community_likes WHERE source=? AND target_id=? AND user_uid=?',[source,id,user.uid]);
  return (await stats(q,source,[id],user.uid)).get(id) || {likeCount:0,liked:false};
}
function scopeWhere(scope, user, author, field, params) {
  let where = '';
  if (scope === 'mine') { where += ` AND ${field}=?`; params.push(user.uid); }
  if (scope === 'following') { where += ` AND EXISTS (SELECT 1 FROM community_follows f WHERE f.author_uid=${field} AND f.follower_uid=?)`; params.push(user.uid); }
  if (author) { where += ` AND ${field}=?`; params.push(author.uid); }
  return where;
}
async function feed(q, {scope,user,author,limit,selection}, content) {
  const result=[];
  for (const source of ['post','comment']) {
    if (selection && !selection.like?.length) continue;
    const params=[source];
    let filter=scopeWhere(scope,user,author,'l.user_uid',params);
    if (selection) { filter += ' AND l.id IN (?)'; params.push(selection.like); }
    const joins=source==='post' ? 'JOIN community_posts p ON p.id=l.target_id' : 'JOIN community_comments c ON c.id=l.target_id AND c.deleted=0 JOIN community_posts p ON p.id=c.post_id';
    const rows=await q(`SELECT l.id,l.target_id,l.created_at,a.handle,a.name, a.custom_name,p.id AS post_id,pa.handle AS post_handle,p.public_title,p.public_markdown AS post_markdown,
      ${source==='post'?'p.public_markdown':'c.markdown'} AS markdown FROM community_likes l ${joins}
      JOIN community_authors a ON a.uid=l.user_uid JOIN community_authors pa ON pa.uid=p.author_uid
      WHERE l.source=? AND p.status='published' ${filter} ORDER BY l.created_at DESC,l.id DESC LIMIT ?`,[...params,limit]);
    for (const row of rows) result.push({id:row.id,activity:'like',kind:'like',likeSource:source,likeId:row.target_id,
      author:{handle:row.handle,name: communityName(row.name, row.custom_name)},title:require('./Community').displayTitle(row.public_title,content(row.post_markdown || ' ').html),excerpt:content(row.markdown).excerpt,
      activityAt:row.created_at,url:`/community/@${row.post_handle}/${row.post_id}${source==='comment'?'#comment-'+row.target_id:''}`});
  }
  // Existing source likes keep their recorded dates and source links.
  if (!selection || selection.hadith_like?.length) {
  const params=[];
  let filter=scopeWhere(scope,user,author,"CONVERT(l.user_uid USING utf8mb4) COLLATE utf8mb4_bin",params);
  if (selection) { filter += ' AND l.id IN (?)'; params.push(selection.hadith_like); }
  const rows=await q(`SELECT l.id,l.hadithId,l.type,l.ref_num,l.createdAt,l.user_uid,l.user_name,a.handle,a.name, a.custom_name,${ActivitySource.fields('l')} FROM hadiths_likes l ${ActivitySource.joins('l')} LEFT JOIN community_authors a ON a.uid=CONVERT(l.user_uid USING utf8mb4) COLLATE utf8mb4_bin
    WHERE l.user_uid IS NOT NULL AND l.user_uid<>'' ${filter} ORDER BY l.createdAt DESC,l.id DESC LIMIT ?`,[...params,limit]);
  for (const row of rows) {
    const writer=row.handle ? {handle:row.handle,name: communityName(row.name, row.custom_name)} : await Reflections.authorFor(q,row,'hadiths_likes');
    const source = ActivitySource.fromRow(row);
    result.push({id:row.id,activity:'hadith_like',kind:'like',author:writer,title:source.title,sourceRef:source.reference,excerpt:'',activityAt:row.createdAt || null,url:source.url || Reflections.sourceUrl(row,'hadiths_comments').split('#')[0]});
  }
  }
  for (const source of sourceTables) {
    if (selection && !selection[source+'_like']?.length) continue;
    const params=[];
    let filter=scopeWhere(scope,user,author,"CONVERT(v.user_uid USING utf8mb4) COLLATE utf8mb4_bin",params);
    if (selection) { filter += " AND v.id IN (?)"; params.push(selection[source+"_like"]); }
    const rows=await q(`SELECT v.id,v.commentId,v.user_uid,c.text,${source==='blog_comments'?'c.post_slug':'c.ref_num,c.hadithId,c.type'},l.created_at,a.handle,a.name, a.custom_name${source==='hadiths_comments' ? ',ci.url AS source_url' : ''}
      FROM ${source}_votes v JOIN ${source} c ON c.id=v.commentId
      ${source==='hadiths_comments' ? "LEFT JOIN content_items ci ON c.type='content' AND ci.id=c.hadithId" : ''}
      LEFT JOIN community_authors a ON a.uid=CONVERT(v.user_uid USING utf8mb4) COLLATE utf8mb4_bin
      LEFT JOIN community_likes l ON l.source=? AND l.target_id=v.commentId AND l.user_uid=CONVERT(v.user_uid USING utf8mb4) COLLATE utf8mb4_bin
      WHERE v.direction='up' AND COALESCE(c.deleted,0)=0 AND v.user_uid IS NOT NULL AND v.user_uid<>'' ${filter}
      ORDER BY l.created_at DESC,v.id DESC LIMIT ?`,[source,...params,limit]);
    for(const row of rows) {
      const writer=row.handle ? {handle:row.handle,name: communityName(row.name, row.custom_name)} : await Reflections.authorFor(q,row,source+'_votes');
      const target = source === 'hadiths_comments' ? ActivitySource.fromRow(row) : null;
      result.push({id:row.id,activity:source+'_like',kind:'like',likeSource:source,likeId:row.commentId,author:writer,
        title:require('./CommunityActivitySource').title('',row.text) || 'a comment',sourceRef:target?.reference || '',excerpt:Reflections.excerpt(row.text),
        activityAt:row.created_at || null,url:target?.url || Reflections.sourceUrl(row,source)});
    }
  }
  return result;
}
module.exports={decorate,set,feed};
