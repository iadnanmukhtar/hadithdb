'use strict';
const ejs = require('ejs');
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const template = fs.readFileSync(path.join(__dirname, '../views/sub-views/sirah_item.ejs'), 'utf8');
function render(overrides = {}, title = true) {
 return cheerio.load(ejs.render(template, {
  i: { id: 1, num: '813787', ref: 'ibnhisham:813787', book_shortName_en: 'Sirat Ibn Hisham', book_shortName: 'سيرة ابن هشام', body: 'النص العربي', title: 'العنوان', ...overrides },
  utils: require('../lib/Utils'), arabic: require('../lib/Arabic'), title
 }, { filename: path.join(__dirname, '../views/sub-views/sirah_item.ejs') }));
}
test.each(['history', 'ibnhisham'])('%s shows passage titles and individual links in scrolling and detail views', alias => {
 for (const title of [false, true]) {
  const $ = render({ book_alias: alias, num: '12', ref: `${alias}:12`, title_en: 'English title', body_en: 'English text' }, title);
  expect($('h1[lang=en].fs-5').text()).toBe('English title');
  expect($('h1[lang=ar].fs-5').text()).toBe('العنوان');
  expect($('article > header.col-12 > h1.fs-5')).toHaveLength(2);
  expect($('article > section h1')).toHaveLength(0);
  expect($('article > header').last().next().is('section')).toBe(true);
  expect($(`b a[href="/${alias}:12"]`)).toHaveLength(2);
 }
});
test('untitled passages omit empty title headings', () => {
 const $ = render({ title: '', title_en: '' }, false);
 expect($('h1')).toHaveLength(0);
});
test('untranslated Sirah occupies the full reader width without an empty English column', () => {
 const $ = render({ title_en: 'Translated heading only', text_en: 'النص العربي الاحتياطي' });
 expect($('section[data-reader-language-column=english]')).toHaveLength(0);
 expect($('section[data-reader-language-column=arabic]').hasClass('col-12')).toBe(true);
 expect($('header[lang=en]').text()).toContain('Translated heading only');
 expect($('#813787')).toHaveLength(1);
});
test('translated Sirah uses two language columns with its English text and notes', () => {
 const $ = render({ body_en: 'English text', footnote_en: 'English note' });
 expect($('section[data-reader-language-column]')).toHaveLength(2);
 expect($('section[data-reader-language-column=arabic]').hasClass('col-md-6')).toBe(true);
 expect($('[data-reader-language-column=english]').text()).toContain('English text');
 expect($('[data-reader-language-column=english] .footnote').text()).toContain('English note');
});
test('Sirah passages expose bookmark, note source, like, reflection, and non-image sharing actions', () => {
 const $ = render();
 expect($('.sirah-item-actions .hadith-bookmark-btn')).toHaveLength(1);
 expect($('.sirah-item-actions .hadith-like-btn')).toHaveLength(1);
 expect($('.sirah-item-actions .hadith-comment-count')).toHaveLength(1);
 expect($('.sirah-item-actions [data-content-share-trigger]')).toHaveLength(1);
 expect($('.sirah-item-actions .hadith-share-action-link').text()).toContain('Share');
 expect($('.sirah-item-actions').text()).not.toMatch(/Sharh|Sound/i);
 expect($('.sirah-item-actions').closest('.h')).toHaveLength(1);
 expect($('.sirah-item-actions .reflection-count-link').attr('data-reflection-disclosure-trigger')).toBe('sirah-comments-1-disclosure');
 expect($('#sirah-comments-1-disclosure')).toHaveLength(1);
 expect($('#sirah-comments-1').attr('data-target-type')).toBe('hadith');
});
test('Sirah passage detail stays on one item while search pagination remains available', () => {
 const search = fs.readFileSync(path.join(__dirname, '../views/search.ejs'), 'utf8');
 expect(search).not.toContain('data-reader-infinite="hadith-sirah"');
 expect(search).toContain('data-search-next-url="<%= page.next %>"');
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
test.each(['history', 'ibnhisham'])('%s uses the shared hadith typography for both languages and footers', alias => {
 const $=render({book_alias:alias,body_en:'English text',footnote:'حاشية عربية',footnote_en:'English footer'});
 for(const lang of ['ar','en']) {
  expect($(`.h[lang=${lang}] .hadith-body-content.content-markdown p`)).toHaveLength(1);
  expect($(`.h[lang=${lang}] footer.footnote.content-markdown p`)).toHaveLength(1);
 }
});
