'use strict';
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const { JSDOM } = require('jsdom');
const BookGroups = require('../lib/BookGroups');
const Tafsir = require('../lib/Tafsir');
const BookDownloads = require('../lib/BookDownloads');
const source = fs.readFileSync(path.join(__dirname, '../public/static/js/book-catalog.js'), 'utf8');
const book = {
  id: 1, alias: 'tabari', name_en: 'Tafsir al-Tabari', name: 'تفسير الطبري', author_en: 'Ibn Jarir al-Tabari', author: 'ابن جرير الطبري',
  title_en: 'Jami al-Bayan', title: 'جامع البيان', death: '310', description: 'Full book description.', lang: 'ar', type: 'hadith',
  properties: { searchGroups: [{ id: 'tafsir-major', scope: 'tafsir', label: 'major tafsirs' }, { id: 'sihah', scope: 'hadith', label: 'sihah' }] }
};
async function render(template, editMode = false) {
  global.settings = { site: {} };
  global.books = [book];
  return ejs.renderFile(path.join(__dirname, '../views', template), {
    req: { admin: editMode, editMode, query: {} }, books: [book], tafsirs: [book], translations: [{ ...book, lang: 'en' }], sharhBooks: [book], mushafs: [{ ...book, href: '/quran/page/1' }],
    BookGroups, Tafsir, BookDownloads,
    utils: { emptyIfNull: value => value || '', markdownToHtml: value => '<p>' + value + '</p>', quranUrl: (_req, url) => url, urlFor: (_req, url) => url, jsonLdScript: () => '' }
  }, { includer: (name) => /(?:head|header|footer|scripts|mobile_navigation)\.ejs$/.test(name) ? { template: ' ' } : undefined });
}
function browser(html) {
  const dom = new JSDOM(html, { runScripts: 'outside-only' });
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new dom.window.Event('close')); };
  dom.window.eval(source);
  return dom;
}

afterEach(() => { delete global.settings; delete global.books; });

test.each(['books.ejs', 'tafsir_books.ejs', 'translation_books.ejs', 'sharh_catalog.ejs'])('%s preserves reader links and shows complete details in a reusable modal', async template => {
  const dom = browser(await render(template));
  const doc = dom.window.document;
  const card = doc.querySelector(template === 'books.ejs' ? '#book-catalog-hadith .tafsir-book-row' : '.tafsir-book-row');
  const original = card.querySelector('.tafsir-book-row-main');
  const readerUrl = original.querySelector('a').getAttribute('href');
  expect(card.querySelector('.book-catalog-summary a').getAttribute('href')).toBe(readerUrl);
  expect(original.hidden).toBe(true);
  const trigger = card.querySelector('.book-catalog-details-button');
  trigger.click();
  const dialog = doc.querySelector('dialog');
  expect(dialog.open).toBe(true);
  expect(dialog.textContent).toContain('Jami al-Bayan');
  expect(dialog.textContent).toContain('Full book description.');
  expect(dialog.querySelector('.toc-book-description-full').classList.contains('d-none')).toBe(false);
  dialog.close();
  expect(card.contains(original)).toBe(true);
  expect(original.hidden).toBe(true);
  expect(doc.activeElement).toBe(trigger);
  trigger.click();
  expect(doc.querySelectorAll('dialog')).toHaveLength(1);
  expect(dialog.querySelector('.tafsir-book-row-main')).toBe(original);
  dialog.close(); dom.window.close();
});

test('groups bilingual categories and hides empty sections after existing filters change', async () => {
  const dom = browser(await render('tafsir_books.ejs'));
  const doc = dom.window.document;
  const category = doc.querySelector('.book-catalog-category');
  expect(category.textContent).toContain('Major Tafsirs');
  expect(category.querySelector('h2 [lang="ar"]').textContent).toBe('أمهات التفاسير');
  const card = category.querySelector('.tafsir-book-row');
  expect(card.dataset.tafsirBookFilter).toContain('tabari');
  card.classList.add('d-none');
  await Promise.resolve();
  expect(category.hidden).toBe(true);
  card.classList.remove('d-none');
  await Promise.resolve();
  expect(category.hidden).toBe(false);
  dom.window.close();
});

test('keeps inline admin editors in place', async () => {
  const dom = browser(await render('tafsir_books.ejs', true));
  expect(dom.window.document.querySelector('._e')).not.toBeNull();
  expect(dom.window.document.querySelector('.book-catalog-details-button')).toBeNull();
  expect(dom.window.document.querySelector('.tafsir-book-row-main').hidden).toBe(false);
  dom.window.close();
});
