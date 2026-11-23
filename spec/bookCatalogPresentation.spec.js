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
async function render(collection, editMode = false, records = [book], query = {}) {
  global.settings = { site: {} };
  global.books = records;
  return ejs.renderFile(path.join(__dirname, '../views', 'books.ejs'), {
    req: { admin: editMode, editMode, query: Object.keys(query).length ? query : { [collection]: '' } }, books: records, tafsirs: records, translations: records.map(record => ({ ...record, lang: 'en' })), sharhBooks: records, mushafs: [{ ...book, href: '/quran/page/1' }],
    BookGroups, Tafsir, BookDownloads,
    utils: { styleAssetVersion: () => 'test', scriptAssetVersion: () => 'test', sharhDisplayName: require('../lib/SharhDisplayName').displayName, sharhAuthorSuffix: require('../lib/SharhDisplayName').authorSuffix, emptyIfNull: value => value || '', markdownToHtml: value => '<p>' + value + '</p>', quranUrl: (_req, url) => url, urlFor: (_req, url) => url, jsonLdScript: () => '' }
  }, { includer: (name) => /(?:^|\/)header\.ejs$/.test(name)
    ? { template: '<nav class="navbar site-navbar fixed-top"><% if (page.context.bookCatalogInitialType) { %><%- include("book_catalog_navigation.ejs", { page }); %><% } %></nav>' }
    : /(?:head|footer|scripts|mobile_navigation)\.ejs$/.test(name) ? { template: ' ' } : undefined });
}
function browser(html) {
  const dom = new JSDOM(html, { url: 'https://example.test/books', runScripts: 'outside-only' });
  dom.window.matchMedia = () => ({ matches: true, addEventListener() {} });
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new dom.window.Event('close')); };
  dom.window.normalizeContentFilterText = value => (value || '').toLowerCase();
  dom.window.document.querySelectorAll('script').forEach(script => dom.window.eval(script.textContent));
  dom.window.eval(source);
  return dom;
}

afterEach(() => { delete global.settings; delete global.books; });

test.each(['hadith', 'tafsir', 'translation', 'sharh'])('%s preserves reader links and shows complete details in a reusable modal', async collection => {
  const dom = browser(await render(collection));
  const doc = dom.window.document;
  const card = doc.querySelector('.book-catalog-tab-pane.active .tafsir-book-row');
  const original = card.querySelector('.tafsir-book-row-main');
  const readerUrl = original.querySelector('a').getAttribute('href');
  expect(card.querySelector('.book-catalog-summary a').getAttribute('href')).toBe(readerUrl);
  expect(original.hidden).toBe(true);
  const type = collection === 'tafsir' ? 'Tafsir' : collection === 'translation' ? 'Translation' : collection === 'sharh' ? 'Sharḥ' : 'Hadith';
  expect(card.querySelector('.book-catalog-type-pill').textContent).toBe(type);
  expect(card.querySelector('.book-catalog-language-pill').textContent).toBe(collection === 'translation' ? 'en' : 'ar');
  expect(card.querySelector('.book-catalog-summary .book-language-badge')).toBeNull();
  const trigger = card.querySelector('.book-catalog-details-button');
  trigger.click();
  const dialog = doc.querySelector('dialog');
  expect(dialog.open).toBe(true);
  expect(dialog.querySelector('#book-catalog-dialog-title').textContent.trim()).toBe(original.querySelector('.tafsir-book-title-line a').textContent.trim());
  expect(dialog.querySelector('.ux-primary-action').href).toBe(original.querySelector('.tafsir-book-title-line a').href);
  expect(dialog.textContent).toContain('Jami al-Bayan');
  const arabicTitle = dialog.querySelector('.tafsir-book-full-name [lang="ar"]');
  expect(arabicTitle.textContent).toBe('جامع البيان');
  expect(arabicTitle.hidden).toBe(false);
  expect(dialog.querySelector('.book-catalog-type-pill').textContent).toBe(type);
  expect(card.querySelector('.book-catalog-summary .book-catalog-pill')).toBeNull();
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
  const dom = browser(await render('tafsir'));
  const doc = dom.window.document;
  const pane = doc.querySelector('.book-catalog-tab-pane.active');
  const category = pane.querySelector('.book-catalog-category');
  expect(category.textContent).toContain('Major Tafsirs');
  expect(category.querySelector('h2 [lang="ar"]')).toBeNull();
  expect(doc.querySelector('[data-catalog-value="tafsir-major"]').textContent).toBe('Major Tafsirs');
  expect(doc.querySelector('.book-catalog-details-button .bi-info-circle')).not.toBeNull();
  expect(doc.querySelector('.book-catalog-details-button').getAttribute('aria-label')).toContain('Book details:');
  expect(doc.querySelector('#book-catalog-dialog-title').textContent).toBe('Book details');
  expect(pane.querySelector('.book-catalog-summary .volume-name').textContent).toBe('Tabari');
  expect(pane.querySelector('.book-catalog-summary .volume-arabic').textContent).toBe('الطبري');
  expect(pane.querySelector('.tafsir-book-row-main .tafsir-book-meta [lang="ar"]').textContent).toContain('ابن جرير الطبري');
  const card = category.querySelector('.tafsir-book-row');
  expect(card.dataset.bookCatalogFilter).toContain('tabari');
  expect(Array.from(card.querySelectorAll('.tafsir-book-row-main .book-catalog-pill')).map(pill => pill.textContent)).toEqual(['Tafsir', 'ar', 'Major Tafsirs']);
  card.classList.add('d-none');
  await Promise.resolve();
  expect(category.hidden).toBe(true);
  card.classList.remove('d-none');
  await Promise.resolve();
  expect(category.hidden).toBe(false);
  dom.window.close();
});

