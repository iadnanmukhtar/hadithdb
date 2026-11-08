'use strict';
const error = require('http-errors');
const Identity = require('./CommunityPostIdentity');
async function migrate(q) {
  for (const [table, column] of [['community_posts','related_article_id'], ['community_posts','public_related_article_id'], ['community_revisions','related_article_id']]) {
    try { await q(`ALTER TABLE ${table} ADD COLUMN ${column} BIGINT UNSIGNED NULL`); }
    catch (err) { if (err.code !== 'ER_DUP_FIELDNAME') throw err; }
  }
  try { await q('ALTER TABLE community_posts ADD INDEX community_related_article (public_related_article_id)'); }
  catch (err) { if (err.code !== 'ER_DUP_KEYNAME') throw err; }
}
async function resolve(q, value, postId, previous) {
  if (value === undefined) return previous || null;
  if (value === '') return null;
  if (typeof value !== 'string' || value.length > 2000) throw error(400, 'Enter a valid article link.');
  const base = global.settings?.site?.url || 'https://hadithunlocked.com';
  let url;
  try { url = new URL(value.trim(), base); } catch { throw error(400, 'Enter a valid article link.'); }
  const origins = new Set([new URL(base).origin, ...(global.settings?.site?.quranUrl ? [new URL(global.settings.site.quranUrl).origin] : [])]);
  if (!origins.has(url.origin) || url.username || url.password) throw error(400, 'Choose an article on this site.');
  let where, values;
  const guid = url.pathname.match(/^\/community\/p\/([^/]+)\/?$/);
  const legacy = url.pathname.match(/^\/community\/@([^/]+)\/(\d+)\/?$/);
  const blog = url.pathname.match(/^\/blog\/([^/]+)\/?$/);
  try {
    if (guid && Identity.valid(guid[1])) { where='p.guid=?'; values=[guid[1].toLowerCase()]; }
    else if (legacy) { where='a.handle=? AND p.id=?'; values=[decodeURIComponent(legacy[1]),legacy[2]]; }
    else if (blog) { where='l.slug=?'; values=[decodeURIComponent(blog[1])]; }
  } catch { throw error(400, 'Enter a valid article link.'); }
  if (!where) throw error(400, 'Paste a Community or Blog article link.');
  const row=(await q(`SELECT p.id FROM community_posts p JOIN community_authors a ON a.uid=p.author_uid
    LEFT JOIN community_blog_imports l ON l.post_id=p.id WHERE p.status='published' AND p.kind='article' AND ${where}`,values))[0];
  if (!row || Number(row.id)===Number(postId)) throw error(400, 'Choose another published article.');
  return row.id;
}
async function editorUrl(q, id) {
  if (!id) return '';
  const row=(await q(`SELECT p.id,p.guid,a.handle,l.slug FROM community_posts p JOIN community_authors a ON a.uid=p.author_uid
    LEFT JOIN community_blog_imports l ON l.post_id=p.id WHERE p.id=? AND p.status='published' AND p.kind='article'`,[id]))[0];
  return row ? (row.slug ? '/blog/'+encodeURIComponent(row.slug) : Identity.url(row)) : '';
}
module.exports={migrate,resolve,editorUrl};
