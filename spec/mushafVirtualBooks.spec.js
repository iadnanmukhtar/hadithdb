'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ejs = require('ejs');
const { JSDOM } = require('jsdom');
const Utils = require('../lib/Utils');
const { catalog } = require('../lib/QuranMushafBooks');

const source = fs.readFileSync(path.join(__dirname, '../public/static/js/script.js'), 'utf8');
function browserFunctions(names, location) {
  const context = { URL, URLSearchParams, window: { location }, quranTafsirSettingsPromise: null };
  vm.createContext(context);
  names.forEach(name => {
    const start = source.indexOf(`function ${name}(`);
    const end = source.indexOf('\nfunction ', start + 1);
    vm.runInContext(source.slice(start, end), context);
  });
  return context;
}

beforeEach(() => { jest.spyOn(Utils, 'isLocalhostRequest').mockReturnValue(true); });
afterEach(() => { jest.restoreAllMocks(); });

test('renders three searchable virtual Mushaf books with distinct reader links', async () => {
  const html = await ejs.renderFile(path.join(__dirname, '../views/sub-views/mushaf_catalog_list.ejs'), {
    mushafs: catalog(), utils: Utils, req: { headers: { host: 'localhost:3004' }, query: {} }
  });
  const document = new JSDOM(html).window.document;
  const cards = [...document.querySelectorAll('.book-catalog-card')];
  expect(cards).toHaveLength(3);
  ['uthmani', 'indo-pak', 'warsh'].forEach((script, i) => {
    expect(cards[i].querySelector('a').getAttribute('href')).toBe(`/quran/page/1?script=${script}`);
    expect(cards[i].dataset.bookCatalogFilter).toContain(script);
    expect(catalog()[i].virtual).toBe(1);
  });
});

test.each(['uthmani', 'indo-pak', 'warsh'])('explicit %s edition overrides a different saved preference', async script => {
  const location = { pathname: '/quran/page/1', search: `?script=${script}` };
  const context = browserFunctions(['normalizeQuranScriptChoice', 'getQuranTafsirSettings'], location);
  context.window.hadithQuranUserSettingsOverride = { quran: { script: script === 'warsh' ? 'uthmani' : 'warsh' } };
  expect((await context.getQuranTafsirSettings()).quran.script).toBe(script);
});

test('keeps edition and ayah across server and client reader links without overriding another explicit edition', () => {
  const req = { headers: { host: 'localhost:3004' }, query: { script: 'warsh' } };
  const location = { href: 'http://localhost:3004/quran/page/1?script=warsh', search: '?script=warsh' };
  const context = browserFunctions(['normalizeQuranScriptChoice', 'quranMushafEditionUrl'], location);
  for (const transform of [url => Utils.quranUrl(req, url), context.quranMushafEditionUrl]) {
    expect(transform('/quran/page/2?ayah=2:1')).toBe('/quran/page/2?ayah=2%3A1&script=warsh');
    expect(transform('/quran/page/2?script=indo-pak')).toBe('/quran/page/2?script=indo-pak');
    expect(transform('/quran/1')).toBe('/quran/1');
  }
  location.search = '?script=invalid';
  expect(context.quranMushafEditionUrl('/quran/page/2')).toBe('/quran/page/2');
});


test('Books is the first accessible quick link and marks the catalog current', () => {
  const header = fs.readFileSync(path.join(__dirname, '../views/sub-views/header.ejs'), 'utf8');
  const start = header.indexOf('<div class="offcanvas-quick-actions"');
  const end = header.indexOf('<div class="row">', start);
  const html = ejs.render(header.slice(start, end), {
    isBooksArea: true, isCommunityArea: false, isBookmarksArea: false, isSettingsArea: false,
    requestPath: '/books', req: {}, settingsHref: '/settings', utils: { urlFor: (_req, url) => url },
    activeNavAttrs: active => active ? ' active" aria-current="page' : ''
  }, { filename: path.join(__dirname, '../views/sub-views/header.ejs') });
  const first = new JSDOM(html).window.document.querySelector('a');
  expect(first.getAttribute('aria-label')).toBe('Books');
  expect(first.getAttribute('aria-current')).toBe('page');
  expect(first.getAttribute('href')).toBe('/books');
  expect(first.querySelector('.offcanvas-books-icon').getAttribute('aria-hidden')).toBe('true');
});
