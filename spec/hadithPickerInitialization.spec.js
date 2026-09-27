'use strict';
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync(require.resolve('../views/sub-views/scripts.ejs'), 'utf8');

test('reader chunk initialization also binds its hadith pickers', () => {
  const empty = { find() { return this; }, addBack() { return this; }, each() { return this; } };
  const bindHadithSimilarSearch = jest.fn();
  const context = { $: () => empty, bindHadithSimilarSearch };
  const start = source.indexOf('const bindInlineEditors =');
  const end = source.indexOf('const bindHadithGradeSorting =', start);
  vm.runInNewContext(source.slice(start, end) + '\nthis.bind = bindInlineEditors;', context);
  const chunk = { name: 'new reader page' };
  context.bind(chunk);
  expect(bindHadithSimilarSearch).toHaveBeenCalledWith(chunk);
});

test('a dynamically inserted standalone picker is initialized without an inline text editor', () => {
  let observeMutations;
  const picker = { nodeType: 1 };
  const text = { nodeType: 3 };
  const context = {
    document: { body: {} }, Node: { ELEMENT_NODE: 1 }, bindInlineEditors: jest.fn(),
    $: () => ({ is: selector => selector.includes('[data-hadith-similar-search]'), find: () => ({ length: 0 }) }),
    MutationObserver: class { constructor(callback) { observeMutations = callback; } observe() {} }
  };
  const start = source.indexOf('const inlineEditorObserver =');
  const end = source.indexOf('bindAdminContentTranslationSwitchers(document);', start);
  vm.runInNewContext(source.slice(start, end), context);
  observeMutations([{ addedNodes: [text, picker] }]);
  expect(context.bindInlineEditors).toHaveBeenCalledTimes(1);
  expect(context.bindInlineEditors).toHaveBeenCalledWith(picker);
});
