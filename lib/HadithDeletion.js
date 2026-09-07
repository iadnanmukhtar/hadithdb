'use strict';

const { promisify } = require('util');
const createError = require('http-errors');

async function remove(id) {
  if (!/^[1-9]\d*$/.test(String(id)) || !Number.isSafeInteger(Number(id)))
    throw createError(400, 'Invalid hadith ID');
  id = Number(id);
  const connection = await promisify(global.dbPool.getConnection).call(global.dbPool);
  const query = promisify(connection.query).bind(connection);
  try {
    await promisify(connection.beginTransaction).call(connection);
    const [hadith] = await query(`SELECT h.*, b.alias, b.type, b.virtual FROM hadiths h
      JOIN books b ON b.id=h.bookId WHERE h.id=? FOR UPDATE`, [id]);
    if (!hadith) throw createError(404, 'Hadith not found');
    if (hadith.alias === 'quran' || Number(hadith.bookId) === 0 || Number(hadith.virtual) === 1 || (hadith.type && hadith.type !== 'hadith'))
      throw createError(400, 'Only original hadith records can be deleted here');
    const references = await query('SELECT id FROM hadiths_virtual WHERE hadithId=? LIMIT 1 FOR UPDATE', [id]);
    if (references.length)
      throw createError(409, 'Remove the virtual-book entries referencing this hadith before deleting it');
    // Outgoing links and owned metadata are removed by foreign-key cascades.
    await query('DELETE FROM hadiths_sim WHERE hadithId2=?', [id]);
    await query('DELETE FROM hadiths_sim_candidates WHERE hadithId2=?', [id]);
    await query('DELETE FROM hadiths WHERE id=?', [id]);
    await promisify(connection.commit).call(connection);
    return hadith;
  } catch (error) {
    await promisify(connection.rollback).call(connection);
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { remove };
