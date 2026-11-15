'use strict';
const ejs = require('ejs');
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const SirahReader = require('../lib/SirahReader');
const utils = require('../lib/Utils');
const arabic = require('../lib/Arabic');
const filename = path.join(__dirname, '../views/sirah_passage.ejs');

test('item navigation crosses headings but stops at book boundaries and missing neighbors', async () => {
 const item = { book_alias: 'history', prevId: 2, nextId: 4,
  getPrev: jest.fn().mockResolvedValue({ book_alias: 'other', ref: 'other:9' }),
  getNext: jest.fn().mockResolvedValue({ book_alias: 'history', ref: 'history:4', h1: 2, title_en: 'Next chapter' }) };
 expect(await SirahReader.itemNavigation(item)).toEqual({ next: '/history:4', nextTitle: 'Next: Next chapter' });
 item.nextId = null;
 item.getPrev.mockResolvedValue(null);
 expect(await SirahReader.itemNavigation(item)).toEqual({});
 expect(item.getNext).toHaveBeenCalledTimes(1);
});

test.each([['sirah', true], ['history', true], ['sirah', false], ['history', false]])('%s reader headings with passage headline=%s', (type, hasHeadline) => {
 const book = { alias: 'history', type, name_en: 'History Book', title: 'التاريخ', shortName_en: 'History', shortName: 'التاريخ', author_en: 'Author', author: 'المؤلف', death: 218 };
 const chapter = { book, id: 1, h1: 1, level: 1, path: 'history/1', title_en: 'Chapter title', title: 'الفصل' };
 const section = { book, id: 2, h1: 1, h2: 2, level: 2, path: 'history/1/2', title_en: 'Section title', title: 'القسم' };
 const subsection = { book, id: 3, h1: 1, h2: 2, h3: 3, level: 3, path: 'history/1/2/3', title_en: 'Subsection title' };
 const item = { id: 5, num: '5', ref: 'history:5', book_alias: book.alias, chapter, section, subsection, title_en: hasHeadline ? 'Passage title' : '', body_en: 'Passage body' };
 const outlines = require('../lib/HadithHeadingOutlines').buildOutline(chapter, [section, subsection]);
 const base = { global: { settings: { site: {} } }, req: {}, book, item, utils, arabic,
  readerNavigation: { next: '/history:6' }, hadithHeadingOutlines: { 'history:1': outlines } };
 const include = (name, data) => {
  if (!/chapterTitle|heading\.ejs|sirah_item|hadith_heading_toc/.test(name)) return '';
  const file = path.join(path.dirname(filename), name);
  return ejs.render(fs.readFileSync(file, 'utf8'), { ...base, ...data, include }, { filename: file });
 };
 const $ = cheerio.load(ejs.render(fs.readFileSync(filename, 'utf8'), { ...base, include }, { filename }));
 expect($('.quran-tafsir-source').text()).toContain('History Book');
 expect($('.quran-tafsir-source').text()).toContain('d. 218 AH');
 expect($('main').attr('data-reader-next-url')).toBe('/history:6');
 expect($('main').attr('data-reader-infinite')).toBe('hadith-sirah-item');
 expect($('[data-hadith-heading-toc]').attr('data-hadith-heading-initial-key')).toBe('history:1.2.3');
 expect($('[data-hadith-heading-key="history:1.2.3"][data-hadith-heading-target]')).toHaveLength(1);
 expect($('.sirah-item')).toHaveLength(1);
 expect($('.sirah-item').text()).toContain('Passage body');
 expect($('[data-hadith-heading-level="3"] .heading')).toHaveLength(0);
 if (hasHeadline) expect($('main').text()).not.toContain('Subsection title');
 else expect($('.sirah-subsection-heading').text()).toContain('Subsection title');
});

test('scrolling keeps only new heading boundaries and omits repeated book metadata', () => {
 const { JSDOM } = require('jsdom');
 const vm = require('vm');
 const document = new JSDOM('<main><div data-sirah-heading-path="history/1"></div><div data-sirah-heading-path="history/1/2"></div></main>').window.document;
 const remote = document.createElement('main');
 remote.innerHTML = '<p class="page-updated">Updated</p><header class="quran-tafsir-source">Book</header><div data-sirah-heading-path="history/1">Chapter</div><div data-sirah-heading-path="history/1/2">Repeated section</div><div data-sirah-heading-path="history/1/2/4">New subsection</div><article class="sirah-item">Next passage</article>';
 const script = fs.readFileSync(require.resolve('../public/static/js/script.js'), 'utf8');
 const start = script.indexOf('var appendHadithPage = function');
 const end = script.indexOf('var reinitializeChunk = function', start);
 const scope = { document, mode: 'hadith-sirah-item', main: [document.querySelector('main')] };
 vm.createContext(scope);
 vm.runInContext(script.slice(start, end), scope);
 const chunk = document.createElement('section');
 scope.appendHadithPage(remote, [chunk]);
 expect(chunk.querySelector('.quran-tafsir-source, .page-updated')).toBeNull();
 expect(Array.from(chunk.querySelectorAll('[data-sirah-heading-path]')).map(node => node.dataset.sirahHeadingPath)).toEqual(['history/1/2/4']);
 expect(chunk.querySelector('.sirah-item').textContent).toBe('Next passage');
});

test.each([
 [true, true, false, true],
 [true, false, false, false],
 [false, true, false, false],
 [true, true, true, false]
])('passage editor markup follows admin=%s editMode=%s noadmin=%s', (admin, editMode, noadmin, editable) => {
 const book = { alias: 'yqsirah', type: 'sirah', name_en: 'Seerah' };
 const item = { id: 408, num: '408', ref: 'yqsirah:408', book_alias: book.alias,
  title_en: 'Passage', body_en: 'Original body[^1].', footnote_en: '[^1]: Original footnote.' };
 // Use EJS's real include scope: parent template constants are not include locals.
 const html = ejs.render(fs.readFileSync(filename, 'utf8'), {
  global: { settings: { site: {} } }, req: { admin, editMode }, noadmin,
  book, item, utils, arabic, readerNavigation: {}, hadithHeadingOutlines: {}
 }, { filename, includer: (name, resolved) => name.endsWith('sirah_item.ejs')
  ? { filename: resolved }
  : { template: ' ' } });
 const $ = cheerio.load(html);
 for (const field of ['title_en', 'body_en', 'footnote_en']) {
  const editor = $(`._e[data-prop="hadith.${field}"]`);
  expect(editor).toHaveLength(editable ? 1 : 0);
  if (editable) expect(editor.attr('data-id')).toBe('408');
 }
 if (editable) {
  expect($('[data-prop="hadith.body_en"]').attr('data-markdown-source')).toBe(item.body_en);
  expect($('[data-prop="hadith.footnote_en"]').attr('data-markdown-source')).toBe(item.footnote_en);
 }
});
