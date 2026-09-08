'use strict';
const Utils = require('./Utils');

function adjacentHeadings(rows, current, book) {
 const sectionChapters = new Set(rows.filter(row => Number(row.level) === 2).map(row => Number(row.h1)));
 const pages = rows.filter(row => Number(row.level) === 2 || (Number(row.level) === 1 && (!sectionChapters.has(Number(row.h1)) || Number(row.direct_count) > 0)))
  .sort((a,b) => Number(a.h1)-Number(b.h1) || Number(a.h2 || 0)-Number(b.h2 || 0));
 const index = pages.findIndex(row => Number(row.h1) === Number(current.h1) && Number(row.h2 || 0) === Number(current.h2 || 0));
 if (index < 0) return null;
 const heading = row => row ? { ...row, book, path: [book.alias, Utils.formatHadithHeadingNumber(row.h1), ...(Number(row.level) === 2 ? [Utils.formatHadithHeadingNumber(row.h2)] : [])].join('/') } : null;
 return { prev: heading(pages[index-1]), next: heading(pages[index+1]) };
}

async function attachNavigation(heading) {
 const book = heading && heading.book;
 if (!book || book.type !== 'sirah') return;
 const rows = await global.query(`SELECT t.id, t.level, t.h1, t.h2, (SELECT COUNT(*) FROM hadiths h WHERE h.tocId=t.id) AS direct_count FROM toc t WHERE t.bookId=${Number(book.id)} AND level IN (1,2) ORDER BY h1,h2`);
 const adjacent = adjacentHeadings(rows, heading, book);
 if (adjacent) { heading.prev = adjacent.prev; heading.next = adjacent.next; }
}
async function prepareChapter(chapter) {
 if (!chapter || !chapter.book || chapter.book.type !== 'sirah') return;
 const [row] = await global.query(`SELECT COUNT(*) AS count FROM hadiths WHERE tocId=${Number(chapter.id)}`);
 chapter.sirahChapterOpeningOnly = Number(row.count) > 0;
}
async function sourceReference(book, number) {
 if (!book || book.alias !== 'ibnhisham' || book.type !== 'sirah' || !/^\d{6,}$/.test(String(number))) return null;
 const [row] = await global.query(`SELECT h.num FROM sirah_source_entries s JOIN hadiths h ON h.id=s.item_id AND h.bookId=s.book_id WHERE s.book_id=${Number(book.id)} AND s.source_entry_id=${Number(number)} LIMIT 1`);
 return row && String(row.num) !== String(number) ? String(row.num) : null;
}
module.exports = { adjacentHeadings, attachNavigation, prepareChapter, sourceReference };
