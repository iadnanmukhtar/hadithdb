// @ts-check
'use strict';

const debug = require('./Debug')('hadithdb:VirtualHadithSnapshot');

var pendingBookIds = new Set();
var pendingHadithIds = new Set();
var pendingHeadingIds = new Set();
var scheduled = false;
var running = false;

function schedule() {
  if (scheduled)
    return;
  scheduled = true;
  setImmediate(processQueue);
}

function queueBook(bookId) {
  bookId = Number(bookId);
  if (!Number.isInteger(bookId))
    return;
  pendingBookIds.add(bookId);
  schedule();
}

function queueHadith(hadithId) {
  hadithId = Number(hadithId);
  if (!Number.isInteger(hadithId))
    return;
  pendingHadithIds.add(hadithId);
  schedule();
}

function queueHeading(headingId) {
  headingId = Number(headingId);
  if (!Number.isInteger(headingId))
    return;
  pendingHeadingIds.add(headingId);
  schedule();
}

async function processQueue() {
  scheduled = false;
  if (running)
    return;
  running = true;
  try {
    while (pendingBookIds.size || pendingHadithIds.size || pendingHeadingIds.size) {
      var bookIds = pendingBookIds;
      var hadithIds = pendingHadithIds;
      var headingIds = pendingHeadingIds;
      pendingBookIds = new Set();
      pendingHadithIds = new Set();
      pendingHeadingIds = new Set();

      await addBooksForHadiths(bookIds, hadithIds);
      await addBooksForHeadings(bookIds, headingIds);

      for (const bookId of bookIds) {
        debug(`refresh queued snapshot bookId=${bookId}`);
        await global.query(`CALL refresh_v_hadiths_virtual_snapshot(${bookId})`);
      }
    }
  } catch (err) {
    debug.error(`snapshot refresh failed: ${err.message}\n${err.stack || ''}`);
  } finally {
    running = false;
    if (pendingBookIds.size || pendingHadithIds.size || pendingHeadingIds.size)
      schedule();
  }
}

async function addBooksForHadiths(bookIds, hadithIds) {
  if (!hadithIds.size)
    return;
  var ids = Array.from(hadithIds).join(',');
  var rows = await global.query(`SELECT DISTINCT bookId FROM hadiths_virtual WHERE hadithId IN (${ids})`);
  for (const row of rows)
    bookIds.add(Number(row.bookId));
}

async function addBooksForHeadings(bookIds, headingIds) {
  if (!headingIds.size)
    return;
  var ids = Array.from(headingIds).join(',');
  var rows = await global.query(`SELECT DISTINCT book_id FROM v_toc WHERE book_virtual=1 AND hId IN (${ids})`);
  for (const row of rows)
    bookIds.add(Number(row.book_id));
}

module.exports = {
  queueBook,
  queueHadith,
  queueHeading
};
