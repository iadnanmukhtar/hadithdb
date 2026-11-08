'use strict';
const Community = require('./Community');
const PostIdentity = require('./CommunityPostIdentity');
const select = `SELECT p.id,p.guid,p.public_title,p.public_cover_url,p.public_category,a.handle,l.slug
  FROM community_posts p JOIN community_authors a ON a.uid=p.author_uid
  LEFT JOIN community_blog_imports l ON l.post_id=p.id`;
function item(row) {
  return {id:Number(row.id),title:row.public_title || 'Untitled article',category:row.public_category || '',authorHandle:row.handle,
    coverUrl:require('./CommunityCover').url(row.public_cover_url) || require('./BlogCover'),
    url:row.slug ? '/blog/'+encodeURIComponent(row.slug) : PostIdentity.url(row)};
}
async function latest(exclude = []) {
  await Community.ensure();
  const ids=exclude.filter(id=>Number.isSafeInteger(Number(id)) && Number(id)>0).map(Number);
  const rows=await Community.sql(`${select} WHERE p.status='published' AND p.kind='article'
    ${ids.length ? 'AND p.id NOT IN (?)' : ''} ORDER BY p.published_at DESC,p.id DESC LIMIT 6`,ids.length?[ids]:[]);
  return rows.map(item);
}
const tags = value => [...new Set(String(value || '').split(',').map(tag=>tag.trim().toLowerCase()).filter(Boolean))];
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
async function forArticle(id) {
  await Community.ensure();
  // Read only published metadata, including for an author's own article page.
  const source=(await Community.sql("SELECT id,author_uid,public_category,public_tags,public_related_article_id FROM community_posts WHERE id=? AND status='published' AND kind='article'",[id]))[0];
  if (!source) return {authorArticles:[],relatedArticles:[]};
  const tagPatterns=tags(source.public_tags).map(tag=>'(^|,)[[:space:]]*'+escapeRegex(tag)+'[[:space:]]*(,|$)');
  const tagScore=tagPatterns.length ? tagPatterns.map(()=>'(LOWER(COALESCE(p.public_tags,\'\')) REGEXP ?)').join(' + ') : '0';
  // Explicit links work in both directions; metadata matches are exact tags/categories, never body searches.
  const ranked=`SELECT p.id, ((p.id=? OR p.public_related_article_id=?) IS TRUE) AS explicit_match,
    (${tagScore}) AS tag_matches, (p.public_category<>'' AND p.public_category=?) AS category_match
    FROM community_posts p WHERE p.status='published' AND p.kind='article' AND p.id<>?`;
  const [rows,authorRows]=await Promise.all([Community.sql(`${select} JOIN (${ranked}) matches ON matches.id=p.id
    WHERE matches.explicit_match>0 OR matches.tag_matches>0 OR matches.category_match>0
    ORDER BY matches.explicit_match DESC,matches.tag_matches DESC,matches.category_match DESC,p.published_at DESC,p.id DESC LIMIT 6`,
    [source.public_related_article_id || 0,Number(id),...tagPatterns,source.public_category || '',Number(id)]),
    Community.sql(`${select} WHERE p.status='published' AND p.kind='article'
    AND p.author_uid=? AND p.id<>? ORDER BY p.published_at DESC,p.id DESC LIMIT 6`,[source.author_uid,Number(id)])]);
  return {relatedArticles:rows.map(item),authorArticles:authorRows.map(item)};
}
module.exports={latest,forArticle,tags};
