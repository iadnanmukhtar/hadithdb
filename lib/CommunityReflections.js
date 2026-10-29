'use strict';
const communityName = require('./CommunityName');
const crypto = require('crypto');
const { load } = require('cheerio');
const md = require('markdown-it')({ html: false, linkify: true, breaks: true });
const sources = ['hadiths_comments', 'blog_comments'];
// Never infer account ownership from an email address or display name.
function uidFor(row, source) {
  if (row.user_uid && row.user_uid.length <= 128) return row.user_uid;
  return 'legacy-reflection:' + crypto.createHash('sha256').update(source + ':' + row.id).digest('hex');
}
async function authorFor(q, row, source) {
  const uid = uidFor(row, source);
  const name = String(row.user_name || '').trim();
  await q(`INSERT INTO community_authors (uid, handle, name) VALUES (?, ?, ?)
    ON DUPLICATE KEY UPDATE uid=uid`, [uid, 'author-' + crypto.randomBytes(8).toString('hex'),
    name && !/\S+@\S+/.test(name) ? name.slice(0, 120) : 'Community member']);
  await require('./UserAvatar').seedHistorical(q, row, uid);
  const author = (await q('SELECT handle, name, custom_name FROM community_authors WHERE uid=?', [uid]))[0];
  return {...author, name: communityName(author.name, author.custom_name)};
}
async function backfill(q) {
  const counts = {};
  for (const source of sources) {
    const rows = await q(`SELECT id, user_uid, user_name, user_email, user_photo FROM ${source} WHERE COALESCE(deleted,0)=0 AND text IS NOT NULL AND TRIM(text)<>'' ORDER BY (user_photo IS NOT NULL AND user_photo<>'') DESC, createdAt DESC, id DESC`);
    for (const row of rows) await authorFor(q, row, source);
    counts[source] = rows.length;
  }
  return counts;
}
async function feed(q, { scope, user, author, limit, selection }) {
  const items = [];
  for (const source of sources) {
    if (selection && !selection[source]?.length) continue;
    const identity = `CASE WHEN c.user_uid IS NOT NULL AND CHAR_LENGTH(c.user_uid) BETWEEN 1 AND 128 THEN CONVERT(c.user_uid USING utf8mb4) COLLATE utf8mb4_bin ELSE CONCAT('legacy-reflection:', SHA2(CONCAT('${source}:', c.id), 256)) END`;
    let where = "COALESCE(c.deleted,0)=0 AND c.text IS NOT NULL AND TRIM(c.text)<>''";
    const params = [];
    if (scope === 'mine') { where += ` AND ${identity}=?`; params.push(user.uid); }
    if (scope === 'following') { where += ` AND EXISTS (SELECT 1 FROM community_follows f WHERE f.author_uid=${identity} AND f.follower_uid=?)`; params.push(user.uid); }
    if (author) { where += ` AND ${identity}=?`; params.push(author.uid); }
    if (selection) { where += ' AND c.id IN (?)'; params.push(selection[source]); }
    const rows = await q(`SELECT c.*, a.handle, a.name, a.custom_name FROM ${source} c LEFT JOIN community_authors a ON a.uid=${identity}
      WHERE ${where} ORDER BY c.createdAt DESC, c.id DESC LIMIT ?`, [...params, limit]);
    await require('./UserAvatar').decorateRows(rows);
    for (const row of rows) {
      const writer = row.handle ? { handle: row.handle, name: communityName(row.name, row.custom_name) } : await authorFor(q, row, source);
      Object.assign(writer, {photo:row.avatarPhoto,avatarFallback:row.avatarFallback});
      items.push({ id: row.id, activity: source, kind: 'comment', author: writer,
        title: source === 'blog_comments' ? 'Discussion on ' + row.post_slug : 'Reflection on ' + (row.ref_num || row.hadithId),
        excerpt: excerpt(row.text), html: require('./Community').content(row.text).html,
        activityAt: row.createdAt || new Date(0), url: sourceUrl(row, source) });
    }
  }
  return items;
}
function excerpt(text) { return load(md.render(text || ''), null, false).text().trim().replace(/\s+/g, ' ').slice(0, 280); }
function sourceUrl(row, source) {
      const blog = source === 'blog_comments';
      if (!blog && row.type === 'content') return '/items/' + row.hadithId + '#content-item-' + row.hadithId;
      const ref = String(row.ref_num || row.hadithId || '');
      const quran = !blog && (row.type === 'toc' || ref.startsWith('quran:'));
      const encodedRef = ref.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/').replace(/%3A/gi, ':');
      const target = blog ? '/blog/' + encodeURIComponent(row.post_slug) : (quran && row.type !== 'toc' ? '/quran/translations/' : '/') + encodedRef;
      const anchor = blog ? '#blog-comments' : row.type === 'toc' ? '#quran-passage-comments-' + row.hadithId : '#comments';
  return target + anchor;
}
module.exports = { feed, backfill, authorFor, excerpt, sourceUrl };
