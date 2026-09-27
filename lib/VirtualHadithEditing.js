'use strict';
const { promisify } = require('util');
const createError = require('http-errors');

function positiveId(value) {
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value)))
    throw createError(400, 'Invalid hadith ID');
  return Number(value);
}

async function selectHadith(virtualId, targetId, action, userId) {
  virtualId = positiveId(virtualId);
  targetId = positiveId(targetId);
  if (!['add_selected', 'replace_selected'].includes(action)) throw createError(400, 'Invalid virtual hadith action');
  const connection = await promisify(global.dbPool.getConnection).call(global.dbPool);
  const query = promisify(connection.query).bind(connection);
  try {
    await promisify(connection.beginTransaction).call(connection);
    // Serialize edits to one virtual book, including numbering allocation.
    const [book] = await query('SELECT b.id,b.alias,b.virtual FROM books b WHERE b.id=(SELECT bookId FROM hadiths_virtual WHERE id=?) FOR UPDATE', [virtualId]);
    if (!book || Number(book.virtual) !== 1) throw createError(404, 'Virtual hadith not found');
    const rows = await query('SELECT * FROM hadiths_virtual WHERE bookId=? ORDER BY ordinal,id FOR UPDATE', [book.id]);
    const current = rows.find(row => row.id === virtualId);
    if (!current) throw createError(404, 'Virtual hadith not found');
    const [target] = await query('SELECT h.id,h.num,b.alias,b.virtual,b.type FROM hadiths h JOIN books b ON b.id=h.bookId WHERE h.id=?', [targetId]);
    if (!target || target.alias === 'quran' || Number(target.virtual) === 1 || target.type !== 'hadith')
      throw createError(400, 'Select an original hadith');
    if (action === 'replace_selected' && current.hadithId === targetId) throw createError(409, 'This hadith is already selected');
    const affectedIds = [...new Set([targetId, current.hadithId, ...(action === 'add_selected' ? rows.filter(r => r.ordinal > current.ordinal).map(r => r.hadithId) : [])].filter(Boolean))].sort((a,b) => a-b);
    // Legacy virtual-row triggers overwrite books; preserve unrelated memberships.
    const originals = await query('SELECT id,books FROM hadiths WHERE id IN (?) ORDER BY id FOR UPDATE', [affectedIds]);
    const ref = `${target.alias}:${target.num}`;
    let id = virtualId;
    if (action === 'replace_selected') {
      await query('UPDATE hadiths_virtual SET hadithId=?,ref_num=?,bookActual=?,lastfixed=NOW(),lastmod_user=? WHERE id=?', [targetId, ref, target.alias, userId, virtualId]);
    } else {
      const used = new Set(rows.map(r => r.num));
      let suffix = 1, num;
      do { num = `${current.num}a${suffix === 1 ? '' : suffix}`; suffix++; } while (used.has(num));
      if (num.length > 15) throw createError(409, 'No available reference after this hadith');
      await query('UPDATE hadiths_virtual SET ordinal=ordinal+1, numInChapter=CASE WHEN tocId <=> ? THEN numInChapter+1 ELSE numInChapter END WHERE bookId=? AND ordinal>?', [current.tocId, book.id, current.ordinal]);
      const inserted = await query('INSERT INTO hadiths_virtual (bookId,tocId,ordinal,numInChapter,num,num0,hadithId,ref_num,bookActual,lastfixed,lastmod_user) VALUES (?,?,?,?,?,?,?,?,?,NOW(),?)', [book.id,current.tocId,Number(current.ordinal)+1,Number(current.numInChapter)+1,num,current.num0,targetId,ref,target.alias,userId]);
      id = inserted.insertId;
      if (current.tocId) await query(`UPDATE toc SET count=COALESCE(count,0)+1 WHERE bookId=? AND
        (id=? OR (level=1 AND h1 <=> ?) OR (level=2 AND h1 <=> ? AND h2 <=> ?))`,
        [book.id,current.tocId,current.h1,current.h1,current.h2]);
    }
    const linked = new Set((await query('SELECT DISTINCT hadithId FROM hadiths_virtual WHERE bookId=? AND hadithId IN (?)', [book.id, affectedIds])).map(r => r.hadithId));
    const token = `{${book.alias}}`;
    for (const original of originals) {
      let books = original.books || '';
      if (linked.has(original.id)) { if (!books.includes(token)) books += token; }
      else books = books.split(token).join('').trim();
      await query('UPDATE hadiths SET books=? WHERE id=? AND NOT (books <=> ?)', [books || null,original.id,books || null]);
    }
    await promisify(connection.commit).call(connection);
    return { id, bookId: book.id, alias: book.alias, hadithIds: [...new Set([current.hadithId,targetId].filter(Boolean))] };
  } catch (error) {
    await promisify(connection.rollback).call(connection);
    throw error;
  } finally { connection.release(); }
}
module.exports = { selectHadith };
