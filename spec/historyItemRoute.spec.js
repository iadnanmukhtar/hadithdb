'use strict';

const fs = require('fs');
const vm = require('vm');
const Books = require('../lib/Books');
const Arabic = require('../lib/Arabic');

// Execute the actual reference handler with external data services stubbed.
const source = fs.readFileSync(require.resolve('../routes/search'), 'utf8');
const start = source.indexOf("router.get('/:bookAlias\\::num',");
const end = source.indexOf('\nasync function renderQuranAyahPassage', start);

test.each(['history', 'ibnhisham', 'another-history-book'])('%s references render one item regardless of link origin', async alias => {
  const book = { alias, type: 'sirah', properties: { reader: { referenceView: 'section' } } };
  const item = { id: 1, num: '1', ref: `${alias}:1`, book_alias: alias, doctype: 'sirah', book, title_en: 'Passage title' };
  let handler;
  const scope = vm.createContext({
    router: { get: (_path, callback) => { handler = callback; } },
    Books, Arabic, global: { books: [book] },
    visibleBookByAlias: value => Books.findByAlias(value, [book]),
    SirahReader: { sourceReference: jest.fn().mockResolvedValue(null) },
    redirectVirtualHadithReference: jest.fn().mockResolvedValue(false),
    Index: { docsFromKeyValue: jest.fn().mockResolvedValue([item]) },
    Item: class { constructor(row) { Object.assign(this, row); } },
    addVirtualReferences: jest.fn(),
    Hadith: { a_dbGetSimilarCandidates: jest.fn().mockResolvedValue([]) },
    HdithMetadata: { attachClassifications: jest.fn() }
  });
  expect(start).toBeGreaterThan(-1);
  vm.runInContext(source.slice(start, end), scope);
  for (const referer of ['/?q=history', '/history/1', '/bookmarks', '/community', undefined]) {
    const req = { params: { bookAlias: alias, num: '1' }, query: {}, headers: { referer } };
    const res = { locals: {}, redirect: jest.fn(), render: jest.fn() };
    const next = jest.fn();
    await handler(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
    expect(res.render).toHaveBeenCalledWith('search', expect.objectContaining({
      results: [expect.objectContaining({ ref: `${alias}:1`, single: true, title_en: 'Passage title' })]
    }));
  }
});
