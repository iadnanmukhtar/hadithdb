'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

test('Mushaf refits when print media applies after beforeprint, then restores screen fitting', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/static/js/script.js'), 'utf8');
  const start = source.indexOf('function initQuranMushafLineFitting(');
  const end = source.indexOf('function quranMushafAyahSelection', start);
  const events = {}, mediaEvents = {};
  const document = { documentElement: { dataset: {} } };
  const fit = jest.fn(), schedule = jest.fn();
  const context = {
    document, fitQuranMushafLines: fit, scheduleQuranMushafLineFit: schedule,
    window: {
      addEventListener: (name, handler) => { events[name] = handler; },
      matchMedia: query => {
        expect(query).toBe('print');
        return { addEventListener: (name, handler) => { mediaEvents[name] = handler; } };
      }
    }
  };
  vm.runInNewContext(source.slice(start, end) + ';initQuranMushafLineFitting(document);', context);
  events.beforeprint();
  expect(fit).toHaveBeenCalledTimes(1);
  mediaEvents.change({ matches: true });
  expect(fit).toHaveBeenCalledTimes(2);
  expect(fit).toHaveBeenLastCalledWith(document);
  schedule.mockClear();
  mediaEvents.change({ matches: false });
  expect(schedule).toHaveBeenCalledWith(document);
  schedule.mockClear();
  events.afterprint();
  expect(schedule).toHaveBeenCalledWith(document);
});

describe('Current address-bar print selection', () => {
  function reader(html, url) {
    const { JSDOM } = require('jsdom');
    const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
    dom.window.matchMedia = () => ({ addEventListener() {} });
    const source = fs.readFileSync(path.join(__dirname, '../public/static/js/script.js'), 'utf8');
    dom.window.eval(source.slice(source.indexOf('function initReaderPrintSelection('), source.indexOf('function initQuranMushafLineFitting(')));
    dom.window.initReaderPrintSelection();
    return dom;
  }
  test.each(['tafsir', 'hadith-sharh', 'hadith-section', 'hadith-sirah-reader'])('%s prints the history-selected passage and restores the DOM', mode => {
    const dom = reader(`<main data-reader-infinite="${mode}" data-reader-current-url="/book/1"><header class="row major" id="chapter">Chapter</header><article id="original">Original</article><section class="reader-infinite-page" data-reader-infinite-page="1" data-reader-url="/book/2" id="current"><section class="breadcrumbs">Current breadcrumb</section><article>Current</article></section><section data-reader-infinite-page="1" data-reader-url="/book/3" id="next">Next</section></main>`, 'https://example.com/book/1');
    const w = dom.window, d = w.document;
    try {
      w.history.pushState({}, '', '/book/2#anchor');
      w.dispatchEvent(new w.Event('beforeprint'));
      expect(d.querySelector('[data-reader-print-current]').id).toBe('current');
      expect(d.getElementById('original').hasAttribute('data-reader-print-exclude')).toBe(true);
      expect(d.getElementById('next').hasAttribute('data-reader-print-exclude')).toBe(true);
      expect(d.querySelector('#current [data-reader-print-context]').textContent).toBe('Chapter');
      expect(d.querySelectorAll('#chapter')).toHaveLength(1);
      expect(w.location.pathname).toBe('/book/2');
      w.dispatchEvent(new w.Event('afterprint'));
      expect(d.querySelector('[data-reader-print-exclude], [data-reader-print-current], [data-reader-print-context]')).toBeNull();
      w.history.replaceState({}, '', '/book/1');
      w.dispatchEvent(new w.Event('beforeprint'));
      expect(d.getElementById('original').hasAttribute('data-reader-print-exclude')).toBe(false);
      expect(d.getElementById('current').hasAttribute('data-reader-print-exclude')).toBe(true);
    } finally { w.close(); }
  });
  test('Mushaf prints only the page in the current URL, including an ayah selection', () => {
    const dom = reader('<main data-quran-mushaf-reader><article data-quran-infinite-page="1" data-quran-mushaf-page="50"></article><article data-quran-infinite-page="1" data-quran-mushaf-page="51"></article><article data-quran-infinite-page="1" data-quran-mushaf-page="52"></article></main>', 'https://example.com/quran/page/50');
    try {
      dom.window.history.replaceState({}, '', '/quran/page/51?ayah=3:10');
      dom.window.dispatchEvent(new dom.window.Event('beforeprint'));
      expect(dom.window.document.querySelector('[data-reader-print-current]').dataset.quranMushafPage).toBe('51');
      expect(dom.window.document.querySelectorAll('[data-reader-print-exclude]')).toHaveLength(2);
    } finally { dom.window.close(); }
  });
  test('Quran ayah selection resolves to its loaded passage, not the original passage', () => {
    const dom = reader('<main data-quran-infinite-passage="1" data-quran-current-url="/quran/2/1"><article data-quran-ref="2:1">Original</article><section data-quran-infinite-page="1" data-quran-url="/quran/2/2" id="selected"><span data-quran-ref="2:8">Selected</span></section></main>', 'https://example.com/quran:2:8');
    try {
      dom.window.dispatchEvent(new dom.window.Event('beforeprint'));
      expect(dom.window.document.querySelector('[data-reader-print-current]').id).toBe('selected');
    } finally { dom.window.close(); }
  });
});
