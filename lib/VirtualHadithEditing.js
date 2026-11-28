'use strict';
const { promisify } = require('util');
const HadithDeletion = require('./HadithDeletion');
const createError = require('http-errors');

function positiveId(value) {
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value)))
    throw createError(400, 'Invalid hadith ID');
  return Number(value);
}

async function selectHadith(virtualId, targetId, action, userId, expectedOriginalId) {
  virtualId = positiveId(virtualId);
  targetId = positiveId(targetId);
  const deletePlaceholder = action === 'replace_delete';
  if (deletePlaceholder) expectedOriginalId = positiveId(expectedOriginalId);
  if (!['add_selected', 'replace_selected', 'replace_delete'].includes(action)) throw createError(400, 'Invalid virtual hadith action');
  const connection = await promisify(global.dbPool.getConnection).call(global.dbPool);
  const query = promisify(connection.query).bind(connection);
  try {
    await promisify(connection.beginTransaction).call(connection);
    // Serialize edits to one virtual book, including numbering allocation.
    const [book] = await query('SELECT b.id,b.alias,b.virtual FROM books b WHERE b.id=(SELECT bookId FROM hadiths_virtual WHERE id=?) FOR UPDATE', [virtualId]);
    if (!book || Number(book.virtual) !== 1) throw createError(404, 'Virtual hadith not found');
    const rows = await query('SELECT id,tocId,ordinal,numInChapter,num,num0,hadithId,h1,h2 FROM hadiths_virtual WHERE bookId=? ORDER BY ordinal,id FOR UPDATE', [book.id]);
    const current = rows.find(row => row.id === virtualId);
    if (!current) throw createError(404, 'Virtual hadith not found');
    const [target] = await query('SELECT h.id,h.num,b.alias,b.virtual,b.type FROM hadiths h JOIN books b ON b.id=h.bookId WHERE h.id=?', [targetId]);
    if (!target || target.alias === 'quran' || Number(target.virtual) === 1 || target.type !== 'hadith')
      throw createError(400, 'Select an original hadith');
    if (action !== 'add_selected' && current.hadithId === targetId) throw createError(409, 'This hadith is already selected');
    const affectedIds = [...new Set([targetId, current.hadithId, ...(action === 'add_selected' ? rows.filter(r => r.ordinal > current.ordinal).map(r => r.hadithId) : [])].filter(Boolean))].sort((a,b) => a-b);
    // Legacy virtual-row triggers overwrite books; preserve unrelated memberships.
    const originals = await query('SELECT id,books FROM hadiths WHERE id IN (?) ORDER BY id FOR UPDATE', [affectedIds]);
    const ref = `${target.alias}:${target.num}`;
    let id = virtualId;
    let deleted;
    if (deletePlaceholder) {
      if (current.hadithId !== expectedOriginalId)
        throw createError(409, 'This entry changed. Reload it before replacing its placeholder.');
      if (!originals.some(row => row.id === targetId)) throw createError(409, 'The replacement is no longer available.');
      const [source] = await query('SELECT h.num,b.alias FROM hadiths h JOIN books b ON b.id=h.bookId WHERE h.id=?', [expectedOriginalId]);
      if (source?.alias !== 'misc' || !source.num.startsWith(book.alias + '-') || target.alias === 'misc')
        throw createError(400, 'Choose a source hadith to replace this book’s Misc placeholder.');
      const shared = await query('SELECT id FROM hadiths_virtual WHERE hadithId=? AND id<>? LIMIT 1 FOR UPDATE', [expectedOriginalId, virtualId]);
      if (shared.length) throw createError(409, 'Another virtual entry uses this placeholder. Use Replace to keep it.');
    }
    if (action !== 'add_selected') {
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
    // Ordinal shifts fire membership triggers. Read their result in one batch
    // so unchanged memberships cost no individual database round trips.
    const storedBooks = new Map((await query('SELECT id,books FROM hadiths WHERE id IN (?)', [affectedIds]))
      .map(row => [row.id, row.books]));
    for (const original of originals) {
      let books = original.books || '';
      if (linked.has(original.id)) { if (!books.includes(token)) books += token; }
      else books = books.split(token).join('').trim();
      if (storedBooks.get(original.id) !== (books || null))
        await query('UPDATE hadiths SET books=? WHERE id=? AND NOT (books <=> ?)', [books || null,original.id,books || null]);
    }
    if (deletePlaceholder) {
      // The virtual-row trigger transfers linked notes. Move any additional
      // commentary owned directly by the placeholder, keeping its stable ID.
      await query('UPDATE hdith_hadith_sharh SET hadith_id=? WHERE hadith_id=?', [targetId, expectedOriginalId]);
      await query('UPDATE hadiths_sharh SET hadithId=? WHERE hadithId=?', [targetId, expectedOriginalId]);
      const grades = await query('SELECT id FROM hadiths_grades WHERE hadithId=? AND NOT (gradeId <=> -1 AND graderId <=> -1 AND comment IS NULL) LIMIT 1 FOR UPDATE', [expectedOriginalId]);
      if (grades.length) throw createError(409, 'The placeholder has a grading. Use Replace to keep it.');
      const attached = await query(`SELECT 1 FROM hadiths_commentary WHERE hadithId=?
        UNION ALL SELECT 1 FROM hadiths_comments WHERE hadithId=?
        UNION ALL SELECT 1 FROM hadiths_likes WHERE hadithId=? LIMIT 1`, [expectedOriginalId, expectedOriginalId, expectedOriginalId]);
      if (attached.length) throw createError(409, 'This placeholder has linked reader content. Use Replace to keep it.');
      await query('DELETE FROM hadiths_grades WHERE hadithId=?', [expectedOriginalId]);
      deleted = await HadithDeletion.removeInTransaction(query, expectedOriginalId);
      const bounds = await query('SELECT num,num0 FROM hadiths WHERE tocId=? ORDER BY ordinal,id FOR UPDATE', [deleted.tocId]);
      await query('UPDATE toc SET count=?,start=?,start0=?,`end`=?,end0=? WHERE id=?',
        [bounds.length,bounds[0]?.num ?? null,bounds[0]?.num0 ?? null,bounds.at(-1)?.num ?? null,bounds.at(-1)?.num0 ?? null,deleted.tocId]);
    }
    await promisify(connection.commit).call(connection);
    if (deleted) return { id, bookId: book.id, alias: book.alias, deleted, hadithIds: [targetId] };
    return { id, bookId: book.id, alias: book.alias, hadithIds: [...new Set([current.hadithId,targetId].filter(Boolean))] };
  } catch (error) {
    await promisify(connection.rollback).call(connection);
    if (deletePlaceholder && error.code === 'ER_DUP_ENTRY')
      throw createError(409, 'The replacement already has a conflicting commentary entry. Both records were preserved.');
    throw error;
  } finally { connection.release(); }
}
async function remove(virtualId) {
  virtualId = positiveId(virtualId);
  const connection = await promisify(global.dbPool.getConnection).call(global.dbPool);
  const query = promisify(connection.query).bind(connection);
  try {
    await promisify(connection.beginTransaction).call(connection);
    const [book] = await query('SELECT b.id,b.alias,b.virtual FROM books b WHERE b.id=(SELECT bookId FROM hadiths_virtual WHERE id=?) FOR UPDATE', [virtualId]);
    if (!book || Number(book.virtual) !== 1) throw createError(404, 'Virtual hadith not found');
    const [current] = await query('SELECT * FROM hadiths_virtual WHERE bookId=? AND id=? FOR UPDATE', [book.id, virtualId]);
    if (!current) throw createError(404, 'Virtual hadith not found');
    const [original] = await query('SELECT id,books FROM hadiths WHERE id=? FOR UPDATE', [current.hadithId]);
    await query('DELETE FROM hadiths_virtual WHERE bookId=? AND id=?', [book.id, virtualId]);
    // Gaps in ordinal are valid. Keep every surviving row's stable order and
    // chapter position; pooled queries must never depend on session variables.
    if (current.tocId) await query(`UPDATE toc SET count=GREATEST(COALESCE(count,0)-1,0) WHERE bookId=? AND
      (id=? OR (level=1 AND h1 <=> ?) OR (level=2 AND h1 <=> ? AND h2 <=> ?))`,
      [book.id,current.tocId,current.h1,current.h1,current.h2]);
    const remaining = await query('SELECT id FROM hadiths_virtual WHERE bookId=? AND hadithId=? LIMIT 1', [book.id,current.hadithId]);
    if (original) {
      const token = `{${book.alias}}`;
      const books = remaining.length ? original.books : (original.books || '').split(token).join('').trim() || null;
      await query('UPDATE hadiths SET books=? WHERE id=? AND NOT (books <=> ?)', [books,original.id,books]);
    }
    await promisify(connection.commit).call(connection);
    return { id: virtualId, bookId: book.id, alias: book.alias, hadithIds: [current.hadithId] };
  } catch (error) {
    await promisify(connection.rollback).call(connection);
    throw error;
  } finally { connection.release(); }
}
module.exports = { selectHadith, remove };
