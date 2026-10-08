'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '../routes/search.js'), 'utf8');
const start = source.indexOf('// BOOK: TABLE OF CONTENTS');
const route = source.slice(start, source.indexOf('    var prevBook = null;', start));

// Exercise the dispatch before chapter-index loading, using the actual handler.
async function dispatch(query) {
  let handler;
  const sendHadithBook = jest.fn().mockResolvedValue('whole-book');
  const book = { id: 1, alias: 'adab', hidden: 0, type: 'hadith' };
  vm.runInNewContext(`${route}\n} });`, {
    router: { get: (_path, fn) => { handler = fn; } },
    global: { books: [book] }, visibleBookFromParam: () => book,
    BookDownloads: { sendHadithBook }
  });
  const req = { params: { bookAlias: 'adab' }, query };
  const res = { locals: {} };
  const next = jest.fn();
  await handler(req, res, next);
  return { req, res, next, sendHadithBook };
}

test.each([{ json: '' }, { download: '', json: '' }, { json: '', flush: '1' }])('book JSON delegates to the enriched exporter: %j', async query => {
  const { req, res, next, sendHadithBook } = await dispatch(query);
  expect(req.params.format).toBe('json');
  expect(sendHadithBook).toHaveBeenCalledWith(req, res, next);
  expect(req.query).toEqual(query);
});

test('EPUB downloads retain the EPUB exporter', async () => {
  const { req, sendHadithBook } = await dispatch({ download: '', epub: '' });
  expect(req.params.format).toBe('epub');
  expect(sendHadithBook).toHaveBeenCalledTimes(1);
});
