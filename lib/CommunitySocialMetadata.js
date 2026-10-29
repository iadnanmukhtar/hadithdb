'use strict';
const social = require('./SocialMetadata');
const fallback = 'Reader posts, articles, and conversations about Quran and hadith.';
const title = require('./ContentIdentity').authoredTitle;
function metadata(view, {post, initial} = {}) {
  if (view === 'post' && post && (!post.status || post.status === 'published')) {
    return {title_en:title(post.shareTitle || post.title,post.author?.name),
      description_en:social.excerpt(post.subtitle || post.excerpt || fallback),cover:post.coverUrl || undefined};
  }
  // This input comes exclusively from the anonymous Everyone feed. Never
  // summarize the authenticated Mine, Following, or author-profile feeds.
  if (view === 'everyone') {
    const snippets = (initial?.items || []).filter(item=>!item.status || item.status==='published').slice(0,3).map(item=>{
      const author = item.activity === 'repost' ? item.repostedBy : item.author;
      const name = social.plain(author?.name || 'A reader');
      const verb = item.activity === 'repost' ? 'reposted' : item.kind === 'like' ? 'liked' : item.kind === 'comment' ? 'commented' : 'posted';
      const subject = social.excerpt(item.excerpt || item.title || '',90);
      return subject ? `${name} ${verb}: ${subject}` : '';
    }).filter(Boolean);
    return {description_en:snippets.length ? social.excerpt('Recent community activity — '+snippets.join(' • ')) : fallback};
  }
  return {};
}
metadata.title = title;
module.exports = metadata;
