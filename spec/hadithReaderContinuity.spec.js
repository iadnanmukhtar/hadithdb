'use strict';
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync(require.resolve('../public/static/js/script.js'), 'utf8');
function loadFunction(name, scope) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf('\nfunction ', start + 1);
  vm.runInContext(source.slice(start, end), scope);
}
function target(attributes, top) {
  return {
    getAttribute: key => attributes[key] || '',
    hasAttribute: key => key in attributes,
    getBoundingClientRect: () => ({ top }),
    closest: () => ({ getAttribute: () => 'riyad:introduction' })
  };
}
test('the visible heading returns to the introduction when scrolling upward', () => {
  const article = target({ 'data-quran-introduction-target': '1' }, -50);
  let headingTop = 200;
  const heading = target({ 'data-hadith-heading-key': 'riyad:0.01', 'data-hadith-heading-context': 'riyad:flat' }, 0);
  heading.getBoundingClientRect = () => ({ top: headingTop });
  const scope = vm.createContext({ window: { innerHeight: 1000 }, document: {
    querySelector: () => ({}), querySelectorAll: () => [article, heading]
  } });
  loadFunction('visibleHadithHeading', scope);
  expect(scope.visibleHadithHeading().key).toBe('riyad:0.01');
  headingTop = 400;
  expect(scope.visibleHadithHeading()).toEqual({ context: 'riyad:introduction', introduction: '1' });
});
test('restores the introduction rail and clears stale section selection', () => {
  const link = { getAttribute: () => '1', classList: { toggle: jest.fn() }, setAttribute: jest.fn() };
  const toc = { innerHTML: 'chapter rail', querySelectorAll: () => [link] };
  const scope = vm.createContext({ visibleHadithHeading: () => ({ context: 'book:introduction', introduction: '1' }),
    hadithHeadingTocState: { toc, context: 'book:0', activeKey: 'book:0.1' },
    hadithIntroductionRailRegistry: { 'book:introduction': 'original introduction rail' } });
  loadFunction('updateHadithHeadingToc', scope);
  scope.updateHadithHeadingToc();
  expect(toc.innerHTML).toBe('original introduction rail');
  expect(scope.hadithHeadingTocState.activeKey).toBe('');
  expect(link.setAttribute).toHaveBeenCalledWith('aria-current', 'location');
});
test.each([['hadith-section', 'hadith-chapter'], ['hadith-chapter', 'hadith-section']])('accepts %s to %s transitions and still deduplicates canonical responses', (mode, remoteMode) => {
  const start = source.indexOf('var appendReaderPage = function');
  const end = source.indexOf('var loadNext = function', start);
  const scope = vm.createContext({ mode, loadedUrls: new Set(['/book/0.01']),
    normalizeReaderInfiniteUrl: value => value, registerHadithHeadingOutlines: jest.fn(), main: { removeAttr: jest.fn() },
    DOMParser: class { parseFromString() { return { querySelectorAll: () => [{ getAttribute: key => ({
      'data-reader-infinite': remoteMode, 'data-reader-current-url': '/book/0.01'
    })[key] }] }; } }
  });
  vm.runInContext(source.slice(start, end), scope);
  expect(scope.appendReaderPage('', '/book/alias')).toBeNull();
  expect(scope.exhausted).toBe(true);
});

 test.each(['same-book', 'other-book'])('sharh reader validates book identity for %s responses', alias => {
  const start = source.indexOf('var appendReaderPage = function');
  const end = source.indexOf('var loadNext = function', start);
  const scope = vm.createContext({ mode: 'hadith-sharh', loadedUrls: new Set(['/sharh/same-book/bukhari:1']),
    normalizeReaderInfiniteUrl: value => value, registerHadithHeadingOutlines: jest.fn(),
    main: { attr: () => 'same-book', removeAttr: jest.fn() },
    DOMParser: class { parseFromString() { return { querySelectorAll: () => [{ getAttribute: key => ({
      'data-reader-infinite': 'hadith-sharh', 'data-reader-sharh-book': alias,
      'data-reader-current-url': '/sharh/same-book/bukhari:1'
    })[key] }] }; } }
  });
  vm.runInContext(source.slice(start, end), scope);
  if (alias === 'other-book') expect(() => scope.appendReaderPage('', '/next')).toThrow('different sharh');
  else expect(scope.appendReaderPage('', '/next')).toBeNull();
 });

test('long sharh pages do not prefetch until the next passage approaches the viewport', async () => {
 const start = source.indexOf('var ensureLoadedAhead = function', source.indexOf('function initReaderInfiniteNavigation('));
 const end = source.indexOf('\n\t\tif (window.IntersectionObserver)', start);
 let top = 10000;
 const loadNext = jest.fn().mockResolvedValue(false);
 const scope = vm.createContext({mode:'hadith-sharh',sentinel:[{getBoundingClientRect:()=>({top})}],
  window:{innerHeight:800,requestAnimationFrame:jest.fn()},ensuring:false,exhausted:false,nextUrl:'/next',
  pagesAhead:()=>0,prefetchAhead:1,loadNext,scheduleInfiniteWork:jest.fn()});
 vm.runInContext(source.slice(start,end),scope);
 scope.ensureLoadedAhead();
 expect(loadNext).not.toHaveBeenCalled();
 top=2500;
 scope.ensureLoadedAhead();
 await Promise.resolve();
 expect(loadNext).toHaveBeenCalledTimes(1);
});
