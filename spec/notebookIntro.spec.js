'use strict';
const Intro = require('../lib/NotebookIntro');
afterEach(() => { delete global.query; });
test('identifies the reported introduction within its book and section', () => {
  expect(Intro.title({ level: 2, h1: 0, h2: 1, h2_title_en: 'Introduction', book_shortName_en: 'Riyad al-Salihin' }))
    .toBe('Introduction — Riyad al-Salihin — Section 0.1 — Introduction');
});
test('includes chapter, subsection, and Arabic-only titles', () => {
  expect(Intro.title({ level: 1, h1: 5, title_en: 'Prayer' }, { shortName_en: 'Collection' })).toContain('Collection — Chapter 5 — Prayer');
  expect(Intro.title({ level: 3, h1: 5, h2: 2, h3: 1, title: 'عنوان' }, { name: 'كتاب' })).toContain('كتاب — Subsection 5.2.1 — عنوان');
});
test('resolves existing intro labels in one batch while preserving note content and identity', async () => {
  global.query = jest.fn().mockResolvedValue([{ id: 166738, level: 2, h1: 0, h2: 1, h2_title_en: 'Introduction', book_shortName_en: 'Riyad al-Salihin' }]);
  const note = { source_key: 'intro:166738', source_title: 'Introduction — Introduction', title: 'My title', markdown: 'My text', revision: 'original' };
  const other = { source_key: 'item:1', source_title: 'Reference' };
  const result = await Intro.resolve([note, other, null]);
  expect(result[0]).toEqual({ ...note, source_title: 'Introduction — Riyad al-Salihin — Section 0.1 — Introduction' });
  expect(result[1]).toBe(other);
  expect(result[2]).toBe(null);
  expect(global.query).toHaveBeenCalledTimes(1);
});
