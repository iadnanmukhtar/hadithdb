#!/usr/bin/env node
'use strict';
// One-time refresh of existing stored labels after changing title generation.
// No feed-time repair, no search-index reads, and no schema changes.
const Source=require('../lib/CommunityActivitySource');
async function refresh(q,apply=false) {
  const changes=[];
  for(const kind of ['sharh','heading-sharh','intro']) {
    const heading=kind==='heading-sharh';
    const rows=kind==='intro'
      ? await q(`SELECT ci.id,ci.title AS old_title,ci.url AS old_url,t.title_en,t.title,t.intro_en AS text_en,t.intro AS text
          FROM content_items ci JOIN toc t ON t.id=CAST(SUBSTRING_INDEX(ci.source_key,':',-1) AS UNSIGNED)
          WHERE ci.source_key LIKE 'intro:%'`)
      : await q(`SELECT ci.id,ci.title AS old_title,ci.url AS old_url,hs.id AS entry_id,hs.title_en,hs.title,hs.text_en,hs.text,sb.alias,
          ${heading ? 'hs.id' : "CONCAT(hb.alias,':',h.num)"} AS reference
          FROM content_items ci JOIN ${heading ? 'hdith_toc_sharh' : 'hdith_hadith_sharh'} hs ON hs.id=CAST(SUBSTRING_INDEX(ci.source_key,':',-1) AS UNSIGNED)
          JOIN hdith_sharh_sources ss ON ss.id=hs.source_id ${require('../lib/SharhBooks').join()}
          ${heading ? 'JOIN toc t ON t.id=hs.toc_id' : 'JOIN hadiths h ON h.id=hs.hadith_id JOIN books hb ON hb.id=h.bookId'}
          WHERE ci.source_key LIKE ?`,[kind+':%']);
    for(const row of rows) {
      const title=Source.title(row.title_en || row.title,row.text_en || row.text) || (kind==='intro' ? 'Introduction' : row.alias);
      const url=kind==='intro' ? row.old_url
        : `/sharh/${row.alias}/${heading ? 'heading/' : ''}${row.reference}#note-${kind}-${row.entry_id}`;
      // Introduction identities/anchors are already canonical; this refresh
      // updates their title only, preserving the stored interaction destination.
      if(title!==row.old_title || url!==row.old_url)changes.push({id:row.id,title,url,oldTitle:row.old_title,oldUrl:row.old_url});
    }
  }
  let updated=0;
  if(apply && changes.length) {
    await q('START TRANSACTION');
    try {
      for(const row of changes) {
        const result=await q('UPDATE content_items SET title=?,url=? WHERE id=? AND title=? AND url=?',[row.title,row.url,row.id,row.oldTitle,row.oldUrl]);
        updated+=result.affectedRows;
      }
      await q('COMMIT');
    } catch(error) {await q('ROLLBACK');throw error;}
  }
  return {candidates:changes.length,updated,apply};
}
async function main() {
  const mysql=require('mysql'),settings=require(require('os').homedir()+'/.hadithdb/settings.json');
  const db=mysql.createConnection({...settings.mysql.connection,connectTimeout:10000});
  const q=(sql,values)=>new Promise((resolve,reject)=>db.query(sql,values,(error,rows)=>error?reject(error):resolve(rows)));
  try {console.log(JSON.stringify(await refresh(q,process.argv.includes('--apply'))));}
  finally {db.end();}
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={refresh};