test('keeps inline admin editors in place', async () => {
  const dom = browser(await render('tafsir', true));
  expect(dom.window.document.querySelector('._e')).not.toBeNull();
  expect(dom.window.document.querySelector('.book-catalog-details-button')).toBeNull();
  expect(dom.window.document.querySelector('.tafsir-book-row-main').hidden).toBe(false);
  dom.window.close();
});


test('opens the redesigned catalog at its canonical collection URL', async () => {
  const dom = browser(await render('hadith', false, [book], { tafsir: '' }));
  const doc = dom.window.document;
  expect(doc.querySelector('main .ux-page-title').textContent.trim()).toBe('Tafsir Books');
  expect(doc.querySelector('.catalog-tools details, .catalog-mobile-tools summary, .book-catalog-size-filters')).toBeNull();
  expect(doc.querySelector('link[href*="/css/books.css"]')).not.toBeNull();
  expect(doc.querySelector('[data-catalog-switch]')).toBeNull();
  expect(doc.querySelector('#book-catalog-tafsir-all-tab').getAttribute('href')).toBe('/books?tafsir');
  dom.window.close();
});

test('details pills drive the catalog filters', async () => {
  const dom = browser(await render('hadith'));
  const doc = dom.window.document;
  const card = doc.querySelector('#book-catalog-hadith .book-catalog-card');
  card.querySelector('.book-catalog-details-button').click();
  doc.querySelector('dialog [data-catalog-facet="group"]').click();
  expect(dom.window.history.state.bookCatalog.group).toBe('sihah');
  card.querySelector('.book-catalog-details-button').click();
  doc.querySelector('dialog [data-catalog-facet="badge"]').click();
  expect(doc.querySelector('dialog').open).toBe(false);
  expect(dom.window.history.state.bookCatalog.badge).toBe('ar');
  card.querySelector('.book-catalog-details-button').click();
  doc.querySelector('dialog [data-catalog-facet="type"]').click();
  expect(dom.window.history.state.bookCatalog.group).toBe('');
  dom.window.close();
});

