'use strict';
const fs = require('fs');
const ejs = require('ejs');
const header = fs.readFileSync(require('path').join(__dirname, '../views/sub-views/header.ejs'), 'utf8');
function context(book, overrides = {}) {
  const block = header.slice(header.indexOf('<%'), header.indexOf('%>') + 2);
  return JSON.parse(ejs.render(block + '<%- JSON.stringify({ aliases: hadithSearchBookAliases, commentary: quranSearchCommentaryAliases, placeholder: headerSearchPlaceholder, quran: !!(isQuranArea || quranSearchCommentaryBook) }) %>', {
    req: { originalUrl: '/test-book', query: {} }, page: { context: { book } },
    site: {}, utils: { quranUrl: () => '/quran', urlFor: (_, p) => p, hadithBaseUrl: () => '/', quranReaderBar: () => null },
    Tafsir: { tafsirSlug: alias => alias }, ...overrides
  }));
}
describe('book context search defaults', () => {
  test.each(['hadith', 'sharh', 'sirah', 'history'])('%s book supplies its own filter shortcut', type => {
    expect(context({ alias: 'test-book', type, shortName_en: 'Short Name' })).toEqual({ aliases: ['test-book'], commentary: [], placeholder: 'Search the library', quran: false });
  });
  test.each(['tafsir', 'trans'])('%s book supplies its commentary shortcut', type => {
    expect(context({ alias: 'test-book', type, shortName_en: 'Short Name' })).toEqual({ aliases: [], commentary: ['test-book'], placeholder: 'Search the library', quran: true });
  });
  test('Sharh reader searches the explanation instead of the original hadith book', () => {
    const source = { alias: 'bukhari', type: 'hadith' };
    expect(context(source, { book: { alias: 'fath', type: 'sharh', shortName_en: 'Fath' }, page: { menu: 'Sharh', context: { book: source } } }).aliases).toEqual(['fath']);
  });
  test('Sharh TOC selects its book even without navigation context', () => {
    expect(context(null, { sharhBook: { alias: 'fath', type: 'sharh', shortName_en: 'Fath' } }).aliases).toEqual(['fath']);
  });
  test('results preserve explicit filters instead of reinstating book defaults', () => {
    expect(context(null, { page: { context: { fromSearch: true, book: { alias: 'bukhari' } } }, b: ['riyad'] })).toEqual({ aliases: ['riyad'], commentary: [], placeholder: 'Search the library', quran: false });
  });
});
