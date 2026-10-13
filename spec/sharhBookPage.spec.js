'use strict';
const ejs = require('ejs');
const path = require('path');
const cheerio = require('cheerio');
const Sharh = require('../lib/Sharh');
const router = require('../routes/sharh');
const book = { id: 100, alias: 'malik-istidhkar', type: 'sharh', name_en: 'Al-Istidhkar', name: 'الاستذكار', shortName_en: 'Istidhkar', shortName: 'الاستذكار', author_en: 'Ibn Abd al-Barr', author: 'ابن عبد البر', death: 463, description: 'A description.' };
afterEach(() => jest.restoreAllMocks());

test.each([false, true])('shared metadata renders with admin editing=%s', async editMode => {
 const html = await ejs.renderFile(path.join(__dirname, '../views/sub-views/book_metadata.ejs'), {
  site: { editMode }, book, tocDisplayBook: book, tocDisplayBookNameEn: book.name_en, tocDisplayBookTitle: book.name,
  showBookLayout: true, showBookMetadata: true, quranCommentaryBook: null, isEnglishQuranTranslation: false,
  utils: { emptyIfNull: value => value || '', markdownToHtml: value => `<p>${value}</p>` }
 });
 const $ = cheerio.load(html);
 expect($('heading').text()).toContain(book.name_en);
 expect($('.tafsir-book-meta').text()).toContain('463 AH');
 expect($('[data-prop="book.name_en"]')).toHaveLength(editMode ? 1 : 0);
 expect($('[data-prop="book.author"]')).toHaveLength(editMode ? 1 : 0);
 expect($('[data-edit-format="md"]')).toHaveLength(editMode ? 1 : 0);
 expect($('[data-toc-description-expand]')).toHaveLength(editMode ? 0 : 1);
});

test('book route supplies coverage and does not load a passage TOC', async () => {
 jest.spyOn(Sharh, 'catalog').mockResolvedValue([book]);
 jest.spyOn(Sharh, 'coveredBooks').mockResolvedValue([{ alias: 'malik', hadith_count: 1200 }]);
 const entries = jest.spyOn(Sharh, 'bookEntries');
 const res = { render: jest.fn() };
 await router.stack.find(layer => layer.route?.path === '/:alias').route.stack[0].handle({ params: { alias: book.alias } }, res, jest.fn());
 expect(res.render).toHaveBeenCalledWith('sharh_books', expect.objectContaining({ sharhBook: book, coveredBooks: [{ alias: 'malik', hadith_count: 1200 }] }));
 expect(entries).not.toHaveBeenCalled();
});

test.each([[[]], [[{ alias: 'malik', shortName_en: 'Muwatta Malik', shortName: 'موطأ مالك', hadith_count: 1200 }]]])('coverage list renders links and an empty state', async coveredBooks => {
 const html = await ejs.renderFile(path.join(__dirname, '../views/sharh_books.ejs'), {
  global: { settings: { site: {} } }, req: {}, sharhBook: book, books: [book], offset: 0, coveredBooks, include: () => ''
 });
 const $ = cheerio.load(html);
 expect($('#toc')).toHaveLength(0);
 if (coveredBooks.length) {
  expect($('tbody a').first().attr('href')).toBe('/malik');
  expect($('tbody tr').text()).toContain('1,200');
 } else expect($('section').text()).toContain('No linked books yet.');
});

test.each([false, true])('catalog rows share tafsir styling and inline editors (edit=%s)', async editMode => {
 const html = await ejs.renderFile(path.join(__dirname, '../views/sub-views/sharh_catalog_list.ejs'), {
  site: { editMode }, sharhBooks: [{ ...book, lang: 'ar-en' }],
  utils: { emptyIfNull: value => value || '', markdownToHtml: value => `<p>${value}</p>` }
 });
 const $ = cheerio.load(html);
 expect($('.tafsir-book-row')).toHaveLength(1);
 expect($('.tafsir-book-title-pair a').first().attr('href')).toBe('/sharh/malik-istidhkar');
 expect($('.book-language-badge').text()).toBe('EN-AR');
 expect($('.book-catalog-card').attr('data-book-catalog-filter')).toContain('Ibn Abd al-Barr');
 expect($('[data-prop="book.name_en"]')).toHaveLength(editMode ? 1 : 0);
 expect($('[data-prop="book.description"]')).toHaveLength(editMode ? 1 : 0);
 expect($('[data-toc-description-expand]')).toHaveLength(editMode ? 0 : 1);
 expect($('.book-download-links')).toHaveLength(0);
});
