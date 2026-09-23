'use strict';
const fs = require('fs'), vm = require('vm');
const source = fs.readFileSync(require.resolve('../public/static/js/notebook.js'), 'utf8');
const functions = ['dirty', 'scheduleSave', 'save', 'showPreview', 'saveAndPreview'].map(name => source.match(new RegExp(`  (?:async )?function ${name}\\([^]*?\\n  }`))[0]).join('\n');
function harness() {
  const ctx = vm.createContext({
    current: { source_key: 'general', title: 'Title', markdown: 'Before', version: '1' },
    editor: { value: 'After' }, titleEditor: { value: 'Title' }, tagEditor: { value: '' },
    savedText: 'Before', savedTitle: 'Title', savedTags: '', busy: false, saving: null,
    saveTimer: null, generation: 1, editing: true, status: { textContent: '' },
    deleteButton: {}, preview: {}, setTimeout, clearTimeout,
    api: jest.fn(), renderNoteTags: jest.fn(), renderNoteMetadata: jest.fn(),
    markSource: jest.fn(), updateList: jest.fn(), renderPreview: jest.fn(),
    mode: jest.fn()
  });
  vm.runInContext(functions, ctx); return ctx;
}
const result = markdown => ({ note: { source_key: 'general', title: 'Title', markdown, version: '2', html: markdown } });
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());
test('click-away preview is immediate and saving is debounced', async () => {
  const ctx = harness(); ctx.api.mockResolvedValue(result('After'));
  ctx.showPreview();
  expect(ctx.mode).toHaveBeenCalledWith(false); expect(ctx.renderPreview).toHaveBeenCalled();
  expect(ctx.api).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(1000); ctx.editor.value = 'Latest'; ctx.scheduleSave();
  await jest.advanceTimersByTimeAsync(1799); expect(ctx.api).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(1); expect(ctx.api).toHaveBeenCalledTimes(1);
  expect(ctx.api.mock.calls[0][2].markdown).toBe('Latest');
});
test('typing during a slow background save coalesces into a later save', async () => {
  const ctx = harness(); let resolve;
  ctx.api.mockImplementationOnce(() => new Promise(r => { resolve = r; })).mockResolvedValue(result('Latest'));
  const pending = ctx.save(true);
  ctx.editor.value = 'Latest'; resolve(result('After')); await pending;
  expect(ctx.editor.value).toBe('Latest'); expect(ctx.api).toHaveBeenCalledTimes(1);
  expect(ctx.updateList).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(1800);
  expect(ctx.api).toHaveBeenCalledTimes(2); expect(ctx.savedText).toBe('Latest');
  expect(ctx.updateList).toHaveBeenCalledTimes(2);
});
test('explicit save flushes newer edits after an in-flight background save', async () => {
  const ctx = harness(); let resolve;
  ctx.api.mockImplementationOnce(() => new Promise(r => { resolve = r; })).mockResolvedValue(result('Latest'));
  const pending = ctx.save(true); ctx.editor.value = 'Latest'; const flush = ctx.save();
  resolve(result('After')); await pending; expect(await flush).toBe(true);
  expect(ctx.savedText).toBe('Latest'); expect(ctx.api).toHaveBeenCalledTimes(2);
});
test('failed background saves retain the draft and show the error without a retry loop', async () => {
  const ctx = harness(); ctx.api.mockRejectedValue(Error('Offline'));
  expect(await ctx.save(true)).toBe(false);
  expect(ctx.editor.value).toBe('After'); expect(ctx.savedText).toBe('Before');
  expect(ctx.status.textContent).toBe('Offline');
  await jest.advanceTimersByTimeAsync(10000); expect(ctx.api).toHaveBeenCalledTimes(1);
});

