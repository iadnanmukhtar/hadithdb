'use strict';
const Mcp = require('../lib/HadithMcp');
const Research = require('../lib/HadithMcpResearch');
const axios = require('axios');
const indexed = rows => ({ data: { hits: { total: { value: rows.length }, hits: rows.map(_source => ({ _source })) } } });
const context = { baseUrls: { hadith: 'https://hadith.example', quran: 'https://quran.example' } };
const commentary = (id, work, ref = 'bukhari:1166') => ({ id, doctype: 'sharh', bookId: work, commentary_alias: `work-${work}`, commentary_name: `شرح ${work}`, commentary_name_en: `Work ${work}`, commentary_author_en: `Author ${work}`, ref, book_alias: ref.split(':')[0], text: 'شرح الاستخارة', text_en: 'Explanation of istikharah' });
const result = data => ({ structuredContent: data, content: [] });
let previousBooks;
beforeEach(() => { global.settings ||= {}; global.settings.search ||= { domain: 'https://search.example' }; previousBooks = global.books; global.books = [{ id: 1, alias: 'work-1', type: 'sharh', title: 'شرح', title_en: 'Commentary', author_en: 'Author' }]; });
afterEach(() => { global.books = previousBooks; jest.restoreAllMocks(); });

test('compact inventory reveals attached works without inventing internal report identities', () => {
  const inventory = Research.inventory({ sharh: [
    { id: 1, source_id: 1, source_title: 'One', sharh_book: global.books[0] },
    { id: 2, source_id: 1, source_title: 'One', sharh_book: global.books[0] },
    { id: 3, source_id: 2, source_title: 'Two' }
  ], takhrij: [{ source_num: '123', source_book_id: 1 }, { internal_ref: 'abudawud:1538', label: 'Parallel wording' }] }, 'bukhari:1166');
  expect(inventory).toMatchObject({ commentary_entry_count: 3, commentary_work_count: 2, commentary_text_included: false });
  expect(inventory.commentaries[0].source).toMatchObject({ alias: 'work-1', title_english: 'Commentary' });
  expect(inventory.related_reports).toEqual([{ reference: 'abudawud:1538', relationship: 'takhrij', label: 'Parallel wording' }]);
  expect(Research.inventory(undefined, 'bukhari:1').commentary_status).toBe('unavailable');
});

test('commentary search filters the actual index by report and stable work ID', async () => {
  const search = jest.spyOn(axios, 'post').mockResolvedValue(indexed([commentary(5, 1)]));
  const response = await Mcp.callTool('search_hadith_commentary', { query: 'الاستخارة', source: 'work-1', reference: 'bukhari:1166' }, context);
  expect(search.mock.calls[0][0]).toContain('/sharhs/_search');
  expect(search.mock.calls[0][1].query.bool.filter).toEqual([{ term: { ref: 'bukhari:1166' } }, { term: { bookId: 1 } }]);
  expect(response.structuredContent.results[0]).toMatchObject({ id: 5, hadith_reference: 'bukhari:1166', source: { id: 1, alias: 'work-1' }, hadith_collection: 'bukhari' });
  expect(response.structuredContent.pagination.has_more).toBe(false);
});

test('exact commentary preserves full text when requested and bounds the default', async () => {
  jest.spyOn(axios, 'post').mockResolvedValue(indexed([{ ...commentary(5, 1), text: 'ع'.repeat(7000), text_en: null }]));
  const normal = await Mcp.callTool('lookup_hadith_commentary', { id: 5 }, context);
  expect(normal.structuredContent.commentary).toMatchObject({ truncated: true, text_english: null });
  expect(normal.structuredContent.commentary.text_arabic).toHaveLength(6000);
  const full = await Mcp.callTool('lookup_hadith_commentary', { id: 5, response_profile: 'full' }, context);
  expect(full.structuredContent.commentary.text_arabic).toHaveLength(7000);
  expect(full.structuredContent.commentary.truncated).toBe(false);
});

test('catalog discovery preserves commentary identity and paginates', async () => {
  global.books.push({ id: 2, type: 'sharh', alias: 'work-2', title_en: 'Second' }, { id: 3, type: 'hadith', alias: 'bukhari' });
  const first = await Mcp.callTool('list_hadith_commentaries', { limit: 1 }, context);
  expect(first.structuredContent).toMatchObject({ total: 2, next_offset: 1 });
  const next = await Mcp.callTool('list_hadith_commentaries', { offset: 1 }, context);
  expect(next.structuredContent.sources.map(x => x.alias)).toEqual(['work-2']);
  await expect(Mcp.callTool('search_hadith_commentary', { query: 'x', source: 'absent' }, context)).rejects.toThrow('Unknown commentary');
});

