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

test.each(['sirah', 'history'])('%s reader renders the source, headings, rail, and individual passage', type => {
 const book = { alias: 'history', type, name_en: 'History Book', title: 'التاريخ', shortName_en: 'History', shortName: 'التاريخ', author_en: 'Author', author: 'المؤلف', death: 218 };
 const chapter = { book, id: 1, h1: 1, level: 1, path: 'history/1', title_en: 'Chapter title', title: 'الفصل' };
 const section = { book, id: 2, h1: 1, h2: 2, level: 2, path: 'history/1/2', title_en: 'Section title', title: 'القسم' };
 const subsection = { book, id: 3, h1: 1, h2: 2, h3: 3, level: 3, path: 'history/1/2/3', title_en: 'Subsection title' };
 const item = { id: 5, num: '5', ref: 'history:5', book_alias: book.alias, chapter, section, subsection, title_en: 'Passage title', body_en: 'Passage body' };
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
 expect($('main').text()).not.toContain('Subsection title');
});
