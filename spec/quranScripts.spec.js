'use strict';

const QuranScripts = require('../lib/QuranScripts');

describe('Quran script request normalization', () => {
  test.each([
    ['indo-pak', 'indo-pak'],
    ['WARSH', 'warsh'],
    ['uthmani', ''],
    ['../../warsh', '']
  ])('normalizes script %s', (value, expected) => {
    expect(QuranScripts.normalizeSlug(value)).toBe(expected);
  });

  test('deduplicates and bounds valid Quran references', () => {
    expect(QuranScripts.normalizeRefs('1:1,quran:1:1,2:255,0:1,115:1,2:999'))
      .toEqual(['1:1', '2:255']);
  });

  test('loads ayat from hadiths and tokens from quran_corpus tables', async () => {
    const originalQuery = global.query;
    global.query = jest.fn()
      .mockResolvedValueOnce([{ ref: '1:1', text: 'Warsh ayah' }])
      .mockResolvedValueOnce([
        { surah: 1, ayah: 1, word: 1, text: 'Warsh' },
        { surah: 1, ayah: 1, word: 2, text: 'word' }
      ]);
    try {
      const result = await QuranScripts.passage('warsh', ['1:1']);
      expect(global.query.mock.calls[0][0]).toContain('FROM hadiths h');
      expect(global.query.mock.calls[0][0]).toContain('h.body_warsh');
      expect(global.query.mock.calls[1][0]).toContain('FROM quran_corpus_script_words');
      expect(result.ayahsByRef).toEqual({ '1:1': 'Warsh ayah' });
      expect(result.wordsByAyah['1:1']).toHaveLength(2);
      expect(result.script).toEqual({ slug: 'warsh', name: 'Warsh', fontFamily: 'QuranWarsh' });
    } finally {
      global.query = originalQuery;
    }
  });
});
