'use strict';

const QuranMushaf = require('../lib/QuranMushaf');
const Tafsir = require('../lib/Tafsir');

describe('Quran in-memory cache invalidation', () => {
  afterEach(() => {
    QuranMushaf.invalidateAll();
    Tafsir.invalidateMemoryCaches();
    delete global.query;
  });

  test('reloads a Mushaf page after targeted invalidation', async () => {
    var pageLineQueries = 0;
    global.query = jest.fn(async query => {
      if (query.includes('FROM quran_mushaf_info'))
        return [{ id: 1, number_of_pages: 604, lines_per_page: 15 }];
      if (query.includes('FROM quran_mushaf_pages') && query.includes('ORDER BY line_number') && !query.includes('JOIN')) {
        pageLineQueries++;
        return [{ page_number: 1, line_number: 1, line_type: 'ayah', first_word_id: 1, last_word_id: 1 }];
      }
      if (query.includes('JOIN quran_mushaf_words map'))
        return [{ line_number: 1, global_word_id: 1, surah: 1, ayah: 1, word: 1, text: 'بسم', is_ayah_marker: 0 }];
      return [];
    });

    await QuranMushaf.page(1);
    await QuranMushaf.page(1);
    expect(pageLineQueries).toBe(1);

    QuranMushaf.invalidatePage(1);
    await QuranMushaf.page(1);
    expect(pageLineQueries).toBe(2);
  });

  test('clears only the selected Tafsir first-passage entries when scoped', () => {
    global.tafsirCarouselBooks = [{ alias: 'mokhtasar' }];
    global.tafsirFirstPassages = new Map([
      ['mokhtasar:0', Promise.resolve({ surah: 1, ayah: 1 })],
      ['ibn-kathir:0', Promise.resolve({ surah: 1, ayah: 1 })]
    ]);

    Tafsir.invalidateMemoryCaches('mokhtasar');

    expect(global.tafsirCarouselBooks).toBeNull();
    expect(global.tafsirFirstPassages.has('mokhtasar:0')).toBe(false);
    expect(global.tafsirFirstPassages.has('ibn-kathir:0')).toBe(true);
  });
});