function researchCaller() {
  return jest.fn(async (tool, args) => {
    if (tool === 'lookup_quran_ayah') return result({ ayah: { reference: `quran:${args.surah}:${args.ayah}`, text_arabic: 'آية', text_english: 'Verse' } });
    if (tool === 'lookup_tafsir') return result({ source: { alias: args.tafsir }, reference: `${args.surah}:${args.ayah}`, commentary: [{ text_arabic: 'تفسير', truncated: false }] });
    if (tool === 'search_hadith') return result({ results: [{ reference: 'bukhari:1166', book: { alias: 'bukhari' } }, { reference: 'tirmidhi:480', book: { alias: 'tirmidhi' } }] });
    if (tool === 'search_hadith_commentary') return result({ results: [
      { id: 1, source: { id: 10 }, hadith_reference: 'bukhari:1166', hadith_collection: 'bukhari' },
      { id: 2, source: { id: 10 }, hadith_reference: 'bukhari:1166', hadith_collection: 'bukhari' },
      { id: 3, source: { id: 20 }, hadith_reference: 'tirmidhi:480', hadith_collection: 'tirmidhi' }
    ] });
    if (tool === 'lookup_hadith_detail') return result({ records: [{ reference: args.reference, grade: { english: 'Sound', grader_english: 'Named grader' }, research_inventory: { commentaries: [], related_reports: args.reference === 'bukhari:1166' ? [{ reference: 'abudawud:1538', relationship: 'takhrij' }] : [] } }] });
    if (tool === 'lookup_hadith_commentary') return result({ commentary: { id: args.id, source: { id: args.id === 3 ? 20 : 10 }, text_arabic: 'شرح' } });
    return result({ results: [] });
  });
}

test('initial istikharah question retrieves reports, distinct shuruh and verified parallel links', async () => {
  const call = researchCaller();
  const dossier = await Research.research('research_islamic_topic', { question: 'What is istikharah and how do I pray it?', queries: ['الاستخارة', 'istikharah'], depth: 'standard' }, context, call);
  expect(call).toHaveBeenCalledWith('lookup_hadith_detail', expect.objectContaining({ reference: 'abudawud:1538' }), expect.any(Object));
  const lookups = dossier.evidence.filter(x => x.tool === 'lookup_hadith_commentary');
  expect(lookups.map(x => x.arguments.id).slice(0, 2)).toEqual([1, 3]);
  expect(dossier.coverage).toMatchObject({ exhaustive: false, hadith_commentary: 'found', concept_research: 'found' });
  expect(dossier.evidence.find(x => x.tool === 'search_tafsir').status).toBe('searched_no_match');
  expect(dossier.evidence.find(x => x.tool === 'lookup_hadith_detail').data.records[0].grade.grader_english).toBe('Named grader');
});

test('ayah research consults major tafsirs and marks missing concept work for same-turn continuation', async () => {
  const call = researchCaller();
  const dossier = await Research.research('research_quran_ayah', { surah: 3, ayah: 159 }, context, call);
  expect(call.mock.calls[0][0]).toBe('lookup_quran_ayah');
  expect(dossier.evidence.filter(x => x.tool === 'lookup_tafsir').map(x => x.arguments.tafsir)).toEqual(['tabari', 'ibn-kathir', 'qurtubi']);
  expect(dossier.coverage.concept_research).toBe('not_searched');
  expect(dossier.next_steps[0]).toContain('same turn');
  expect(call.mock.calls.some(([name]) => name === 'search_hadith')).toBe(false);
});

test('grounded ayah concepts trigger hadith and shuruh research while preserving direct vs conceptual relationships', async () => {
  const call = researchCaller();
  const dossier = await Research.research('research_quran_ayah', { surah: 3, ayah: 159, concepts: ['الشورى', 'التوكل'], tafsirs: ['razi'] }, context, call);
  expect(call).toHaveBeenCalledWith('search_hadith_commentary', { query: 'التوكل', limit: 10 }, expect.any(Object));
  expect(dossier.evidence.filter(x => x.relationship === 'direct_tafsir_of_ayah').map(x => x.arguments.tafsir)).toEqual(['razi']);
  expect(dossier.evidence.find(x => x.tool === 'search_hadith').relationship).toBe('concept_search_candidate');
  expect(dossier.coverage.hadith_commentary).toBe('found');
});