test('renders book tabs inside the fixed header and connects them to the existing panes', async () => {
  const dom = browser(await render('hadith'));
  const doc = dom.window.document;
  expect(doc.querySelector('main .book-catalog-tabs')).toBeNull();
  const tabs = Array.from(doc.querySelectorAll('.site-navbar .book-catalog-navigation [role="tab"]'));
  expect(tabs).toHaveLength(6);
  expect(tabs.find(tab => tab.getAttribute('aria-selected') === 'true').id).toBe('book-catalog-hadith-tab');
  tabs.forEach(tab => expect(doc.querySelector(tab.dataset.bsTarget).getAttribute('aria-labelledby')).toBe(tab.id));
  dom.window.close();
});


test.each(['tafsir', 'translation', 'sharh'])('%s keeps size indicators on cards and in the details dialog', async collection => {
  const records = ['sm', 'md', 'lg'].map((size, index) => ({ ...book, alias: 'size-' + index, size }));
  const dom = browser(await render(collection, false, records));
  const doc = dom.window.document;
  for (const size of ['sm', 'md', 'lg']) {
    const card = doc.querySelector('.book-catalog-tab-pane.active [data-book-catalog-size="' + size + '"]');
    const indicator = '.tafsir-size-indicator-' + size + ', .hadith-size-indicator-' + size;
    expect(card.querySelector('.book-catalog-summary').querySelector(indicator)).not.toBeNull();
    card.querySelector('.book-catalog-details-button').click();
    expect(doc.querySelector('dialog').querySelector(indicator)).not.toBeNull();
    doc.querySelector('dialog').close();
  }
  dom.window.close();
});

test.each(['hadith', 'tafsir', 'translation', 'sharh'])('%s uses the homepage directory link and an inline author and date while preserving full modal metadata', async collection => {
  const record = { ...book, author_en: 'Full English author name', author: 'اسم المؤلف الكامل', authorShortName_en: 'Ibn Jarir', authorShortName: 'ابْنُ جَرِيرٍ' };
  const dom = browser(await render(collection, false, [record]));
  const doc = dom.window.document;
  const card = doc.querySelector('.book-catalog-tab-pane.active .tafsir-book-row');
  const summary = card.querySelector('.book-catalog-summary');
  const metadata = summary.querySelector('a.library-volume .volume-author');
  expect(metadata.textContent).toContain('Ibn Jarir');
  expect(summary.querySelectorAll('a')).toHaveLength(1);
  expect(metadata.textContent).not.toContain('Full English author name');
  expect(metadata.querySelector('.book-catalog-death').textContent).toBe(`d. 310 ${collection === 'translation' ? 'CE' : 'AH'}`);
  summary.querySelector('.book-catalog-details-button').click();
  expect(doc.querySelector('dialog').textContent).toContain('Full English author name');
  dom.window.close();
});

test('sharh cards keep clean titles and display authors in their separate metadata row', async () => {
  const records = [
    { ...book, type: 'sharh', alias: 'bukhari-ibnhajar', shortName_en: 'Fatḥ al-Bārī', authorShortName_en: 'Ibn Hajar al-Asqalani' },
    { ...book, id: 2, type: 'sharh', alias: 'nasai-suyuti', shortName_en: 'Sharḥ al-Suyūṭī', authorShortName_en: 'Jalal al-Din al-Suyuti' }
  ];
  const dom = browser(await render('sharh', false, records));
  const titles = [...dom.window.document.querySelectorAll('.book-catalog-tab-pane.active .book-catalog-summary .volume-name')];
  expect(titles[0].textContent).toBe('Fatḥ al-Bārī');
  expect(titles[0].querySelector('.sharh-author-suffix')).toBeNull();
  expect(titles[0].closest('.book-catalog-summary').querySelector('.volume-author').textContent).toContain('Ibn Hajar al-Asqalani');
  expect(titles[1].querySelector('.sharh-author-suffix')).toBeNull();
  expect(records[0].shortName_en).toBe('Fatḥ al-Bārī');
  dom.window.close();
});


