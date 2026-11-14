'use strict';

const Index = require('../lib/Index');
const Tafsir = require('../lib/Tafsir');

const book = { alias: 'en-easy-tajwid', source: 'local', surah_dir: 1 };
const introduction = '/quran/tafsir/easy-tajwid/introduction';

describe('reverse chapter order in the tafsir reader', () => {
  afterEach(() => jest.restoreAllMocks());

  test.each([undefined, introduction])('does not replace descending navigation with Quran wraparound (%s)', href => {
    global.surahs = [{ num: 114, ayahs: 6 }];
    expect(Tafsir.invocationBoundary([{ surah: 114, startAyah: 1, endAyah: 6 }], 114, 1, 1, href, book)).toBeNull();
    expect(Tafsir.invocationBoundary([{ surah: 1, startAyah: 1, endAyah: 7 }], 1, 1, -1, href, book)).toBeNull();
  });

  test('walks all 114 chapters descending and passages within each chapter ascending', async () => {
    const rows = Array.from({ length: 114 }, (_, i) => [
      { surah: 114 - i, ayahFrom: 1, ayahTo: 2 },
      { surah: 114 - i, ayahFrom: 3, ayahTo: 6 }
    ]).flat();
    jest.spyOn(Index, 'docsFromQuery').mockImplementation(async (_index, query, _offset, _size, sort) => {
      const [same, other] = query.bool.should;
      const surah = same.bool.filter[0].term.surah;
      const boundary = same.bool.filter[1].range;
      const forward = !!boundary.ayahFrom;
      expect(other).toEqual({ range: { surah: { [forward ? 'lt' : 'gt']: surah } } });
      expect(sort).toBe(forward ? 'surah DESC, ayahFrom ASC, ayahTo ASC' : 'surah ASC, ayahTo DESC, ayahFrom DESC');
      const candidates = rows.filter(row => forward
        ? row.surah < surah || row.surah === surah && row.ayahFrom > boundary.ayahFrom.gt
        : row.surah > surah || row.surah === surah && row.ayahTo < boundary.ayahTo.lt);
      return (forward ? candidates : candidates.reverse()).slice(0, 1);
    });
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const entries = [{ surah: row.surah, startAyah: row.ayahFrom, endAyah: row.ayahTo }];
      for (const direction of [1, -1]) {
        const expected = rows[i + direction];
        const actual = Tafsir.invocationBoundary(entries, row.surah, row.ayahFrom, direction, introduction, book)
          || await Tafsir.adjacentPassage(book, entries, direction);
        expect(actual).toEqual(expected ? { surah: expected.surah, ayah: expected.ayahFrom, endAyah: expected.ayahTo } : null);
      }
    }
  });
});