test('Save button switches to preview before its slow save completes', async () => {
  const ctx = harness(); let resolve;
  ctx.api.mockImplementation(() => new Promise(r => { resolve = r; }));
  const pending = ctx.saveAndPreview();
  expect(ctx.mode).toHaveBeenCalledWith(false);
  expect(ctx.renderPreview).toHaveBeenCalled();
  expect(ctx.api).toHaveBeenCalledTimes(1);
  resolve(result('After')); expect(await pending).toBe(true);
});
function listHarness() {
  const before = { ...result('Before').note, source_key: 'general:one', hashtags: ['old'] };
  const untouched = { ...result('Unchanged').note, source_key: 'general:two' };
  const children = [];
  const list = { children, prepend: tile => children.unshift(tile), get childElementCount() { return children.length; } };
  const createNoteTile = note => ({
    dataset: { sourceKey: note.source_key }, note,
    replaceWith(next) { children.splice(children.indexOf(this), 1, next); },
    remove() { children.splice(children.indexOf(this), 1); }
  });
  children.push(createNoteTile(before), createNoteTile(untouched));
  const fields = { 'notebook-search': {value: ''}, 'notebook-tag': {value: ''} };
  const ctx = vm.createContext({ list, notes: [before, untouched], listStatus: {}, createNoteTile: jest.fn(createNoteTile), document: {getElementById: id => fields[id]}, loadList: jest.fn(), loadTags: jest.fn(), hasMore: true });
  vm.runInContext(source.match(/  function updateList\([^]*?\n  }/)[0], ctx);
  return {ctx, fields, children, before};
}
test('saving replaces only the affected card without reloading loaded pages', () => {
  const {ctx, children, before} = listHarness();
  const sibling = children[1];
  const saved = {...before, title: 'Updated', markdown: 'Latest', html: '<p>Latest</p>'};
  ctx.updateList(saved);
  expect(ctx.notes[0]).toBe(saved); expect(ctx.notes).toHaveLength(2);
  expect(children[0].note).toBe(saved); expect(children[1]).toBe(sibling);
  expect(ctx.loadList).not.toHaveBeenCalled(); expect(ctx.loadTags).not.toHaveBeenCalled();
  expect(ctx.hasMore).toBe(true);
});
test('tag changes remove a card from its active filter without reloading the list', () => {
  const {ctx, fields, children, before} = listHarness();
  fields['notebook-tag'].value = 'old';
  ctx.updateList({...before, hashtags: ['new']});
  expect(ctx.notes.map(note => note.source_key)).toEqual(['general:two']);
  expect(children).toHaveLength(1); expect(ctx.loadTags).toHaveBeenCalledTimes(1);
  expect(ctx.loadList).not.toHaveBeenCalled();
});
test('new notes and deletions update cards locally', () => {
  const {ctx, children} = listHarness();
  const saved = {...result('New').note, source_key: 'general:new'};
  ctx.updateList(saved);
  expect(children[0].note).toBe(saved); expect(ctx.notes).toHaveLength(3);
  ctx.updateList({...saved, version: 0});
  expect(children).toHaveLength(2); expect(ctx.notes).toHaveLength(2);
  expect(ctx.loadList).not.toHaveBeenCalled();
});
test('closing the modal does not reload the list or tags', () => {
  const ctx = vm.createContext({ changingPresentation: false, restoreButton: {}, floatingStorage: 'floating', sessionStorage: { removeItem: jest.fn() }, wikiAutocomplete: { close: jest.fn() }, clearTimeout: jest.fn(), saveTimer: null, loadList: jest.fn(), loadTags: jest.fn(), returnModal: null, modal: { classList: { remove: jest.fn() }, addEventListener: jest.fn() } });
  vm.runInContext(source.match(/  modal.addEventListener\('hidden.bs.modal', \(\) => \{[^]*?\n  \}\);/)[0], ctx);
  const close = ctx.modal.addEventListener.mock.calls[0][1]; close(); close();
  expect(ctx.loadList).not.toHaveBeenCalled(); expect(ctx.loadTags).not.toHaveBeenCalled();
});
