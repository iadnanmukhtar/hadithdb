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
  utils: { sharhDisplayName: require('../lib/SharhDisplayName').displayName, sharhAuthorSuffix: require('../lib/SharhDisplayName').authorSuffix, emptyIfNull: value => value || '', markdownToHtml: value => `<p>${value}</p>` }
 });
 const $ = cheerio.load(html);
 expect($('header h1.ux-page-title').text()).toContain(book.name_en);
 expect($('.tafsir-book-meta').text()).toContain('463 AH');
 expect($('[data-prop="book.name_en"]')).toHaveLength(editMode ? 1 : 0);
 expect($('[data-prop="book.author"]')).toHaveLength(editMode ? 1 : 0);
 expect($('[data-edit-format="md"]')).toHaveLength(editMode ? 1 : 0);
 expect($('#toc-details-content').text()).toContain(book.description);
 expect($('#toc-details-content').hasClass('show')).toBe(editMode);
 expect($('#toc-details-toggle').attr('aria-expanded')).toBe(String(editMode));
});

const sources = [{ id: 1, alias: 'malik' }, { id: 2, alias: 'muslim' }];
test.each([['muslim', 1], ['unrelated', 0], [undefined, 0]])('book route selects covered source for %s', async (alias, index) => {
 jest.spyOn(Sharh, 'catalog').mockResolvedValue([book]);
 jest.spyOn(Sharh, 'coveredBooks').mockResolvedValue(sources);
 const contents = jest.spyOn(Sharh, 'sourceContents').mockResolvedValue([]);
 const res = { render: jest.fn() };
 await router.stack.find(layer => layer.route?.path === '/:alias').route.stack[0].handle({ params: { alias: book.alias }, query: { book: alias } }, res, jest.fn());
 expect(contents).toHaveBeenCalledWith(book, sources[index]);
 expect(res.render).toHaveBeenCalledWith('sharh_books', expect.objectContaining({ selectedBook: sources[index] }));
});

test('source outline keeps its numbering and inherits the first covered descendant', async () => {
 const query = global.query;
 global.query = jest.fn()
  .mockResolvedValueOnce([
   { id: 1, level: 1, h1: 5 }, { id: 2, level: 2, h1: 5, h2: 3 },
   { id: 3, level: 3, h1: 5, h2: 3, h3: 1 }, { id: 4, level: 1, h1: 6 }
  ])
  .mockResolvedValueOnce([
   { toc_id: 3, kind: 'heading', reference: '82' },
   { toc_id: 3, kind: 'hadith', reference: 'muslim:10' },
   { toc_id: 4, kind: 'hadith', reference: 'muslim:125' }
  ]);
 try {
  const chapters = await Sharh.sourceContents(book, { id: 61 });
  expect(chapters.map(chapter => [chapter.h1, chapter.href])).toEqual([
   [5, '/sharh/malik-istidhkar/heading/82'], [6, '/sharh/malik-istidhkar/muslim:125']
  ]);
  expect(chapters[0].sections.map(section => section.href)).toEqual([chapters[0].href, chapters[0].href]);
 } finally { global.query = query; }
});

test.each([0, 1, 2])('renders source navigation and reader links for %i sources', async count => {
 const coveredBooks = sources.slice(0, count);
 const chapter = { id: 4, h1: 1, start: 1, title_en: 'Chapter', href: '/sharh/malik-istidhkar/heading/42', sections: [
  { id: 5, level: 2, h1: 1, h2: 2, title_en: 'Section', href: '/sharh/malik-istidhkar/malik:1-1' }
 ] };
 const html = await ejs.renderFile(path.join(__dirname, '../views/sharh_books.ejs'), {
  global: { settings: { site: {} } }, req: {}, utils: require('../lib/Utils'), sharhBook: book, books: [book],
  coveredBooks, selectedBook: coveredBooks[0], chapters: count ? [chapter] : [], include: () => ''
 });
 const $ = cheerio.load(html);
 expect($('.ux-view-option')).toHaveLength(count > 1 ? count : 0);
 if (count) {
  expect($('#toc a').map((_, el) => $(el).attr('href')).get()).toEqual([chapter.href, chapter.sections[0].href]);
 } else expect($('section').text()).toContain('No linked books yet.');
});

test.each([false, true])('catalog rows share tafsir styling and inline editors (edit=%s)', async editMode => {
 const html = await ejs.renderFile(path.join(__dirname, '../views/sub-views/sharh_catalog_list.ejs'), {
  BookGroups: require('../lib/BookGroups'), site: { editMode }, sharhBooks: [{ ...book, lang: 'ar-en' }],
  utils: { sharhDisplayName: require('../lib/SharhDisplayName').displayName, sharhAuthorSuffix: require('../lib/SharhDisplayName').authorSuffix, emptyIfNull: value => value || '', markdownToHtml: value => `<p>${value}</p>` }
 });
 const $ = cheerio.load(html);
 expect($('.tafsir-book-row')).toHaveLength(1);
 expect($('.tafsir-book-title-pair a').first().attr('href')).toBe('/sharh/malik-istidhkar');
 expect($('.book-language-badge').text()).toBe('en-ar');
 expect($('.book-catalog-card').attr('data-book-catalog-filter')).toContain('Ibn Abd al-Barr');
 expect($('[data-prop="book.name_en"]')).toHaveLength(editMode ? 1 : 0);
 expect($('[data-prop="book.description"]')).toHaveLength(editMode ? 1 : 0);
 expect($('[data-toc-description-expand]')).toHaveLength(editMode ? 0 : 1);
 expect($('.book-download-links a').map((_, el) => $(el).attr('href')).get()).toEqual(['/sharh/malik-istidhkar.json', '/sharh/malik-istidhkar.epub']);
});
