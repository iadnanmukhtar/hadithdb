'use strict';
const mysql = require('mysql');

// Hidden miscellaneous records are accessible only through a public alias.
async function referencedMiscBook(alias, num, books, query) {
  if (alias !== 'misc') return null;
  const book = books.find(book => book && book.alias === 'misc'
    && Number(book.hidden) === 1 && Number(book.virtual) === 0);
  if (!book) return null;
  const rows = await query(mysql.format(`SELECT h.id FROM hadiths h
    JOIN hadiths_virtual hv ON hv.hadithId=h.id
    JOIN books vb ON vb.id=hv.bookId
    WHERE h.bookId=? AND h.num=? AND vb.hidden=0 AND vb.\`virtual\`=1 LIMIT 1`, [book.id, num]));
  return rows.length ? book : null;
}

module.exports = { referencedMiscBook };
