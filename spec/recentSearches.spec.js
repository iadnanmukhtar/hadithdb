'use strict';

const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const script = fs.readFileSync('public/static/js/script.js', 'utf8');
const initialize = script.slice(script.indexOf('function initRecentSearches()'), script.indexOf('function initSearchInfiniteScroll('));

test('replays full queries and filters, deduplicates pagination and bounds the history', () => {
  const dom = new JSDOM('<nav data-recent-searches hidden><ul></ul></nav>', {url: 'https://example.org/', runScripts: 'outside-only'});
  const w = dom.window;
  const visit = path => {
    w.history.replaceState(null, '', path);
    w.eval(initialize + ';initRecentSearches()');
    return [...w.document.querySelectorAll('nav a')];
  };
  try {
    const query = 'الصلاة والسلام '.repeat(12);
    const params = new URLSearchParams({q: query, b: 'translations', sort: 'canonical', o: '10'});
    expect(visit('/quran?' + params)).toHaveLength(0);
    const [previous] = visit('/?q=mercy');
    expect(previous.textContent).toBe(query);
    expect(previous.title).toContain(query);
    const url = new URL(previous.href);
    expect(url.pathname).toBe('/quran');
    expect(url.searchParams.get('q')).toBe(query);
    expect(url.searchParams.get('sort')).toBe('canonical');
    expect(url.searchParams.get('b')).toBe('translations');
    expect(url.searchParams.has('o')).toBe(false);
    expect(visit('/?q=mercy&o=20')).toHaveLength(1);
    w.localStorage.setItem('hadithdb.recentSearches.v1', JSON.stringify([
      '/quran?q=Signs+of+Mercy&b=tafsir', '/?q=SIGNS++OF+MERCY&b=hadith',
      '/?q=prayer', '/quran?q=PRAYER', '/?q=patience'
    ]));
    const recent = visit('/?q=+prayer+&b=muslim');
    expect(recent.map(a => a.textContent)).toEqual(['Signs of Mercy', 'patience']);
    expect(recent[0].getAttribute('href')).toBe('/quran?q=Signs+of+Mercy&b=tafsir');
    expect(visit('/?q=patience')[0].getAttribute('href')).toBe('/?q=+prayer+&b=muslim');
    for (let i = 0; i < 8; i++) visit('/?q=term' + i);
    expect(visit('/?q=last').map(a => a.textContent)).toEqual(['term7','term6','term5','term4','term3']);
  } finally { w.close(); }
});
