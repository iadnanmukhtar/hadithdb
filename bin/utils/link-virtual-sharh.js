#!/usr/bin/env node
'use strict';
// Recover ownership only from the exact numbering contracts of these importers.
const fs = require('fs');
const VirtualSharh = require('../../lib/VirtualHadithSharh');
function plan(rows, virtualRows, alignment, repair = false) {
  return rows.map(row => {
    let number, candidates;
    if (row.source_book_id === -9) {
      const matches = alignment.segments.filter(s => s.kind === 'hadith' && (s.entryId ?? (-9000000-s.start)) === row.source_entry_id);
      if (matches.length !== 1) throw Error(`Ambiguous Dalil entry ${row.id}`);
      number = matches[0].number;
      candidates = virtualRows.filter(v => v.bookId === 61 && v.id === matches[0].virtualId);
    } else {
      number = row.source_book_id === -5 ? row.source_entry_id % 10000 : row.source_book_id === -7 ? -7000000-row.source_entry_id : row.source_entry_id;
      candidates = virtualRows.filter(v => v.hadithId !== null && v.bookId === (row.source_book_id === -5 ? 61 : 57) &&
        (row.source_book_id === -7 ? v.h2 === number : row.source_book_id === -5 ? Math.floor(v.num0) === number : Number(v.num0) === number));
      // Same primary-entry ordering as the original importers.
      candidates.sort((a,b) => a.num0-b.num0 || (row.source_book_id === -5 ? (a.textActual === null)-(b.textActual === null) : 0) || a.id-b.id);
      candidates = candidates.slice(0,1);
    }
    const target = candidates[0];
    if (!target || !target.hadithId || (!repair && target.hadithId !== row.hadith_id)) throw Error(`Ownership mismatch for sharh ${row.id}`);
    return { sharhId:row.id, virtualId:target.id, number, oldHadithId:row.hadith_id, hadithId:target.hadithId };
  });
}
async function linkSources(query, sourceIds, repair = false) {
  const rows = await query(`SELECT hs.id,hs.hadith_id,hs.source_entry_id,s.source_book_id FROM hdith_hadith_sharh hs JOIN hdith_sharh_sources s ON s.id=hs.source_id WHERE s.source_book_id IN (-5,-6,-7,-9)${sourceIds ? ' AND s.id IN (?)' : ''}`, sourceIds ? [sourceIds] : []);
  const virtualRows = await query('SELECT hv.id,hv.bookId,hv.num0,t.h2,hv.hadithId,hv.textActual FROM hadiths_virtual hv JOIN toc t ON t.id=hv.tocId WHERE hv.bookId IN (57,61) ORDER BY hv.num0,hv.id');
  const links = plan(rows,virtualRows,require('./riyad-dalil-alignment.json'), repair);
  await VirtualSharh.linkRows(query,links);
  for (const link of links.filter(l=>l.oldHadithId !== l.hadithId)) {
    await query('UPDATE hdith_hadith_sharh SET hadith_id=? WHERE id=? AND hadith_id=?',[link.hadithId,link.sharhId,link.oldHadithId]);
  }
  return links;
}
async function main() {
  require('dotenv').config();
  const mysql=require('mysql'),{promisify}=require('util');
  const db=mysql.createConnection(require('../initializeHadithAttributions').connectionSettings());
  const query=promisify(db.query).bind(db);
  try {
    if (process.argv.includes('--apply')) await VirtualSharh.ensureSchema(query);
    await query('START TRANSACTION');
    await query('SELECT id FROM books WHERE id IN (57,61) ORDER BY id FOR UPDATE');
    await query('SELECT id FROM hadiths_virtual WHERE bookId IN (57,61) ORDER BY bookId,ordinal,id FOR UPDATE');
    const before=await query('SELECT * FROM hdith_virtual_sharh_links');
    fs.mkdirSync('temp/virtual-sharh',{recursive:true});
    fs.writeFileSync(`temp/virtual-sharh/ownership-${Date.now()}.json`,JSON.stringify(before));
    const commentary=await query('SELECT hs.* FROM hdith_hadith_sharh hs JOIN hdith_sharh_sources s ON s.id=hs.source_id WHERE s.source_book_id IN(-5,-6,-7,-9)');
    fs.writeFileSync(`temp/virtual-sharh/commentary-${Date.now()}.json`,JSON.stringify(commentary));
    const links=await linkSources(query,undefined,true);
    const moved=links.filter(l=>l.oldHadithId !== l.hadithId);
    fs.writeFileSync('temp/virtual-sharh/plan.json',JSON.stringify({links,moved},null,2));
    await query(process.argv.includes('--apply') ? 'COMMIT' : 'ROLLBACK');
    console.log(JSON.stringify({links:links.length,moved,applied:process.argv.includes('--apply')}));
  } finally { await query('ROLLBACK'); db.end(); }
}
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});
module.exports={plan,linkSources};
