'use strict';

const fs = require('fs');
const path = require('path');

describe('search results infinite scroll', () => {
  const template = fs.readFileSync(path.join(__dirname, '..', 'views', 'search.ejs'), 'utf8');
  const scripts = fs.readFileSync(path.join(__dirname, '..', 'public', 'static', 'js', 'script.js'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'public', 'static', 'css', 'style.css'), 'utf8');

  test('publishes the current and next result-page URLs with an append-only result scope', () => {
    expect(template).toContain('data-search-infinite="1"');
    expect(template).toContain('data-search-current-url=');
    expect(template).toContain('data-search-next-url=');
    expect(template).toContain('data-search-results-page="1"');
    expect(template).toContain('data-search-infinite-status');
    expect(template).toContain('data-search-infinite-sentinel');
  });

  test('loads Hadith and Quran result pages through their infinite-scroll API mounts', () => {
    expect(scripts).toContain('initSearchInfiniteScroll(document);');
    expect(scripts).toContain('function searchInfiniteApiUrl(targetUrl)');
    expect(scripts).toContain("return quranApiPath(`/${parsed.search}`);");
    expect(scripts).toContain('searchInfiniteLoadNext = loadNext');
    expect(scripts).toContain("new IntersectionObserver(function (entries)");
    expect(scripts).toContain("showInfiniteLoadFailure(status");
  });

  test('uses the shared infinite-page, status, and sentinel presentation', () => {
    expect(styles).toContain('.search-infinite-page');
    expect(styles).toContain('.search-infinite-status');
    expect(styles).toContain('.search-infinite-sentinel');
  });
});
