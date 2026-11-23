'use strict';

const Tafsir = require('../lib/Tafsir');

test('the catalog and Quran contents share ordered English-accessible Tafsir highlights', () => {
  const rows = [
    { alias: 'recent', lang: 'en', published_year: 2020 },
    { alias: 'early', lang: 'ar', death: 300 },
    { alias: 'early', lang: 'en', death: 300 },
    { alias: 'arabic', lang: 'ar', death: 200 },
    { alias: 'later', lang: 'en', death: 400 },
    { alias: 'mokhtasar', lang: 'en' }
  ];
  const catalog = Tafsir.catalogOrder(rows);
  expect(catalog.map(book => book.alias)).toEqual(['mokhtasar', 'arabic', 'early', 'later', 'recent']);
  expect(Tafsir.englishHighlights(catalog).map(book => book.alias)).toEqual(['mokhtasar', 'early', 'later', 'recent']);
});
