'use strict';
const C = require('./Community');
const R = require('./CommunityReflections');
const {load} = require('cheerio');
const tables = Object.freeze({post:'community_posts', comment:'community_comments', hadiths_comments:'hadiths_comments',
  blog_comments:'blog_comments', like:'community_likes', hadith_like:'hadiths_likes',
  hadiths_comments_like:'hadiths_comments_votes', blog_comments_like:'blog_comments_votes', repost:'community_reposts'});
const sourceNames = Object.keys(tables);
const eligible = author => !!author && author.profile_visibility === 'public' && !author.uid.startsWith('legacy-reflection:');
async function author(q, uid) {
  if (!uid) return null;
  const row = (await q('SELECT uid,handle,name,custom_name,profile_visibility FROM community_authors WHERE uid=?', [uid]))[0];
  return eligible(row) ? row : null;
}
async function row(q, source, id) {
  if (!tables[source]) return null;
  return (await q(`SELECT * FROM ${tables[source]} WHERE id=?`, [id]))[0] || null;
}
async function target(q, source, id) {
  const item = await read(q, source, id);
  if (!item || item.reaction) return null;
  return {source, id, url:item.url};
}
async function read(q, source, id) {
  const r = await row(q, source, id);
  if (!r) return null;
  if ((await q('SELECT source_id FROM community_hidden_activity WHERE source=? AND source_id=?',[source,id])).length) return null;
  const writer = await author(q, source === 'post' || source === 'comment' ? r.author_uid : r.user_uid);
  if (!writer) return null;
  const base = {source, id:Number(id), author:writer};
  if (source === 'post') {
    if (r.status !== 'published' || !r.public_markdown?.trim()) return null;
    const imported = (await q('SELECT slug FROM community_blog_imports WHERE post_id=?', [id]))[0];
    return {...base, title:require('./ContentIdentity').postTitle(r.public_title, C.content(r.public_markdown).html, r.kind), subtitle:r.public_subtitle || '', markdown:r.public_markdown,
      cover:require('./CommunityCover').url(r.public_cover_url), published:r.published_at,
      url:imported ? '/blog/' + encodeURIComponent(imported.slug) : require('./CommunityPostIdentity').url({...r,handle:writer.handle})};
  }
  if (source === 'comment') {
    if (r.deleted || !r.markdown?.trim()) return null;
    const parent = await target(q, 'post', r.post_id);
    if (!parent) return null;
    const reply = r.parent_id && (await q("SELECT id FROM community_comments WHERE id=? AND post_id=? AND deleted=0",[r.parent_id,r.post_id]))[0];
    return {...base, markdown:r.markdown, published:r.created_at, url:parent.url + '#comment-' + id,
      reply:reply ? {source:'comment',id:reply.id} : {source:'post', id:r.post_id}};
  }
  if (source === 'hadiths_comments' || source === 'blog_comments') {
    if (r.deleted || !r.text?.trim()) return null;
    const url = R.sourceUrl(r, source);
    return {...base, markdown:r.text, published:r.createdAt, url,
      reply:r.parentId ? {source, id:r.parentId} : {url:url.split('#')[0]}};
  }
  if (source === 'hadith_like') {
    return {...base, reaction:'Like', published:r.createdAt, target:{url:R.sourceUrl(r, 'hadiths_comments').split('#')[0]}};
  }
  if (source === 'hadiths_comments_like' || source === 'blog_comments_like') {
    if (r.direction !== 'up') return null;
    const original = await target(q, source.replace(/_like$/, ''), r.commentId);
    if (!original) return null;
    const date = (await q('SELECT created_at FROM community_likes WHERE source=? AND target_id=? AND user_uid=?',
      [original.source, r.commentId, r.user_uid]))[0]?.created_at;
    return {...base, reaction:'Like', published:date, target:original};
  }
  // Reflection likes live in their original vote tables; do not federate their
  // compatibility rows in community_likes a second time.
  if (source === 'like' && !['post','comment'].includes(r.source)) return null;
  if (!['post','comment','hadiths_comments','blog_comments'].includes(r.source)) return null;
  const original = await target(q, r.source, r.target_id);
  if (!original) return null;
  return {...base, reaction:source === 'repost' ? 'Announce' : 'Like', published:r.created_at, target:original};
}
function html(markdown, origin) {
  const $ = load(C.content(markdown).html, null, false);
  $('[href],[src]').each((_, el) => {
    for (const attr of ['href','src']) {
      const value = $(el).attr(attr);
      if (!value) continue;
      try { const url = new URL(value, origin); if (/^https?:$/.test(url.protocol)) $(el).attr(attr,url.href); else $(el).removeAttr(attr); }
      catch (_) { $(el).removeAttr(attr); }
    }
  });
  return $.html();
}
module.exports = {tables, sourceNames, eligible, author, read, html};
