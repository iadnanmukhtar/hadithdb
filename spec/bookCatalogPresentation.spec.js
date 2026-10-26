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
  id: 1, alias: 'tabari', name_en: 'Tafsir al-Tabari', name: 'تفسير الطبري', shortName_en: 'Tabari', shortName: 'الطبري', author_en: 'Ibn Jarir al-Tabari', author: 'ابن جرير الطبري',
  title_en: 'Jami al-Bayan', title: 'جامع البيان', death: '310', description: 'Full book description.', lang: 'ar', type: 'hadith',
  properties: { searchGroups: [{ id: 'tafsir-major', scope: 'tafsir', label: 'major tafsirs' }, { id: 'sihah', scope: 'hadith', label: 'sihah' }] }
};
async function render(template, editMode = false, records = [book]) {
  global.settings = { site: {} };
  global.books = records;
  return ejs.renderFile(path.join(__dirname, '../views', template), {
    req: { admin: editMode, editMode, query: {} }, books: records, tafsirs: records, translations: records.map(record => ({ ...record, lang: 'en' })), sharhBooks: records, mushafs: [{ ...book, href: '/quran/page/1' }],
    BookGroups, Tafsir, BookDownloads,
    utils: { sharhDisplayName: require('../lib/SharhDisplayName').displayName, sharhAuthorSuffix: require('../lib/SharhDisplayName').authorSuffix, emptyIfNull: value => value || '', markdownToHtml: value => '<p>' + value + '</p>', quranUrl: (_req, url) => url, urlFor: (_req, url) => url, jsonLdScript: () => '' }
  }, { includer: (name) => /(?:^|\/)header\.ejs$/.test(name)
    ? { template: '<nav class="navbar site-navbar fixed-top"><% if (page.context.bookCatalogInitialType) { %><%- include("book_catalog_navigation.ejs", { page }); %><% } %></nav>' }
    : /(?:head|footer|scripts|mobile_navigation)\.ejs$/.test(name) ? { template: ' ' } : undefined });
}
function browser(html) {
  const dom = new JSDOM(html, { runScripts: 'outside-only' });
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new dom.window.Event('close')); };
  dom.window.normalizeContentFilterText = value => (value || '').toLowerCase();
  dom.window.document.querySelectorAll('script').forEach(script => dom.window.eval(script.textContent));
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
  const type = template === 'tafsir_books.ejs' ? 'Tafsir' : template === 'translation_books.ejs' ? 'Translation' : template === 'sharh_catalog.ejs' ? 'Sharḥ' : 'Hadith';
  expect(card.querySelector('.book-catalog-type-pill').textContent).toBe(type);
  expect(card.querySelector('.book-catalog-language-pill').textContent).toBe(template === 'translation_books.ejs' ? 'EN' : 'AR');
  expect(card.querySelector('.book-catalog-summary .book-language-badge')).toBeNull();
  const trigger = card.querySelector('.book-catalog-details-button');
  trigger.click();
  const dialog = doc.querySelector('dialog');
  expect(dialog.open).toBe(true);
  expect(dialog.textContent).toContain('Jami al-Bayan');
  const arabicTitle = dialog.querySelector('.tafsir-book-full-name [lang="ar"]');
  expect(arabicTitle.textContent).toBe('جامع البيان');
  expect(arabicTitle.hidden).toBe(false);
  expect(dialog.querySelector('.book-catalog-type-pill').textContent).toBe(type);
  expect(Array.from(dialog.querySelectorAll('.book-catalog-pill')).map(pill => pill.textContent)).toEqual(
    Array.from(card.querySelectorAll('.book-catalog-summary .book-catalog-pill')).map(pill => pill.textContent)
  );
  expect(dialog.querySelector('.book-language-badge')).toBeNull();
  expect(dialog.textContent).toContain('Full book description.');
  expect(dialog.querySelector('.toc-book-description-full').classList.contains('d-none')).toBe(false);
  dialog.close();
  expect(card.contains(original)).toBe(true);
  expect(original.hidden).toBe(true);
  expect(doc.activeElement).toBe(trigger);
  trigger.click();
  expect(doc.querySelectorAll('dialog')).toHaveLength(1);
  expect(dialog.querySelector('.tafsir-book-row-main')).toBe(original);
  expect(dialog.querySelectorAll('.book-catalog-classifications')).toHaveLength(1);
  dialog.close(); dom.window.close();
});

