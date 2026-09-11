'use strict';
const fs = require('fs');
const path = require('path');

const source = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

describe('History catalog navigation', () => {
 test('desktop and mobile Sirah links open Ibn Hisham directly', () => {
  expect(source('views/sub-views/header.ejs')).toContain("utils.urlFor(req, '/ibnhisham')");
  expect(source('views/sub-views/offcanvas_primary_nav.ejs')).toContain("utils.urlFor(req, '/ibnhisham')");
  expect(source('views/sub-views/header.ejs')).toContain('>Sirah</a>');
 });

 test('the books page renders the requested History tab active', () => {
  const books = source('views/books.ejs');
  expect(books).toContain("req.query.tab === 'history' ? 'sirah' : 'hadith'");
  expect(books).toContain("bookType === initialBookCatalogType ? ' show active' : ''");
  expect(books).toContain("catalogTabButton('book-catalog-sirah', 'History &amp; Sirah'");
  expect(books).toContain('book-language-badge');
  expect(books).toContain('book.shortName_en || book.name_en || book.alias');
  expect(books).toContain("book.shortName || book.name || ''");
  expect(books).not.toContain('Translations <sup>en</sup>');
  expect(books.indexOf("catalogTabButton(sectionId, group.heading")).toBeLessThan(books.indexOf("catalogTabButton('book-catalog-translations'"));
  expect(books.indexOf("catalogTabButton('book-catalog-translations'")).toBeLessThan(books.indexOf("catalogTabButton('book-catalog-hadith'"));
 expect(books.indexOf("catalogTabButton('book-catalog-hadith'")).toBeLessThan(books.indexOf("catalogTabButton('book-catalog-sirah'"));
 });

 test('language badges inspect the effective corpus for physical and virtual books', () => {
  const route = source('routes/books.js');
  expect(route).toContain('FROM hadiths');
  expect(route).toContain('FROM v_hadiths_virtual_snapshot');
  expect(route).toContain("Number(book.virtual) === 1");
  expect(route).toContain("NULLIF(TRIM(body_en), '') IS NOT NULL");
 });

 test('both historical books appear in the Hadith carousel and homepage list', () => {
  const nav = source('views/sub-views/bookNav.ejs');
  const home = source('views/index.ejs');
  expect(nav).toContain("['ibnhisham', 'history']");
  expect(nav).toContain("books.find(function (book) { return book && book.hidden == 0 && book.alias === alias; })");
  expect(home).toContain("include('sub-views/bookNav.ejs', { inlineHadithBooks: true })");
 });

 test('English passage references use the book alias', () => {
  expect(source('views/sub-views/sirah_item.ejs')).toContain('i.book_alias || i.book_shortName_en');
 });

 test('the History group uses a distinct scope from the history book alias', () => {
  const dialog = source('views/sub-views/global_search_dialog.ejs');
  expect(dialog).toContain('name="b" value="sirah"');
  expect(dialog).toContain('value="<%= book.alias %>"');
  expect(dialog).toContain('<span>History</span>');
 });
});
