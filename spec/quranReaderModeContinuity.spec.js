'use strict';

const fs = require('fs');
const vm = require('vm');
const script = fs.readFileSync(require.resolve('../public/static/js/script.js'), 'utf8');

function element(attributes = {}, children = {}) {
  return {
    getAttribute: name => attributes[name] || null,
    setAttribute: (name, value) => { attributes[name] = value; },
    querySelector: selector => children[selector] || null,
    matches: selector => selector === '[data-quran-mushaf-page]' && !!attributes['data-quran-mushaf-page']
  };
}

function reader() {
  const links = Object.fromEntries(['passage', 'tafsir', 'mushaf', 'memorize'].map(mode => [mode, element()]));
  const context = vm.createContext({
    URL,
    window: { location: { origin: 'http://localhost:3004' } },
    document: { querySelectorAll: selector => {
      const mode = selector.match(/data-quran-reader-mode-link="(\w+)"/)[1];
      return links[mode] ? [links[mode]] : [];
    } },
    quranUrl: value => value,
    getLastVisitedQuranTafsirSlug: () => 'ibn-kathir'
  });
  vm.runInContext(script.slice(script.indexOf('function copyQuranReaderModeHrefs('), script.indexOf('function scrollQuranMushafJuzMenuToCurrent(')), context);
  return { context, links };
}

test('mode links follow successive Tafsir passages, including their mapped Mushaf pages', () => {
  const { context, links } = reader();
  for (const [ref, page] of [['2:255', 42], ['2:256', 43], ['2:255', 42]]) {
    context.updateQuranReaderModeHrefs(element({
      'data-reader-mode': 'tafsir', 'data-reader-quran-ref': ref,
      'data-quran-reader-mushaf-href': `/quran/page/${page}`
    }));
    expect(links.passage.getAttribute('href')).toBe(`/quran:${ref}`);
    expect(links.tafsir.getAttribute('href')).toBe(`/quran/tafsir/ibn-kathir/quran:${ref}`);
    const destination = new URL(links.mushaf.getAttribute('href'), 'http://localhost');
    expect(destination.pathname).toBe(`/quran/page/${page}`);
    expect(destination.searchParams.get('ayah')).toBe(ref);
  }
});

test('Mushaf search focus and selected Study ayahs take precedence over the passage start', () => {
  const { context } = reader();
  const selected = element({ 'data-quran-ref': '2:255' });
  const first = element({ 'data-quran-ref': '2:253' });
  const mushaf = element({ 'data-quran-mushaf-page': '42' }, {
    '.quran-mushaf-search-ayah[data-quran-ref]': selected,
    '.quran-mushaf-sheet:not(.quran-review-page-continuity) [data-quran-ref]': first
  });
  expect(context.quranReaderModeFirstRef(mushaf)).toBe('2:255');
  const study = element({}, {
    '.quran-passage-section .ayah.ayah-selected[data-quran-ref]': selected,
    '.quran-passage-section .ayah[data-quran-ref]': first
  });
  expect(context.quranReaderModeFirstRef(study)).toBe('2:255');
});
