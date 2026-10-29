'use strict';
const {title, activity: fromRow} = require('./ContentIdentity');
// These columns ride along with the existing activity query. All joins are
// primary-key lookups; no reader, search index, or follow-up hydration is needed.
function fields(alias) {
  return `CASE ${alias}.type WHEN 'content' THEN ci.title WHEN 'toc' THEN COALESCE(NULLIF(t.title_en,''),t.title) ELSE COALESCE(NULLIF(h.title_en,''),h.title) END AS source_title,
    CASE ${alias}.type WHEN 'toc' THEN CASE WHEN COALESCE(NULLIF(t.title_en,''),NULLIF(t.title,'')) IS NULL THEN COALESCE(NULLIF(t.intro_en,''),t.intro) END
      WHEN 'hadith' THEN CASE WHEN COALESCE(NULLIF(h.title_en,''),NULLIF(h.title,'')) IS NULL THEN COALESCE(NULLIF(h.body_en,''),h.body) END END AS source_text,
    ci.url AS source_url`;
}
function joins(alias) {
  return `LEFT JOIN content_items ci ON ${alias}.type='content' AND ci.id=${alias}.hadithId
    LEFT JOIN hadiths h ON (${alias}.type='hadith' OR ${alias}.type IS NULL) AND h.id=${alias}.hadithId
    LEFT JOIN toc t ON ${alias}.type='toc' AND t.id=${alias}.hadithId`;
}
async function resolve(q, row) {
  // Email uses the same persisted fields as the feed, with one indexed lookup.
  if (row.type === 'content') {
    const [item] = await q('SELECT title AS source_title,url AS source_url FROM content_items WHERE id=? LIMIT 1',[row.hadithId]);
    return fromRow({...row,...item});
  }
  const heading = row.type === 'toc';
  const [item] = await q(heading
    ? "SELECT COALESCE(NULLIF(title_en,''),title) AS source_title,COALESCE(NULLIF(intro_en,''),intro) AS source_text FROM toc WHERE id=? LIMIT 1"
    : "SELECT COALESCE(NULLIF(title_en,''),title) AS source_title,COALESCE(NULLIF(body_en,''),body) AS source_text FROM hadiths WHERE id=? LIMIT 1", [row.hadithId]);
  return fromRow({...row,...item});
}
module.exports = {resolve,title,fields,joins,fromRow};
