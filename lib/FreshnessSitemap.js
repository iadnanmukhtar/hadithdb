'use strict';
const Freshness = require('./PageFreshness');
const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
async function entries({ quranOnly, base }) {
  // A bounded supplement to the full sitemap: discover recently corrected pages,
  // including untitled records absent from the historical catalog sitemap.
  const rows = await global.query(`SELECT b.alias,h.num,h.lastfixed
    FROM hadiths h JOIN books b ON b.id=h.bookId
    WHERE ${quranOnly ? "b.alias='quran'" : "b.alias<>'quran' AND COALESCE(b.type,'hadith') IN ('hadith','sirah','history')"}
      AND h.lastfixed IS NOT NULL AND h.lastfixed <= CURRENT_TIMESTAMP()
    ORDER BY h.lastfixed DESC,h.id DESC LIMIT 1000`);
  const result = rows.map(row => ({ url: `${base}/${row.alias}:${row.num}`, modified: Freshness.latest([row.lastfixed]) }));
  if (quranOnly) {
    const passages = await require('./Tafsir').recentUpdatedPassages();
    result.push(...passages.map(passage => ({ url: `${base}${passage.path}`, modified: Freshness.latest([passage.lastmod]) })));
  }
  if (!quranOnly) {
    const passages = await require('./Sharh').recentUpdatedPassages();
    result.push(...passages.map(passage => ({ url: `${base}${passage.path}`, modified: Freshness.latest([passage.modified]) })));
    const articles = await require('./CommunitySitemap').entries({ recent: true });
    result.push(...articles.map(article => ({ url: `${base}${article.path}`, modified: article.modified })));
    const feed = await require('./Community').feed({});
    result.push({ url: `${base}/community`, modified: Freshness.community(feed) });
    for (const item of feed.items || []) {
      if (item.activity !== 'post' || !item.url || !/^\/(?:community\/|blog\/)/.test(item.url) || (item.status && item.status !== 'published')) continue;
      result.push({ url: `${base}${item.url}`, modified: Freshness.latest([item.publicUpdatedAt, item.publishedAt]) });
    }
  }
  const unique = new Map();
  for (const entry of result) unique.set(entry.url, { ...entry, modified: Freshness.latest([unique.get(entry.url)?.modified, entry.modified]) });
  return [...unique.values()];
}
function xml(entries) {
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    entries.map(entry => `  <url><loc>${escape(entry.url)}</loc>${entry.modified ? `<lastmod>${escape(entry.modified)}</lastmod>` : ''}</url>`).join('\n') + '\n</urlset>\n';
}
module.exports = { entries, xml };
