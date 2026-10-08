'use strict';

const BookDownloads = require('../lib/BookDownloads');
const HdithMetadata = require('../lib/HdithMetadata');

afterEach(() => jest.restoreAllMocks());

test('JSON book items retain all research opinions, narrators, references and full commentary texts', async () => {
  const grades = Array.from({ length: 12 }, (_, ordinal) => ({ ordinal, grader: ordinal === 0 ? 'أبو حاتم' : `Grader ${ordinal}`, grade: 'صحيح' }));
  const narrators = Array.from({ length: 22 }, (_, id) => ({ id, name: 'Narrator', reliability: 'ثقة', death_text: '179 هـ' }));
  const text = 'Commentary '.repeat(1000);
  const sharh = Array.from({ length: 7 }, (_, id) => ({ id: id + 1, source_title: 'Sharh', author: 'Author', text, text_en: text }));
  const lookup = jest.spyOn(HdithMetadata, 'forHadith').mockResolvedValue({ grades, narrators, sharh,
    similar: [{ internal_ref: 'muslim:1a', label: 'Narration text' }],
    takhrij: [{ internal_ref: 'muslim:1a' }, { internal_ref: 'abudawud:2' }]
  });
  const rows = [{ hId: 100, hId_ref: 7, book_virtual: 1, book_id: 42, book_alias: 'sample', ref: 'sample:1', num: '1',
    grade_grade: 'حسن', grader_shortName: 'البوصيري' }];
  await BookDownloads.attachResearchMetadata(rows);
  expect(lookup).toHaveBeenCalledWith(7);
  const document = BookDownloads.buildBookDocument({ id: 42, alias: 'sample', type: 'hadith' }, rows);
  const item = document.chapters[0].items[0];
  expect(item.metadata.grades).toHaveLength(13);
  expect(item.metadata.grades).toEqual(expect.arrayContaining([expect.objectContaining({ grader: 'البوصيري', grade: 'حسن' })]));
  expect(item.metadata.narrators).toHaveLength(22);
  expect(item.metadata.narrators[0]).toMatchObject(narrators[0]);
  expect(item.metadata.related_reports).toEqual(['muslim:1a', 'abudawud:2']);
  expect(item.metadata.sharh).toHaveLength(7);
  expect(item.metadata.sharh[0]).toMatchObject({ id: 1, text_arabic: text, text_english: text });
  expect(item.ref).toBe('sample:1');
});

test('metadata hydration reuses underlying identities and skips Quran and commentary rows', async () => {
  const lookup = jest.spyOn(HdithMetadata, 'forHadith').mockResolvedValue(null);
  const rows = [
    { hId: 7, book_id: 1, book_alias: 'sample' },
    { hId: 101, hId_ref: 7, book_id: 42, book_alias: 'virtual' },
    { hId: 8, book_id: 0, book_alias: 'quran' },
    { hId: 9, book_id: 2, commentary_type: 'tafsir' }
  ];
  await BookDownloads.attachResearchMetadata(rows);
  expect(lookup).toHaveBeenCalledTimes(1);
  expect(rows[0].hdithMetadata.grades).toEqual([]);
  expect(rows[2]).not.toHaveProperty('hdithMetadata');
  expect(rows[3]).not.toHaveProperty('hdithMetadata');
});
