'use strict';

const createError = require('http-errors');
const debug = require('./Debug')('hadithdb:VirtualHadithReader');

// A missing snapshot is not evidence that a chapter has no hadiths. Check the
// underlying links before allowing an empty result to reach the HTML cache.
async function getItems(heading, offset, limit) {
  const bookId = Number(heading.book.id);
  const level = Number(heading.level);
  if (!Number.isSafeInteger(bookId) || ![1, 2, 3].includes(level)
    || !Number.isSafeInteger(offset) || offset < 0
    || !Number.isSafeInteger(limit) || limit < 1)
    throw new TypeError('Invalid virtual hadith reader scope');
  const scope = [`book_id=${bookId}`];
  const sourceScope = [`t.bookId=${bookId}`];
  for (let i = 1; i <= level; i++) {
    const number = Number(heading[`h${i}`]);
    if (!Number.isFinite(number)) throw new TypeError('Invalid virtual hadith heading');
    scope.push(`h${i}=${number}`);
    sourceScope.push(`t.h${i}=${number}`);
  }
  const select = table => `SELECT * FROM ${table} WHERE ${scope.join(' AND ')} ORDER BY ordinal LIMIT ${offset},${limit}`;
  const items = await global.query(select('v_hadiths_virtual_snapshot'));
  if (items.length) return items;

  try {
    // Use the small source tables for genuinely empty headings and exhausted
    // pages; only an inconsistent snapshot needs the more expensive live view.
    const linked = await global.query(`SELECT hv.id FROM hadiths_virtual hv
      JOIN toc t ON t.id=hv.tocId JOIN hadiths h ON h.id=hv.hadithId
      WHERE ${sourceScope.join(' AND ')} LIMIT ${offset},1`);
    if (!linked.length) return items;
    const recovered = await global.query(select('v_hadiths_virtual'));
    if (recovered.length) {
      debug.info(`recovered missing snapshot rows for ${scope.join(' AND ')} offset=${offset}`);
      return recovered;
    }
    throw new Error('Linked source hadiths are missing from the virtual reader view');
  } catch (cause) {
    debug.error(`unable to recover virtual chapter: ${cause.message}`);
    // Propagate before the route renders or writes an empty success response.
    throw createError(503, 'Hadiths are temporarily unavailable. Please try again.', {
      code: 'VIRTUAL_SNAPSHOT_UNAVAILABLE',
      headers: { 'Cache-Control': 'no-store', 'Retry-After': '5' }
    });
  }
}

module.exports = { getItems };
