'use strict';

const Mcp = require('../lib/HadithMcp');
const Index = require('../lib/Index');
const Mushaf = require('../lib/QuranMushaf');
const context = { baseUrls: { quran: 'https://quran.example', hadith: 'https://hadith.example' } };
function row(surah, section, start, count, subsection) {
  const level = subsection ? 3 : 2;
  return { h1: surah, h2: section, h3: subsection || 0, level,
    [`h${level}_start`]: `${surah}:${start}`, [`h${level}_count`]: count,
    [`h${level}_title_en`]: `Title ${surah}.${section}${subsection ? `.${subsection}` : ''}`,
    [`h${level}_title`]: null, [`h${level}_intro_en`]: 'Stored introduction', [`h${level}_intro`]: null };
}
function page(number, words) {
  return { number, info: { name: 'Test Mushaf', number_of_pages: 604, lines_per_page: 15 },
    lines: [{ line_type: 'ayah', words: words.map(([surah, ayah, word]) => ({ surah, ayah, word, is_ayah_marker: 0 })) }] };
}
const call = (name, args) => Mcp.callTool(name, args, context);

afterEach(() => jest.restoreAllMocks());

test('page includes continuing passages, cross-surah ranges, word boundaries and source-based overview', async () => {
  jest.spyOn(Mushaf, 'page').mockResolvedValue(page(50, [[2, 285, 3], [2, 285, 4], [2, 286, 1], [3, 1, 1]]));
  jest.spyOn(Index, 'docsFromQueryFields').mockResolvedValue([
    row(2, 10, 280, 7), row(2, 10, 284, 3, 2), row(3, 1, 1, 10), row(3, 2, 11, 5)
  ]);
  const result = await call('lookup_quran_page', { page: 50 });
  const data = result.structuredContent;
  expect(data.url).toBe('https://quran.example/quran/page/50');
  expect(data.ranges).toEqual([{ surah: 2, ayah_from: 285, ayah_to: 286 }, { surah: 3, ayah_from: 1, ayah_to: 1 }]);
  expect(data.ayahs[0]).toEqual({ reference: 'quran:2:285', surah: 2, ayah: 285, first_word: 3, last_word: 4 });
  expect(data.headings.map(h => h.key)).toEqual(['2.10', '2.10.2', '3.1']);
  expect(data.headings[0].ayah_from).toBe(280);
  expect(data.headings[0].title_arabic).toBeNull();
  expect(data.summary.kind).toBe('stored_heading_outline');
  expect(data.summary.text_arabic).toBeNull();
  expect(data.summary.text_english).toContain('quran:2:280-286: Title 2.10');
  expect(JSON.parse(result.content[0].text)).toEqual(data);
});

test('page lookup by ayah preserves the first-page lookup and page navigation boundaries', async () => {
  jest.spyOn(Mushaf, 'pageForRef').mockResolvedValue(1);
  jest.spyOn(Mushaf, 'page').mockResolvedValue(page(1, [[1, 1, 1]]));
  jest.spyOn(Index, 'docsFromQueryFields').mockResolvedValue([row(1, 1, 0, 8)]);
  const result = await call('lookup_quran_page', { surah: 1, ayah: 1 });
  expect(Mushaf.pageForRef).toHaveBeenCalledWith(1, 1);
  expect(result.structuredContent.previous_page).toBeNull();
  expect(result.structuredContent.headings[0].reference).toBe('quran:1:0-7');
});

test('lists bilingual source headings with pagination and explicit introduction truncation', async () => {
  const first = row(2, 1, 1, 5);
  first.h2_intro_en = 'x'.repeat(2000);
  jest.spyOn(Index, 'docsFromQueryFields').mockResolvedValue([first, row(2, 1, 1, 2, 1), row(2, 2, 6, 15)]);
  const result = await call('list_quran_sections', { surah: 2, limit: 1, response_profile: 'compact' });
  expect(result.structuredContent).toMatchObject({ total: 3, next_offset: 1, has_more: true });
  expect(result.structuredContent.headings[0].introduction_english).toHaveLength(1000);
  expect(result.structuredContent.headings[0].truncated).toBe(true);
  const full = await call('list_quran_sections', { surah: 2, response_profile: 'full' });
  expect(full.structuredContent.headings[0].introduction_english).toHaveLength(2000);
  const next = await call('list_quran_sections', { surah: 2, offset: 2, limit: 1 });
  expect(next.structuredContent).toMatchObject({ next_offset: null, has_more: false });
  expect(next.structuredContent.headings[0].key).toBe('2.2');
});

