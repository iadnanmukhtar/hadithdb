'use strict';
const { normalize, publicJson } = require('../lib/HadithJsonMetadata');
const Mcp = require('../lib/HadithMcp');

test('public JSON uses one metadata object, references only and no hdith properties recursively', () => {
  const input = { ref: 'bukhari:1', id: 1, hId: 1, body: 'Arabic body', en: { body: 'Duplicate' }, ar: { body: 'Arabic body' }, grade_grade: 'صحيح', grader_name: 'Author',
    hdithMetadata: { gradeColors: ['red'], sourceIsnadHtml: 'duplicate chain',
      grades: [{ grade: 'صحيح', grader: 'Author', grader_name: 'Author', grade_color: 'red' }],
      narrators: [{ name: 'Name', vocalized_name: 'Name', flags_json: '[]', flags: [] }],
      takhrij: [{ internal_ref: 'muslim:1', source_body_start: 'extra text' }],
      shawahid: [{ internal_ref: 'muslim:1', label: 'extra text' }],
      sharh: [{ id: 7, source_title: 'Work', text: 'Arabic', text_en: 'English' }] },
    similar: [{ ref: 'abudawud:1', body: 'extra text', hdithMetadata: { grades: [] } }],
    similarBooks: [{ name: 'duplicate book' }] };
  const output = publicJson(input);
  expect(output.metadata.related_reports).toEqual(['muslim:1', 'abudawud:1']);
  expect(output).not.toHaveProperty('similar');
  expect(output).not.toHaveProperty('grade_grade');
  expect(output).not.toHaveProperty('en');
  expect(output).not.toHaveProperty('ar');
  expect(output).not.toHaveProperty('hId');
  expect(output.body).toBe('Arabic body');
  expect(output.metadata.grades[0]).toEqual({ grade: 'صحيح', grader: 'Author', grader_en: null });
  expect(JSON.stringify(output)).not.toMatch(/hdith|extra text|flags_json|gradeColors|sourceIsnadHtml|vocalized_name/);
  expect(input.hdithMetadata.sharh[0].text).toBe('Arabic');
});

test('MCP consumes the renamed public metadata without losing texts or linked references', async () => {
  const metadata = normalize({ grades: [{ grade: 'صحيح', grader: 'Author', primary: true }], similar: [{ internal_ref: 'muslim:1' }],
    sharh: [{ id: 7, source_title: 'Work', author: 'Author', text: 'Arabic', text_en: 'English' }] }, 'bukhari:1');
  const result = await Mcp.callTool('lookup_hadith_detail', { reference: 'bukhari:1', response_profile: 'full' }, {
    baseUrls: { hadith: 'https://example.com' }, fetch: async url => ({ ok: true, status: 200, url: String(url), text: async () => JSON.stringify([{ ref: 'bukhari:1', book_alias: 'bukhari', metadata }]) })
  });
  const record = result.structuredContent.records[0];
  expect(record.metadata.related_reports).toEqual(['muslim:1']);
  expect(record.grade).toMatchObject({ arabic: 'صحيح', grader_arabic: 'Author' });
  expect(record.metadata.sharh[0].text_arabic).toBe('Arabic');
  expect(record.research_inventory.commentaries[0].source.title_arabic).toBe('Work');
});
