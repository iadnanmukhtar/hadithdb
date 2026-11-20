'use strict';
const { promisify } = require('util');
const createError = require('http-errors');

const fields = ['shortName', 'shortName_en', 'name', 'name_en'];
async function list() {
  return global.query(`SELECT g.id,g.shortName,g.shortName_en,g.name,g.name_en,
    (SELECT COUNT(*) FROM hadiths h WHERE h.graderId=g.id) AS usage_count
    FROM graders g WHERE g.id>=0 ORDER BY g.shortName_en,g.id`);
}

async function save(idValue, input) {
  const creating = idValue === 'new';
  const id = Number(idValue);
  if (!creating && (!/^\d+$/.test(String(idValue)) || !Number.isSafeInteger(id)))
    throw createError(400, 'Invalid legacy grader ID');
  const values = Object.fromEntries(fields.map(field => [field, String(input?.[field] || '').trim()]));
  for (const field of ['shortName', 'shortName_en']) {
    if (!values[field] || [...values[field]].length > 45)
      throw createError(400, 'Arabic and English short names are required, with a maximum of 45 characters each');
  }
  for (const field of ['name', 'name_en']) {
    if (Buffer.byteLength(values[field], 'utf8') > 255)
      throw createError(400, 'A full name is too long for the legacy grader record (maximum 255 UTF-8 bytes)');
  }
  const connection = await promisify(global.dbPool.getConnection).call(global.dbPool);
  const query = promisify(connection.query).bind(connection);
  try {
    await promisify(connection.beginTransaction).call(connection);
    let previous = null;
    if (!creating) {
      const rows = await query('SELECT id,shortName,shortName_en FROM graders WHERE id=? FOR UPDATE', [id]);
      if (!rows.length) throw createError(404, 'Legacy grader not found');
      previous = rows[0];
    }
    // Existing duplicate labels may have been intentionally unified by a pair
    // merge. They must not prevent editing an otherwise unchanged record.
    const changed = ['shortName', 'shortName_en'].filter(field => creating || previous[field] !== values[field]);
    if (changed.length) {
      const duplicates = await query(`SELECT id FROM graders WHERE (${changed.map(field => `${field}=?`).join(' OR ')}) AND id<>? FOR UPDATE`,
        [...changed.map(field => values[field]), creating ? -1 : id]);
      if (duplicates.length) throw createError(409, 'A legacy grader already uses this short name. Edit that record instead');
    }
    const affected = creating ? [] : await query(`SELECT h.id AS hadith_id,b.alias FROM hadiths h
      JOIN books b ON b.id=h.bookId WHERE h.graderId=?`, [id]);
    const data = fields.map(field => values[field] || null);
    let savedId = id;
    if (creating) {
      const result = await query('INSERT INTO graders (shortName,shortName_en,name,name_en) VALUES (?,?,?,?)', data);
      savedId = result.insertId;
    } else {
      await query('UPDATE graders SET shortName=?,shortName_en=?,name=?,name_en=? WHERE id=?', [...data, id]);
    }
    await promisify(connection.commit).call(connection);
    return { id: savedId, ...values, type: 'legacy_grader',
      affected_hadith_ids: affected.map(row => Number(row.hadith_id)),
      affected_book_aliases: [...new Set(affected.map(row => row.alias))] };
  } catch (error) {
    await promisify(connection.rollback).call(connection);
    throw error;
  } finally { connection.release(); }
}
module.exports = { list, save };
