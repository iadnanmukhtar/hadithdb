'use strict';
const fs = require('fs'), vm = require('vm');
const source = fs.readFileSync(require.resolve('../public/static/js/notebook.js'), 'utf8');
const renderList = source.match(/  function renderList\([^]*?\n  }/)[0];
function render(notes, query = '') {
  const tiles = [];
  const fields = { 'notebook-search': { value: query }, 'notebook-tag': { value: '' } };
  const context = vm.createContext({ notes, list: { replaceChildren: () => tiles.splice(0), append: tile => tiles.push(tile) },
    listStatus: {}, document: { getElementById: id => fields[id] }, createNoteTile: note => note });
  vm.runInContext(renderList, context); context.renderList();
  return tiles;
}
test('renders the API order without promoting the original general note', () => {
  const notes = [{ source_key: 'item:42' }, { source_key: 'general:new' }, { source_key: 'general' }];
  expect(render(notes)).toEqual(notes);
  expect(render(notes, 'search')).toEqual(notes);
});
test('does not insert a phantom general note when it belongs on a later page', () => {
  const notes = [{ source_key: 'item:42' }, { source_key: 'general:new' }];
  expect(render(notes)).toEqual(notes);
  expect(render([])).toMatchObject([{ source_key: 'general', version: 0 }]);
  expect(render([], 'search')).toEqual([]);
});
