'use strict';
// Nullable columns distinguish legacy rows from intentionally cleared subtitles.
async function migrate(sql) {
  for (const [table, column] of [['community_posts','subtitle'],['community_posts','public_subtitle'],['community_revisions','subtitle']]) {
    try { await sql(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT NULL`); }
    catch (err) { if (err.code !== 'ER_DUP_FIELDNAME') throw err; }
  }
  await sql(`UPDATE community_posts p JOIN community_blog_imports b ON b.post_id=p.id
    SET p.subtitle=COALESCE(p.subtitle,NULLIF(JSON_UNQUOTE(JSON_EXTRACT(b.attributes_json,'$.subtitle')),'null'),''),
        p.public_subtitle=COALESCE(p.public_subtitle,NULLIF(JSON_UNQUOTE(JSON_EXTRACT(b.attributes_json,'$.subtitle')),'null'),'')
    WHERE p.kind='article' AND (p.subtitle IS NULL OR p.public_subtitle IS NULL)`);
  await sql(`UPDATE community_revisions r JOIN community_blog_imports b ON b.post_id=r.post_id
    SET r.subtitle=COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(b.attributes_json,'$.subtitle')),'null'),'') WHERE r.subtitle IS NULL`);
  await sql("UPDATE community_posts SET subtitle=COALESCE(subtitle,''),public_subtitle=COALESCE(public_subtitle,'') WHERE subtitle IS NULL OR public_subtitle IS NULL");
  await sql("UPDATE community_revisions SET subtitle='' WHERE subtitle IS NULL");
}
module.exports={migrate};
