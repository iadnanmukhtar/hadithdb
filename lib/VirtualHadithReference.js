'use strict';
const Utils = require('./Utils');
const createError = require('http-errors');

async function getReference(book, num) {
  if (!book || book.virtual != 1)
    return [];

  var candidateNums = [num];
  if (/^\d+(?:\.\d+)?$/.test(num))
    candidateNums.push(`${num}a`);
  else if (/^\d+(?:\.\d+)?[a-z]$/i.test(num))
    candidateNums.push(num.replace(/[a-z]$/i, ''));
  candidateNums = Array.from(new Set(candidateNums));

  var conditions = candidateNums.map(candidate => `hv.num='${Utils.escSQL(candidate)}'`);
  var num0 = Number(num);
  if (Number.isFinite(num0))
    conditions.push(`hv.num0=${num0}`);
  var orderConditions = candidateNums.map((candidate, idx) => `WHEN hv.num='${Utils.escSQL(candidate)}' THEN ${idx}`);

  var rows = await global.query(`
	SELECT hv.id
    FROM hadiths_virtual hv
    JOIN hadiths h ON h.id = hv.hadithId
    WHERE hv.bookId=${book.id}
      AND (${conditions.join(' OR ')})
    ORDER BY CASE ${orderConditions.join(' ')} ELSE ${candidateNums.length} END, hv.num0, hv.id
    LIMIT 1`);
  if (rows.length < 1)
    return [];

  const id = Number(rows[0].id);
  let items = await global.query(`SELECT * FROM v_hadiths_virtual_snapshot WHERE hId=${id} AND book_id=${Number(book.id)}`);
  if (!items.length)
    items = await global.query(`SELECT * FROM v_hadiths_virtual WHERE hId=${id} AND book_id=${Number(book.id)}`);
  if (!items.length)
    throw createError(503, 'Hadiths are temporarily unavailable. Please try again.');

  // Resolve adjacent linked entries in the same order as the virtual reader.
  // Source numbers and insertion order must not control this navigation.
  const sequence = await global.query(`SELECT hv.id, hv.num
    FROM hadiths_virtual hv JOIN hadiths h ON h.id=hv.hadithId
    WHERE hv.bookId=${Number(book.id)} ORDER BY hv.num0, hv.ordinal, hv.id`);
  const position = sequence.findIndex(row => Number(row.id) === id);
  const item = items[0];
  item.ref = `${book.alias}:${item.num}`;
  item.prev_ref = position > 0 ? `${book.alias}:${sequence[position - 1].num}` : null;
  item.next_ref = position >= 0 && position + 1 < sequence.length ? `${book.alias}:${sequence[position + 1].num}` : null;
  return items;
}

module.exports = { getReference };
