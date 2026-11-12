'use strict';
const Community = require('./Community');
const Identity = require('./CommunityPostIdentity');
const Freshness = require('./PageFreshness');
async function entries({ recent = false } = {}) {
  await Community.ensure();
  const rows = await Community.sql(`SELECT p.id,p.guid,a.handle,l.slug,p.published_at,p.public_updated_at
    FROM community_posts p JOIN community_authors a ON a.uid=p.author_uid
    LEFT JOIN community_blog_imports l ON l.post_id=p.id
    WHERE p.status='published' AND p.kind='article'
    ORDER BY COALESCE(p.public_updated_at,p.published_at) DESC,p.id DESC${recent ? ' LIMIT 1000' : ''}`);
  return rows.map(row => ({
    path: row.slug ? '/blog/' + encodeURIComponent(row.slug) : Identity.url(row),
    modified: Freshness.latest([row.public_updated_at,row.published_at])
  }));
}
module.exports = { entries };
