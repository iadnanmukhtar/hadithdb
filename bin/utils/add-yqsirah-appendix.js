#!/usr/bin/env node
'use strict';
// Editorial appendix: deliberately separate from the original PDF import.
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { promisify } = require('util');
const bookId = 100427;
const titles = [
  'Sunni beliefs regarding the Companions of Prophet Muhammad ﷺ',
  'Who counts as a Companion?',
  'The Companions were not all of one rank',
  'Twelve historical groups in al-Hakim’s classification',
  'How many Companions were there?',
  'Seven Quranic passages in the lecture',
  'Five hadiths and a Companion’s statement',
  'Trustworthiness does not mean infallibility',
  'Disagreement, speech, and the limits of judgment',
  'A question about al-Fatihah'
];
async function main() {
  const db = require('mysql').createConnection(require(path.join(require('os').homedir(), '.hadithdb/settings.json')).mysql.connection);
  const q = promisify(db.query).bind(db);
  const plain = value => JSON.parse(JSON.stringify(value));
  try {
    await q('START TRANSACTION');
    const books = await q('SELECT * FROM books WHERE id=? FOR UPDATE', [bookId]);
    assert.equal(books[0].alias, 'yqsirah');
    const toc = plain(await q('SELECT * FROM toc WHERE bookId=? ORDER BY ordinal FOR UPDATE', [bookId]));
    const items = plain(await q('SELECT * FROM hadiths WHERE bookId=? ORDER BY ordinal FOR UPDATE', [bookId]));
    const existing = toc.filter(t => Number(t.h1) === 54);
    if (existing.length) {
      assert.deepEqual(existing.map(t => t.title_en), ['Appendix', ...titles]);
      assert.equal(items.filter(t => Number(t.h1) === 54).length, 10);
      await q('ROLLBACK');
      console.log('Appendix already exists; no changes.');
      return;
    }
    assert.equal(Math.max(...toc.map(t => t.h1)), 53);
    assert.equal(items.at(-1).num, '1023');
    assert.equal(toc.at(-1).ordinal, 1076);
    if (!process.argv.includes('--apply')) {
      await q('ROLLBACK');
      console.log('Dry run: append 11 headings and 10 placeholder passages (1024–1033).');
      return;
    }
    const dir = path.resolve('var/imports/yqsirah/appendix');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `before-${Date.now()}.json`), JSON.stringify({ books, toc, items }), { mode: 0o600 });
    await q('INSERT INTO toc SET ?', { bookId, ordinal:1077, level:1, h1:54, title_en:'Appendix', start:'1024', end:'1033', start0:1024, end0:1033, count:10 });
    for (let i = 0; i < titles.length; i++) {
      const num = 1024 + i, end = i ? num : 1033;
      const heading = await q('INSERT INTO toc SET ?', { bookId, ordinal:1078+i, level:i ? 3 : 2, h1:54, h2:1, h3:i || null, title_en:titles[i], start:String(num), end:String(end), start0:num, end0:end, count:i ? 1 : 10 });
      await q('INSERT INTO hadiths SET ?', { bookId, ordinal:num, tocId:heading.insertId, h1:54, h2:1, h3:i || null, num:String(num), num0:num, numInChapter:i+1, title_en:titles[i], body_en:'Content to be added.', text_en:'Content to be added.', footnote_en:'', available_translation_languages:JSON.stringify(['en']) });
    }
    assert.deepEqual(plain(await q('SELECT * FROM toc WHERE bookId=? AND h1<54 ORDER BY ordinal', [bookId])), toc);
    assert.deepEqual(plain(await q('SELECT * FROM hadiths WHERE bookId=? AND h1<54 ORDER BY ordinal', [bookId])), items);
    const added = await q('SELECT * FROM hadiths WHERE bookId=? AND h1=54 ORDER BY ordinal', [bookId]);
    assert.deepEqual(added.map(t => t.title_en), titles);
    assert(added.every(t => t.body_en === 'Content to be added.' && !t.body));
    await q('UPDATE books SET content_lastmod=NOW() WHERE id=?', [bookId]);
    await q('COMMIT');
    console.log('Created chapter 54: 11 headings, 10 placeholder passages. Existing content unchanged.');
  } catch (error) {
    await q('ROLLBACK');
    throw error;
  } finally { db.destroy(); }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { titles };
