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

async function get(options) {
  const day = Math.floor((Date.now() - 5 * 3600000) / 86400000);
  const eligible = await global.query(`SELECT hId FROM v_hadiths_virtual_snapshot
    WHERE book_id=100429 AND TRIM(body)<>'' AND TRIM(body_en)<>''
    ORDER BY SHA2(CONCAT('mujtaba-daily:', hId), 256), hId`);
  const selected = choose(eligible, options, day);
  if (!selected) return null;
  const [row] = await global.query(mysql.format(`SELECT num, body, body_en FROM v_hadiths_virtual_snapshot
    WHERE book_id=100429 AND hId=? LIMIT 1`, [selected.hId]));
  return row && { ...row, id: String(selected.hId), day, more: eligible.length > 1 };
}

module.exports = { choose, get };