test.each(['mushaf', 'history', 'sharh', undefined])('catalog rail follows initial tab %s and subsequent tab changes', async tab => {
  const dom = browser(await render('hadith', false, [book], { tab }));
  const doc = dom.window.document;
  const visiblePanes = () => Array.from(doc.querySelectorAll('[data-book-rail-pane]')).filter(pane => !pane.hidden).map(pane => pane.dataset.bookRailPane);
  expect(visiblePanes()).toEqual(['book-catalog-' + (tab === 'history' ? 'sirah' : tab || 'hadith')]);
  for (const pane of ['tafsir-all', 'translations', 'hadith', 'sharh', 'sirah', 'mushaf']) {
    doc.querySelector('#book-catalog-' + pane + '-tab').dispatchEvent(new dom.window.Event('shown.bs.tab'));
    expect(visiblePanes()).toEqual(['book-catalog-' + pane]);
    const headings = doc.querySelectorAll('[data-toc-heading-rail] h2');
    expect(headings).toHaveLength(1);
    expect(headings[0].textContent).toBe('Book groups');
    expect(headings[0].closest('[data-book-rail-pane]')).toBeNull();
  }
  expect(doc.querySelector('[data-book-rail-pane="book-catalog-mushaf"] li a').getAttribute('href')).toBe('/quran/page/1');
  dom.window.close();
});

test.each([
  ['hadith', '/tabari'],
  ['translation', '/quran/tabari'],
  ['sharh', '/sharh/tabari']
])('%s rail includes grouped and ungrouped books with canonical links', async (collection, href) => {
  const dom = browser(await render(collection, false, [book, { ...book, id: 2, alias: 'ungrouped', shortName_en: 'Ungrouped', properties: {} }]));
  const rail = dom.window.document.querySelector('[data-book-rail-pane]:not([hidden])');
  expect(rail.querySelector('li a').getAttribute('href')).toBe(href);
  expect(rail.textContent).toContain('Ungrouped');
  if (collection === 'hadith') expect(rail.textContent).toContain('Sihah');
  dom.window.close();
});

test('groups translations chronologically and shows publication and joint death dates', async () => {
  const collection = 'translation';
  const records = [
    { ...book, alias: 'early', type: 'trans', published_year: 1934, death: 1372, translationDeathLabel: 'd. 1953 CE' },
    { ...book, alias: 'joint', type: 'trans', published_year: 1977, death: null, translationDeathLabel: 'al-Hilali: d. 1987 CE; Khan: d. 2021 CE' },
    { ...book, alias: 'modern', type: 'trans', published_year: 2015, death: null }
  ];
  const dom = browser(await render(collection, false, records));
  const doc = dom.window.document;
  const catalog = doc.querySelector('#book-catalog-translations');
  expect(Array.from(catalog.querySelectorAll('.book-catalog-category-title')).map(node => node.textContent)).toEqual(['20th Century', '21st Century']);
  expect(doc.querySelector('.tafsir-group-rail').textContent).not.toMatch(/Pub\.|d\. \d/);
  expect(Array.from(catalog.querySelectorAll('.book-catalog-publication')).map(node => node.textContent)).toEqual(['Pub. 1934', 'Pub. 1977', 'Pub. 2015']);
  expect(Array.from(catalog.querySelectorAll('.book-catalog-death')).map(node => node.textContent)).toEqual(['d. 1953 CE', 'al-Hilali: d. 1987 CE; Khan: d. 2021 CE']);
  dom.window.close();
});

test.each(['hadith', 'tafsir', 'translation', 'sharh'])('%s orders category cards by death with publication fallback and undated last', async collection => {
  const records = [
    { ...book, alias: 'unknown', death: '', published_year: '' },
    { ...book, alias: 'later', death: '400', published_year: 100 },
    { ...book, alias: 'fallback', death: '', published_year: 350 },
    { ...book, alias: 'earlier', death: '300', published_year: 900 }
  ];
  const dom = browser(await render(collection, false, records));
  const root = dom.window.document.querySelector('.book-catalog-tab-pane.active');
  expect(Array.from(root.querySelectorAll('.book-catalog-grid .tafsir-book-row')).map(card => card.dataset.bookSortYear)).toEqual(['300', '350', '400', 'Infinity']);
  dom.window.close();
});