test('keeps categories and controls English-only and hides empty sections after filtering', async () => {
  const dom = browser(await render('tafsir_books.ejs'));
  const doc = dom.window.document;
  const category = doc.querySelector('.book-catalog-category');
  expect(category.textContent).toContain('Major Tafsirs');
  expect(category.querySelector('h2 [lang="ar"]')).toBeNull();
  expect(doc.querySelector('[data-tafsir-group-filter="tafsir-major"]').textContent).toBe('Major Tafsirs');
  expect(doc.querySelector('.book-catalog-details-button .bi-info-circle')).not.toBeNull();
  expect(doc.querySelector('.book-catalog-details-button').getAttribute('aria-label')).toContain('Book details:');
  expect(doc.querySelector('#book-catalog-dialog-title').textContent).toBe('Book details');
  expect(doc.querySelector('.book-catalog-summary .tafsir-book-title-line a').textContent).toBe('Tabari');
  expect(doc.querySelector('.book-catalog-summary .tafsir-book-title-line[lang="ar"] a').textContent).toBe('الطبري');
  expect(doc.querySelector('.book-catalog-summary .tafsir-book-meta [lang="ar"]').textContent).toContain('ابن جرير الطبري');
  const card = category.querySelector('.tafsir-book-row');
  expect(card.dataset.tafsirBookFilter).toContain('tabari');
  expect(Array.from(card.querySelectorAll('.book-catalog-summary .book-catalog-pill')).map(pill => pill.textContent)).toEqual(['Tafsir', 'AR', 'Major Tafsirs']);
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


test('renders book tabs inside the fixed header and connects them to the existing panes', async () => {
  const dom = browser(await render('books.ejs'));
  const doc = dom.window.document;
  expect(doc.querySelector('main .book-catalog-tabs')).toBeNull();
  const tabs = Array.from(doc.querySelectorAll('.site-navbar .book-catalog-navigation [role="tab"]'));
  expect(tabs).toHaveLength(6);
  expect(tabs.find(tab => tab.getAttribute('aria-selected') === 'true').id).toBe('book-catalog-hadith-tab');
  tabs.forEach(tab => expect(doc.querySelector(tab.dataset.bsTarget).getAttribute('aria-labelledby')).toBe(tab.id));
  dom.window.close();
});


test.each(['books.ejs', 'tafsir_books.ejs', 'translation_books.ejs', 'sharh_catalog.ejs'])('%s combines size filters with search and preserves colored size circles', async template => {
  const records = ['sm', 'md', 'lg', ''].map((size, index) => ({ ...book, id: index + 10, alias: `sized-${index}`, size, shortName_en: `Sample ${index}` }));
  const dom = browser(await render(template, false, records));
  const doc = dom.window.document;
  const root = template === 'books.ejs' ? doc.querySelector('#book-catalog-hadith') : doc.querySelector('main');
  const cards = Array.from(root.querySelectorAll('.tafsir-book-row'));
  const visible = () => cards.filter(card => !card.classList.contains('d-none'));
  const search = doc.querySelector('input[type="search"]');
  for (const [size, label] of [['sm', 'S'], ['md', 'M'], ['lg', 'L']]) {
    doc.querySelector(`[data-book-catalog-size-filter="${size}"]`).click();
    expect(visible()).toHaveLength(1);
    expect(visible()[0].dataset.bookCatalogSize).toBe(size);
    expect(visible()[0].querySelector(`.book-catalog-summary .tafsir-size-indicator-${size}, .book-catalog-summary .hadith-size-indicator-${size}`)).not.toBeNull();
    expect(visible()[0].querySelector('.book-catalog-size-pill')).toBeNull();
    visible()[0].querySelector('.book-catalog-details-button').click();
    expect(doc.querySelector(`dialog .tafsir-size-indicator-${size}, dialog .hadith-size-indicator-${size}`)).not.toBeNull();
    expect(doc.querySelector('dialog .book-catalog-size-pill')).toBeNull();
    doc.querySelector('dialog').close();
  }
  search.value = 'no match'; search.dispatchEvent(new dom.window.Event('input'));
  expect(visible()).toHaveLength(0);
  search.value = ''; search.dispatchEvent(new dom.window.Event('input'));
  expect(visible()).toHaveLength(1);
  expect(doc.querySelectorAll('[data-book-catalog-size-filter]')).toHaveLength(3);
  doc.querySelector('[data-book-catalog-size-filter="lg"]').click();
  expect(visible()).toHaveLength(4);
  const all = doc.querySelector('[data-book-catalog-group-filter=""], [data-tafsir-group-filter=""]');
  if (all) {
    expect(all.nextElementSibling.classList.contains('book-catalog-size-filters')).toBe(true);
    doc.querySelector('[data-book-catalog-size-filter="sm"]').click();
    expect(visible()).toHaveLength(1);
    all.click();
  }
  expect(visible()).toHaveLength(4);
  expect(cards.find(card => !card.dataset.bookCatalogSize).querySelector('.book-catalog-size-pill')).toBeNull();
  dom.window.close();
});


test.each(['books.ejs', 'tafsir_books.ejs', 'translation_books.ejs', 'sharh_catalog.ejs'])('%s uses bilingual short author names and a separate death footer while preserving full modal metadata', async template => {
  const record = { ...book, author_en: 'Full English author name', author: 'اسم المؤلف الكامل', authorShortName_en: 'Ibn Jarir', authorShortName: 'ابْنُ جَرِيرٍ' };
  const dom = browser(await render(template, false, [record]));
  const doc = dom.window.document;
  const card = doc.querySelector(template === 'books.ejs' ? '#book-catalog-hadith .tafsir-book-row' : '.tafsir-book-row');
  const summary = card.querySelector('.book-catalog-summary');
  const metadata = summary.querySelector('.tafsir-book-meta');
  expect(metadata.textContent).toContain('Ibn Jarir');
  expect(metadata.textContent).toContain('ابْنُ جَرِيرٍ');
  expect(metadata.textContent).not.toContain('Full English author name');
  expect(metadata.textContent).not.toContain('310');
  expect(summary.lastElementChild.classList.contains('book-catalog-death')).toBe(true);
  expect(summary.lastElementChild.textContent).toBe(`d. 310 ${template === 'translation_books.ejs' ? 'CE' : 'AH'}`);
  summary.querySelector('.book-catalog-details-button').click();
  expect(doc.querySelector('dialog').textContent).toContain('Full English author name');
  dom.window.close();
});

test('sharh cards keep clean titles and display authors in their separate metadata row', async () => {
  const records = [
    { ...book, type: 'sharh', alias: 'bukhari-ibnhajar', shortName_en: 'Fatḥ al-Bārī', authorShortName_en: 'Ibn Hajar al-Asqalani' },
    { ...book, id: 2, type: 'sharh', alias: 'nasai-suyuti', shortName_en: 'Sharḥ al-Suyūṭī', authorShortName_en: 'Jalal al-Din al-Suyuti' }
  ];
  const dom = browser(await render('sharh_catalog.ejs', false, records));
  const titles = [...dom.window.document.querySelectorAll('.book-catalog-summary .tafsir-book-title-line:not([lang="ar"])')];
  expect(titles[0].querySelector('a').textContent).toBe('Fatḥ al-Bārī');
  expect(titles[0].querySelector('.sharh-author-suffix')).toBeNull();
  expect(titles[0].closest('.book-catalog-summary').querySelector('.tafsir-book-meta').textContent).toContain('Ibn Hajar al-Asqalani');
  expect(titles[1].querySelector('.sharh-author-suffix')).toBeNull();
  expect(records[0].shortName_en).toBe('Fatḥ al-Bārī');
  dom.window.close();
});
