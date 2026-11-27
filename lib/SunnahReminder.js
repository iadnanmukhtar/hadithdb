'use strict';

const mysql = require('mysql');

function choose(rows, options, day) {
  if (!rows.length) return null;
  const current = options.day === String(day)
    ? rows.findIndex(row => String(row.hId) === options.id) : -1;
  let index = current < 0 ? day % rows.length : current;
  if (options.another && rows.length > 1)
    index = (index + 1 + Math.floor(Math.random() * (rows.length - 1))) % rows.length;
  return rows[index];
}

let daily;
function get(options) {
  const day = Math.floor((Date.now() - 5 * 3600000) / 86400000);
  if (options.another || options.day === String(day) && options.id) return selectReminder(options, day);
  const generation = require('./RuntimeRefresh').seenGeneration;
  if (!daily || daily.day !== day || daily.generation !== generation || daily.expires <= Date.now()) {
    const entry = { day, generation, expires: Date.now() + 60000 };
    entry.result = selectReminder({}, day).catch(error => {
      if (daily === entry) daily = null;
      throw error;
    });
    daily = entry;
  }
  return daily.result;
}

async function selectReminder(options, day) {
  const eligible = await global.query(`SELECT hId, book_alias FROM v_hadiths_virtual_snapshot
    WHERE book_alias IN ('mujtaba', 'adhkar', 'yawm-laylah') AND TRIM(body)<>'' AND TRIM(body_en)<>''
    ORDER BY SHA2(CONCAT('sunnah-daily:', hId), 256), hId`);
  const selected = choose(eligible, options, day);
  if (!selected) return null;
  const [row] = await global.query(mysql.format(`SELECT num, body, body_en, book_alias AS alias, book_shortName_en AS bookName FROM v_hadiths_virtual_snapshot
    WHERE book_alias=? AND hId=? LIMIT 1`, [selected.book_alias, selected.hId]));
  return row && { ...row, id: String(selected.hId), day, more: eligible.length > 1 };
}

module.exports = { choose, get };