test.each(['hadith', 'sharh'])('%s tags and filters sharh books by their hadith collection', async collection => {
  const group = { id: 'sharh-bukhari', scope: 'sharh', label: 'Sahih al-Bukhari' };
  const records = [
    { ...book, alias: 'bukhari-ibnhajar', type: 'sharh', hidden: 1, properties: { searchGroups: [group] } },
    { ...book, alias: 'muslim-nawawi', type: 'sharh', hidden: 1, properties: { searchGroups: [{ ...group, id: 'sharh-muslim', label: 'Sahih Muslim' }] } }
  ];
  const dom = browser(await render(collection, false, records));
  const doc = dom.window.document;
  if (collection === 'hadith') {
    const tab = doc.querySelector('[data-bs-target="#book-catalog-sharh"]');
    tab.dispatchEvent(new dom.window.Event('shown.bs.tab', { bubbles: true }));
  }
  const scope = doc.querySelector('#book-catalog-sharh');
  expect(Array.from(scope.querySelectorAll('.book-catalog-category-title')).map(node => node.textContent)).toEqual(['Sahih al-Bukhari', 'Sahih Muslim']);
  expect(scope.querySelector('.tafsir-book-row-main .book-catalog-classifications').textContent).toContain('Sahih al-Bukhari');
  doc.querySelector('[data-catalog-value="sharh-bukhari"]').click();
  expect(scope.querySelectorAll('.tafsir-book-row:not(.d-none)')).toHaveLength(1);
  expect(scope.querySelector('.tafsir-book-row:not(.d-none)').dataset.bookCatalogGroups).toBe('sharh-bukhari');
  dom.window.close();
});

test.each([
 ['hadith', 'hadith'], ['translation', 'translations'], ['tafsir', 'tafsir-all'],
 ['sharh', 'sharh'], ['history', 'sirah'], ['mushaf', 'mushaf']
])('direct /books?%s selects its pane and exposes crawlable type links', async (query, pane) => {
 const dom = browser(await render('hadith', false, [book], { [query]: '' }));
 const doc = dom.window.document;
 expect(doc.querySelector('.book-catalog-tab-pane.active').id).toBe('book-catalog-' + pane);
 expect(doc.querySelector('.book-catalog-tabs .active').getAttribute('href')).toBe('/books?' + query);
 expect(Array.from(doc.querySelectorAll('.book-catalog-tabs a')).map(link => link.getAttribute('href'))).toEqual(['/books?mushaf','/books?tafsir','/books?translation','/books?hadith','/books?sharh','/books?history']);
 expect(Array.from(doc.querySelectorAll('[data-book-rail-pane]')).filter(node => !node.hidden).map(node => node.dataset.bookRailPane)).toEqual(['book-catalog-' + pane]);
 dom.window.close();
});

test('typing a book filter keeps Tafsir selected even when another collection matches', async () => {
  const dom = browser(await render('hadith', false, [book], { tafsir: '' }));
  const doc = dom.window.document;
  const show = jest.fn();
  dom.window.bootstrap = { Tab: function () { this.show = show; } };
  const filter = doc.getElementById('book-catalog-filter');
  const empty = doc.querySelector('.book-catalog-filter-empty');
  const tafsir = doc.querySelector('#book-catalog-tafsir-all .book-catalog-card');
  doc.querySelector('#book-catalog-sharh .book-catalog-card').dataset.bookCatalogFilter = 'dorar sharh';
  tafsir.dataset.bookCatalogFilter = 'dorar tafsir';
  for (const [query, matches] of [['dorar', true], ['sharh', false], ['', true]]) {
    filter.value = query;
    filter.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    expect(show).not.toHaveBeenCalled();
    expect(tafsir.classList.contains('d-none')).toBe(!matches);
    expect(empty.classList.contains('d-none')).toBe(matches);
  }
  dom.window.close();
});
