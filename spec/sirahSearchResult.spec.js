'use strict';
jest.mock('../lib/Index', () => ({ docsFromQuery: jest.fn() }));
const Index = require('../lib/Index');
const Search = require('../lib/Search');
const ejs = require('ejs');
const path = require('path');
const cheerio = require('cheerio');
const utils = require('../lib/Utils');
const arabic = require('../lib/Arabic');

beforeEach(() => {
 global.settings = { search: { itemsPerPage: 50 } };
 global.books = [{ id: 100427, alias: 'yqsirah', type: 'sirah', hidden: 0, shortName_en: 'YQ Sirah' }];
});

async function renderColumns(i, searchResult = 'علي بن الحسين') {
 const columns = await Promise.all(['en', 'ar'].map(lang => ejs.renderFile(
  path.join(__dirname, '../views/sub-views/hadith_item.ejs'),
  { i, lang, searchResult, utils, arabic, site: { editMode: false }, page: { context: {} }, req: { query: {} }, main: false, title: true, include: () => '' }
 )));
 return cheerio.load(columns.join(''));
}

test('Arabic query renders English Sirah highlight fragments at full width', async () => {
 Index.docsFromQuery.mockResolvedValue(Object.assign([{
  id: 14, num: '14', ref: 'yqsirah:14', book_alias: 'yqsirah', doctype: 'sirah',
  body_en: 'Unrelated opening. '.repeat(100) + 'Ali ibn al-Husayn (علي بن الحسين).',
  title: 'عنوان مترجم', body: '',
  _highlight: { body_en: ['Ali ibn al-Husayn (<i>علي بن الحسين</i>).'] }
 }], { total: 1 }));
 const [result] = await Search.a_searchText('علي بن الحسين', Search.generalContentFilters(['yqsirah']), 0, { generalSearch: true });
 const $ = await renderColumns(result);
 expect($('.hadith-body-content').text()).toContain('علي بن الحسين');
 expect($('.hadith-body-content').text()).not.toContain('Unrelated opening');
 expect($('.hadith-body-content i').text()).toBe('علي بن الحسين');
 expect($('[data-reader-language-column="english"]').hasClass('col-12')).toBe(true);
 expect($('[data-reader-language-column="arabic"]')).toHaveLength(0);
});

test('bilingual results retain two columns and browse rendering is unchanged', async () => {
 const i = { id: 14, num: '14', ref: 'yqsirah:14', book_alias: 'yqsirah', en: { body: 'English' }, ar: { body: 'العربية' } };
 let $ = await renderColumns(i);
 expect($('[data-reader-language-column].col-md-6')).toHaveLength(2);
 i.ar = {};
 $ = await renderColumns(i, '');
 expect($('[data-reader-language-column].col-md-6')).toHaveLength(2);
});