test('resolves containing passage by range, not by treating ayah as section number', async () => {
  jest.spyOn(Index, 'docsFromQueryFields').mockResolvedValue([row(2, 3, 6, 15), row(2, 3, 17, 4, 1)]);
  jest.spyOn(Mushaf, 'pageForRef').mockImplementation(async (surah, ayah, options) => options?.last ? 4 : 3);
  const result = await call('lookup_quran_passage', { surah: 2, ayah: 18 });
  expect(result.structuredContent).toMatchObject({ passage: { key: '2.3', reference: 'quran:2:6-20' }, first_page: 3, last_page: 4 });
  expect(result.structuredContent.subsections[0].key).toBe('2.3.1');
  expect(result.structuredContent.mushaf_url).toBe('https://quran.example/quran/page/3?ayah=2:6-20');
  expect(Mushaf.pageForRef).toHaveBeenCalledWith(2, 20, { last: true });
  const subsection = await call('lookup_quran_passage', { surah: 2, section: 3, subsection: 1 });
  expect(subsection.structuredContent).toMatchObject({ passage: { key: '2.3.1' }, parent: { key: '2.3' }, subsections: [] });
});

test.each([
  ['lookup_quran_page', {}], ['lookup_quran_page', { page: 605 }],
  ['lookup_quran_page', { page: 1, surah: 1, ayah: 1 }],
  ['lookup_quran_page', { page: 1, ayah: 1 }], ['lookup_quran_page', { surah: 1 }],
  ['lookup_quran_passage', { surah: 2 }],
  ['lookup_quran_passage', { surah: 2, section: 1, ayah: 1 }],
  ['lookup_quran_passage', { surah: 2, ayah: 1, subsection: 1 }],
  ['lookup_quran_passage', { surah: 2, ayah: 0 }], ['list_quran_sections', { surah: 115 }]
])('rejects malformed selectors for %s', async (name, args) => {
  const search = jest.spyOn(Index, 'docsFromQueryFields');
  await expect(call(name, args)).rejects.toThrow();
  expect(search).not.toHaveBeenCalled();
});

test('does not manufacture headings, summaries or a passage for absent source data', async () => {
  jest.spyOn(Index, 'docsFromQueryFields').mockResolvedValue([]);
  jest.spyOn(Mushaf, 'page').mockResolvedValue(page(604, [[114, 6, 1]]));
  const result = await call('lookup_quran_page', { page: 604 });
  expect(result.structuredContent).toMatchObject({ headings: [], summary: { text_english: null, text_arabic: null }, next_page: null });
  await expect(call('lookup_quran_passage', { surah: 114, section: 99 })).rejects.toThrow('not found');
});

test('Mushaf reference mapping keeps first and last page caches separate for split ayahs', async () => {
  const original = global.query;
  global.query = jest.fn().mockResolvedValueOnce([{ page_number: 10 }]).mockResolvedValueOnce([{ page_number: 11 }]);
  Mushaf.invalidateMappings();
  try {
    expect(await Mushaf.pageForRef(2, 50)).toBe(10);
    expect(await Mushaf.pageForRef(2, 50, { last: true })).toBe(11);
    expect(await Mushaf.pageForRef(2, 50)).toBe(10);
    expect(global.query).toHaveBeenCalledTimes(2);
    expect(global.query.mock.calls[0][0]).toContain('page.page_number ASC');
    expect(global.query.mock.calls[1][0]).toContain('page.page_number DESC');
  } finally { global.query = original; Mushaf.invalidateMappings(); }
});
