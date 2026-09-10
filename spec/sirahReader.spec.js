'use strict';
const ejs = require('ejs');
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const template = fs.readFileSync(path.join(__dirname, '../views/sub-views/sirah_item.ejs'), 'utf8');
function render(overrides = {}) {
 return cheerio.load(ejs.render(template, {
  i: { id: 1, num: '813787', ref: 'ibnhisham:813787', book_shortName_en: 'Sirat Ibn Hisham', book_shortName: 'سيرة ابن هشام', body: 'النص العربي', title: 'العنوان', ...overrides },
  utils: require('../lib/Utils'), arabic: require('../lib/Arabic'), title: true
 }, { filename: path.join(__dirname, '../views/sub-views/sirah_item.ejs') }));
}
test('untranslated Sirah occupies the full reader width without an empty English column', () => {
 const $ = render({ title_en: 'Translated heading only', text_en: 'النص العربي الاحتياطي' });
 expect($('[data-reader-language-column=english]')).toHaveLength(0);
 expect($('[data-reader-language-column=arabic]').hasClass('col-12')).toBe(true);
 expect($('header[lang=en]').text()).toContain('Translated heading only');
 expect($('#813787')).toHaveLength(1);
});
test('translated Sirah uses two language columns with its English text and notes', () => {
 const $ = render({ body_en: 'English text', footnote_en: 'English note' });
 expect($('[data-reader-language-column]')).toHaveLength(2);
 expect($('[data-reader-language-column=arabic]').hasClass('col-md-6')).toBe(true);
 expect($('[data-reader-language-column=english]').text()).toContain('English text');
 expect($('[data-reader-language-column=english] .footnote').text()).toContain('English note');
});
test('Sirah passages expose only bookmark, like, and reflection actions', () => {
 const $ = render();
 expect($('.sirah-item-actions .hadith-bookmark-btn')).toHaveLength(1);
 expect($('.sirah-item-actions .hadith-like-btn')).toHaveLength(1);
 expect($('.sirah-item-actions .hadith-comment-count')).toHaveLength(1);
 expect($('.sirah-item-actions').text()).not.toMatch(/Share|Sharh|Sound/i);
 expect($('.sirah-item-actions').closest('.h')).toHaveLength(1);
 expect($('.sirah-item-actions .reflection-count-link').attr('data-reflection-disclosure-trigger')).toBe('sirah-comments-1-disclosure');
 expect($('#sirah-comments-1-disclosure')).toHaveLength(1);
 expect($('#sirah-comments-1').attr('data-target-type')).toBe('hadith');
});
test('Sirah passage detail opts into the existing reader navigation, independently of search pagination', () => {
 const search = fs.readFileSync(path.join(__dirname, '../views/search.ejs'), 'utf8');
 expect(search).toContain('data-reader-infinite="hadith-sirah"');
 expect(search).toContain('data-reader-next-url="<%= page.next %>"');
 expect(search).toContain("item.single && item.doctype === 'sirah'");
});

test('Sirah chapters and sections share one infinite reader mode across chapter boundaries', () => {
 for (const name of ['section', 'chapter']) {
  const source = fs.readFileSync(path.join(__dirname, `../views/${name}.ejs`), 'utf8');
  expect(source).toContain("book.type === 'sirah' ? 'hadith-sirah-reader'");
 }
});

test('Sirah navigation includes chapters without sections in both directions', () => {
 const { adjacentHeadings } = require('../lib/SirahReader');
 const rows = [{level:1,h1:1},{level:2,h1:1,h2:1},{level:1,h1:2},{level:1,h1:3},{level:2,h1:3,h2:1}];
 const book = {alias:'ibnhisham'};
 expect(adjacentHeadings(rows,{h1:1,h2:1},book).next.path).toBe('ibnhisham/2');
 const middle = adjacentHeadings(rows,{h1:2},book);
 expect(middle.prev.path).toBe('ibnhisham/1/1');
 expect(middle.next.path).toBe('ibnhisham/3/1');
 expect(adjacentHeadings(rows,{h1:3,h2:1},book).next).toBeNull();
});

test('chapter opening passages precede their first section without repeating section content', () => {
 const { adjacentHeadings } = require('../lib/SirahReader');
 const rows = [{level:1,h1:10,direct_count:1},{level:2,h1:10,h2:1},{level:1,h1:11,direct_count:2}];
 const book = {alias:'ibnhisham'};
 expect(adjacentHeadings(rows,{h1:10},book).next.path).toBe('ibnhisham/10/1');
 expect(adjacentHeadings(rows,{h1:10,h2:1},book).prev.path).toBe('ibnhisham/10');
 expect(adjacentHeadings(rows,{h1:10,h2:1},book).next.path).toBe('ibnhisham/11');
});