test('source failure is unavailable, not no-match, without dropping surviving tafsirs', async () => {
  const call = researchCaller();
  const base = call.getMockImplementation();
  call.mockImplementation((tool, args, ctx) => tool === 'lookup_tafsir' && args.tafsir === 'tabari' ? Promise.reject(new Error('Source unavailable')) : base(tool, args, ctx));
  const dossier = await Research.research('research_quran_ayah', { surah: 1, ayah: 1 }, context, call);
  expect(dossier.evidence.find(x => x.arguments.tafsir === 'tabari')).toMatchObject({ status: 'unavailable', error: 'Source unavailable' });
  expect(dossier.evidence.find(x => x.arguments.tafsir === 'ibn-kathir').status).toBe('found');
});

test('deadline returns coverage rather than pretending unexecuted searches ran', async () => {
  const call = jest.fn(() => new Promise(() => {}));
  const dossier = await Research.research('research_islamic_topic', { question: 'test', queries: ['test', 'second'] }, { ...context, researchDeadlineMs: 5 }, call);
  expect(dossier.coverage.deadline_reached).toBe(true);
  expect(dossier.evidence.some(x => x.status === 'not_searched')).toBe(true);
  expect(call.mock.calls.length).toBe(4);
});

test.each([
  ['research_islamic_topic', { question: 'x', queries: [] }],
  ['research_islamic_topic', { question: 'x', queries: ['x'.repeat(201)] }],
  ['research_quran_ayah', { surah: 2, ayah: 0 }],
  ['research_quran_ayah', { surah: 2, ayah: 255, concepts: [' '] }],
  ['lookup_hadith_commentary', { id: '1' }]
])('validates research and commentary input %s', async (name, args) => {
  await expect(Mcp.callTool(name, args, context)).rejects.toThrow();
});

test('dossiers bound long text without duplicating renditions or losing grade attribution', async () => {
  const call = researchCaller();
  const base = call.getMockImplementation();
  call.mockImplementation(async (tool, args, ctx) => {
    const response = await base(tool, args, ctx);
    if (tool === 'lookup_hadith_detail') Object.assign(response.structuredContent.records[0], {
      text_arabic: 'ع'.repeat(5000), text_english: 'E'.repeat(5000), text: 'duplicate',
      arabic: { body: 'duplicate' }, english: { body: 'duplicate' }, metadata: { grades: [{ grade: 'Hasan', grader: 'Scholar' }], sourceIsnadHtml: 'long provenance' }
    });
    return response;
  });
  const dossier = await Research.research('research_islamic_topic', { question: 'Istikharah', queries: ['الاستخارة'] }, context, call);
  const record = dossier.evidence.find(x => x.tool === 'lookup_hadith_detail').data.records[0];
  expect(record.text_arabic).toHaveLength(3500);
  expect(record.truncated).toBe(true);
  expect(record).not.toHaveProperty('text');
  expect(record).not.toHaveProperty('english');
  expect(record.metadata.grades).toEqual([{ grade: 'Hasan', grader: 'Scholar' }]);
});

test('partial index responses are unavailable rather than silently complete search results', async () => {
  jest.spyOn(axios, 'post').mockResolvedValue({ data: { timed_out: true, hits: { total: 0, hits: [] } } });
  await expect(Mcp.callTool('search_hadith_commentary', { query: 'secret query' }, context)).rejects.toThrow('Hadith commentary index unavailable');
});

test('preserves hyphenated Malik references in commentary and exact report lookup', async () => {
  jest.spyOn(axios, 'post').mockResolvedValue(indexed([commentary(7, 1, 'malik:13-2')]));
  const response = await Mcp.callTool('search_hadith_commentary', { query: 'الشورى' }, context);
  expect(response.structuredContent.results[0].hadith_reference).toBe('malik:13-2');
  const fetch = jest.fn(async url => ({ ok: true, status: 200, url, text: async () => JSON.stringify([{ ref: 'malik:13-2', book_alias: 'malik', num: '13-2' }]) }));
  const detail = await Mcp.callTool('lookup_hadith_detail', { reference: 'malik:13-2' }, { ...context, fetch });
  expect(detail.structuredContent.records[0].reference).toBe('malik:13-2');
});

test('known principal references are verified even when search ranks peripheral reports first', async () => {
  const call = researchCaller();
  const dossier = await Research.research('research_islamic_topic', { question: 'Istikharah', queries: ['الاستخارة'], hadith_references: ['bukhari:6382'] }, context, call);
  expect(dossier.evidence.find(x => x.tool === 'lookup_hadith_detail').arguments.reference).toBe('bukhari:6382');
});
