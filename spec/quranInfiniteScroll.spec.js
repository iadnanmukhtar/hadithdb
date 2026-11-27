'use strict';

const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync(require.resolve('../public/static/js/script.js'), 'utf8');

test('Quran scrolling detects when another passage is needed without a hadith reader mode', () => {
  const readerStart = source.indexOf('function initQuranInfinitePassageNavigation(root)');
  const start = source.indexOf('function currentPageIndex()', readerStart);
  const end = source.indexOf('var setMobileBottomNavLink = function', start);
  const window = { pageYOffset: 0, innerHeight: 1000 };
  const marker = top => ({ getBoundingClientRect: () => ({ top: top - window.pageYOffset }) });
  const markers = [marker(0)];
  const context = {
    window,
    markers
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);

  expect(context.currentPageIndex()).toBe(0);
  expect(context.pagesAhead()).toBe(0);
  markers.push(marker(2000));
  expect(context.pagesAhead()).toBe(1);
  window.pageYOffset = 1350;
  expect(context.currentPageIndex()).toBe(1);
  expect(context.pagesAhead()).toBe(0);
  markers.push(marker(4000));
  expect(context.pagesAhead()).toBe(1);
  window.pageYOffset = 0;
  expect(context.currentPageIndex()).toBe(0);
  expect(context.pagesAhead()).toBe(2);
});
