'use strict';

const Index = require('../lib/Index');
const Tafsir = require('../lib/Tafsir');

afterEach(() => jest.restoreAllMocks());

test('batches distinct references and preserves passage splitting and earliest English row selection', async () => {
  const refs = Array.from({length: 40}, (_, i) => '2:' + (i + 1));
  const search = jest.spyOn(Index, 'docsFromQueryFields').mockImplementation(async (_index, query) => {
    const asked = query.bool.should.map(clause => clause.bool.filter[1].range.ayahFrom.lte);
    expect(asked.length).toBeLessThanOrEqual(32);
    return [
      {id: 1, surah: 2, ayahFrom: 1, ayahTo: 1, text_en: ''},
      {id: 2, surah: 2, ayahFrom: 1, ayahTo: 2, text_en: 'First verse\n\nSecond verse'},
      {id: 3, surah: 2, ayahFrom: 2, ayahTo: 2, text_en: 'Later record'}
    ];
  });
  const html = await Tafsir.relatedTranslationHtml({alias:'sample'}, [...refs, '2:2']);
  expect(search).toHaveBeenCalledTimes(2);
  expect(html.get('2:1')).toContain('First verse');
  expect(html.get('2:2')).toContain('Second verse');
  expect(html.size).toBe(2);
});
