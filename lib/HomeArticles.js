'use strict';

const Community = require('./Community');
const PostIdentity = require('./CommunityPostIdentity');

async function latest() {
  await Community.ensure();
  // Blog imports and featured articles share the same published post records.
  const rows = await Community.sql(`SELECT p.id, p.guid, p.public_title, p.public_cover_url,
    a.handle, l.slug
    FROM community_posts p
    JOIN community_authors a ON a.uid=p.author_uid
    LEFT JOIN community_blog_imports l ON l.post_id=p.id
    WHERE p.status='published' AND p.kind='article'
    ORDER BY p.published_at DESC, p.id DESC LIMIT 6`);
  return rows.map(row => ({
    title: row.public_title,
    authorHandle: row.handle,
    coverUrl: require('./CommunityCover').url(row.public_cover_url) || require('./BlogCover'),
    url: row.slug ? '/blog/' + encodeURIComponent(row.slug) : PostIdentity.url(row)
  }));
}

module.exports = { latest };
