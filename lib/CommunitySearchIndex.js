'use strict';
const { load } = require('cheerio');
const SearchHttp = require('./SearchHttp');
const INDEX = 'community_articles_v1';
const textField = { type: 'text', analyzer: 'english', fields: { ar: { type: 'text', analyzer: 'arabic' } } };
const properties = {
  id: { type: 'long' }, ordinal: { type: 'long' }, book_ordinal: { type: 'long' },
  doctype: { type: 'keyword' }, url: { type: 'keyword', index: false },
  author: { type: 'keyword', index: false }, publishedAt: { type: 'date' },
  title_en: { type: 'text', analyzer: 'english' },
  article_title: textField, article_description: textField, article_text: textField
};
const endpoint = () => `${global.settings.search.domain}/${INDEX}`;
async function ensureIndex() {
  try { await SearchHttp.put(endpoint(), { mappings: { properties } }, SearchHttp.axiosConfig()); }
  catch (error) {
    if (error.response?.data?.error?.type !== 'resource_already_exists_exception') throw error;
    await SearchHttp.put(endpoint() + '/_mapping', { properties }, SearchHttp.axiosConfig());
  }
}
function document(row) {
  if (!row || row.status !== 'published' || row.kind !== 'article') return null;
  const Community = require('./Community');
  const $ = load(Community.content(row.public_markdown || '', 280, { linkPreviews: false }).html);
  $('script,style').remove();
  $('p,div,li,h1,h2,h3,h4,h5,h6,br').append(' ');
  return {
    id: Number(row.id), ordinal: Number(row.id), book_ordinal: 2147483647,
    doctype: row.blog_post_id != null ? 'blog' : 'community',
    url: row.slug ? '/blog/' + encodeURIComponent(row.slug) : require('./CommunityPostIdentity').url(row),
    author: require('./CommunityName')(row.name, row.custom_name),
    publishedAt: row.published_at || null, title_en: row.public_title || '',
    article_title: row.public_title || '', article_description: row.public_subtitle || '',
    article_text: $.text().replace(/\s+/g, ' ').trim()
  };
}
let ready;
function ensureReady() {
  if (!ready) ready = ensureIndex().catch(error => { ready = null; throw error; });
  return ready;
}
async function syncPost(postId) {
  await ensureReady();
  const Community = require('./Community');
  // Serialize the snapshot and ES write with edits to this post. No search request calls this.
  await Community.transaction(async q => {
    await q('SELECT id FROM community_posts WHERE id=? FOR UPDATE', [postId]);
    const row = (await q(`SELECT p.id,p.guid,p.kind,p.status,p.public_title,p.public_subtitle,p.public_markdown,p.published_at,
      a.name,a.custom_name,a.handle,b.post_id AS blog_post_id,l.slug
      FROM community_posts p JOIN community_authors a ON a.uid=p.author_uid
      LEFT JOIN community_blog_posts b ON b.post_id=p.id
      LEFT JOIN community_blog_imports l ON l.post_id=p.id WHERE p.id=?`, [postId]))[0];
    const doc = document(row);
    const url = endpoint() + '/_doc/' + encodeURIComponent(postId) + '?refresh=true';
    if (doc) await SearchHttp.put(url, doc, SearchHttp.axiosConfig());
    else {
      try { await SearchHttp.delete(url, SearchHttp.axiosConfig()); }
      catch (error) { if (error.response?.status !== 404) throw error; }
    }
  });
}
async function syncAuthor(uid) {
  const rows = await require('./Community').sql("SELECT id FROM community_posts WHERE author_uid=? AND kind='article'", [uid]);
  for (const row of rows) await syncPost(row.id);
}
async function syncBatch(ids) {
  if (!ids.length) return;
  const Community = require('./Community');
  await Community.transaction(async q => {
    await q('SELECT id FROM community_posts WHERE id IN (?) ORDER BY id FOR UPDATE', [ids]);
    const rows = await q(`SELECT p.id,p.guid,p.kind,p.status,p.public_title,p.public_subtitle,p.public_markdown,p.published_at,
      a.name,a.custom_name,a.handle,b.post_id AS blog_post_id,l.slug
      FROM community_posts p JOIN community_authors a ON a.uid=p.author_uid
      LEFT JOIN community_blog_posts b ON b.post_id=p.id
      LEFT JOIN community_blog_imports l ON l.post_id=p.id WHERE p.id IN (?)`, [ids]);
    const byId = new Map(rows.map(row => [Number(row.id), row]));
    let payload = '';
    async function flush() {
      if (!payload) return;
      const large = Buffer.byteLength(payload) > 384 * 1024;
      const response = await SearchHttp.post(endpoint() + '/_bulk?refresh=true', large ? require('zlib').gzipSync(payload) : payload,
        SearchHttp.axiosConfig({ headers: { 'Content-Type': 'application/x-ndjson', ...(large ? { 'Content-Encoding': 'gzip' } : {}) }, timeout: 120000 }));
      const failures = (response.data.items || []).filter(item => {
        const result = item.index || item.delete;
        return result.status >= 300 && !(item.delete && result.status === 404);
      });
      if (failures.length || (response.data.errors && !response.data.items))
        throw new Error('Article indexing failed: ' + JSON.stringify(failures.slice(0, 3)));
      payload = '';
    }
    for (const id of ids) {
      const doc = document(byId.get(Number(id)));
      const record = JSON.stringify({ [doc ? 'index' : 'delete']: { _id: String(id) } }) + '\n'
        + (doc ? JSON.stringify(doc) + '\n' : '');
      // Bound bytes, not just row count: imported articles can be long.
      if (payload && Buffer.byteLength(payload + record) > 384 * 1024) await flush();
      payload += record;
    }
    await flush();
  });
}
async function rebuild(onProgress = () => {}) {
  const Community = require('./Community');
  await Community.ensure();
  await ensureIndex();
  let after = 0, count = 0;
  while (true) {
    const rows = await Community.sql('SELECT id FROM community_posts WHERE id>? ORDER BY id LIMIT 100', [after]);
    if (!rows.length) break;
    await syncBatch(rows.map(row => Number(row.id)));
    after = Number(rows[rows.length - 1].id);
    count += rows.length;
    onProgress(count);
  }
  return count;
}

function formatResult(doc) {
  const fragments = doc._highlight?.article_text || doc._highlight?.['article_text.ar'];
  // Highlights are plain text plus ES markers; escape everything before allowing those markers.
  const excerpt = fragments?.length ? fragments.join(' … ') : (doc.article_text || '').slice(0, 280);
  const escaped = String(excerpt).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  return { ...doc, excerpt, excerpt_html: escaped.replace(/&lt;i&gt;/g, '<mark>').replace(/&lt;\/i&gt;/g, '</mark>') };
}
module.exports = { INDEX, properties, ensureIndex, document, syncPost, syncAuthor, syncBatch, rebuild, formatResult };
