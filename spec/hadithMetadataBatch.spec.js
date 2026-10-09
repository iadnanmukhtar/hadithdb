'use strict';
const Metadata = require('../lib/HdithMetadata');
const Pairs = require('../lib/HadithBilingualPairs');
const Downloads = require('../lib/BookDownloads');

afterEach(() => jest.restoreAllMocks());

test('metadata loading uses five data queries for a batch and keeps records isolated', async () => {
  const previous = global.query;
  jest.spyOn(Pairs, 'managed').mockResolvedValue([]);
  global.query = jest.fn(async sql => {
    if (sql.includes('SELECT h.id AS hadith_id')) return [{ hadith_id: 1 }, { hadith_id: 2 }];
    if (sql.includes('SELECT hn.hadith_id')) return [{ hadith_id: 1, id: 10, name: 'First', reliability: 'ثقة', death_text: '100' }];
    if (sql.includes('SELECT hadith_id, link_type')) return [{ hadith_id: 2, link_type: 'similar', internal_ref: 'muslim:2' }];
    if (sql.includes('SELECT hs.hadith_id')) return [{ hadith_id: 2, id: 20, title: 'Sharh', text: 'Explanation' }];
    if (sql.includes('SELECT hg.hadith_id')) return [{ hadith_id: 1, grade: 'صحيح', grader: 'Author' }];
    return [];
  });
  try {
    const records = await Metadata.forHadiths([1, 2, 1]);
    const selects = global.query.mock.calls.map(([sql]) => sql).filter(sql => /SELECT (h.id AS|hn.hadith_id|hadith_id, link_type|hs.hadith_id|hg.hadith_id)/.test(sql));
    expect(selects).toHaveLength(5);
    expect(selects.every(sql => sql.includes('IN (1,2)'))).toBe(true);
    expect(records.get(1).narrators[0]).toMatchObject({ name: 'First', reliability: 'ثقة' });
    expect(records.get(1).sharh).toEqual([]);
    expect(records.get(2).narrators).toEqual([]);
    expect(records.get(2).sharh[0].text).toBe('Explanation');
    expect(records.get(2).similar[0].internal_ref).toBe('muslim:2');
    expect(records.get(1).grades).toHaveLength(1);
    expect(records.get(2).grades).toEqual([]);
  } finally { global.query = previous; }
});

test('a thousand-record export uses five bounded batch loads instead of a thousand detail loads', async () => {
  const batch = jest.spyOn(Metadata, 'forHadiths').mockResolvedValue(new Map());
  const single = jest.spyOn(Metadata, 'forHadith');
  const rows = Array.from({ length: 1000 }, (_, i) => ({ hId: i + 1, book_id: 1, book_alias: 'adab' }));
  await Downloads.attachResearchMetadata(rows);
  expect(batch).toHaveBeenCalledTimes(5);
  expect(batch.mock.calls.every(([ids]) => ids.length === 200)).toBe(true);
  expect(single).not.toHaveBeenCalled();
});
