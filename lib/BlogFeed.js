'use strict';
const Media=require('./CommunityMedia');
const {excerpt}=require('./SocialMetadata');
function item(post) {
  return {id:post.postId,kind:'article',activity:'post',status:'published',title:post.title,subtitle:post.subtitle || '',
    excerpt:excerpt(post.html || post.description || post.subtitle || ''),coverUrl:post.cover?.trim() || require('./BlogCover'),
    mediaHtml:Media.extract(post.html || ''),url:post.url || '/blog/'+post.file,shareUrl:post.shareUrl,
    shareTitle:post.title,activityAt:post.published.toISOString(),publicationDate:post.published.toISOString().slice(0,10),
    author:{name:post.authorName || post.author || '',handle:post.authorHandle,photo:post.authorPhoto,avatarFallback:post.authorAvatarFallback},
    likeSource:post.postId?'post':null,likeId:post.postId,blogCommentSlug:post.file || null};
}
module.exports={item};
async function states(ids,user=null) {
  const C=require('./Community');
  await C.ensure();
  const rows=await C.sql(`SELECT p.id,l.slug,
    CASE WHEN l.slug IS NOT NULL THEN (SELECT COUNT(*) FROM blog_comments c WHERE c.post_slug=l.slug AND COALESCE(c.deleted,0)=0)
    ELSE (SELECT COUNT(*) FROM community_comments c WHERE c.post_id=p.id AND c.deleted=0) END AS commentCount
    FROM community_posts p LEFT JOIN community_blog_imports l ON l.post_id=p.id
    WHERE p.id IN (?) AND p.status='published'`,[ids]);
  const items=rows.map(row=>({id:row.id,likeId:row.id,likeSource:'post',commentCount:Number(row.commentCount)}));
  await require('./CommunityLikes').decorate(C.sql,items,user);
  await require('./CommunityInteractions').decorate(C.sql,items,user);
  // Imported articles keep their existing blog reflection thread.
  for (const item of items) item.commentCount=Number(rows.find(row=>row.id===item.id).commentCount);
  return items;
}
module.exports.states=states;
