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
test('repeated saves defer list and tag reloads while the modal is visible', () => {
  const ctx = vm.createContext({ list: {}, modal: { classList: { contains: () => true } }, loadList: jest.fn(), loadTags: jest.fn(), listNeedsRefresh: false });
  vm.runInContext(source.match(/  function updateList\([^]*?\n  }/)[0], ctx);
  ctx.updateList(result('one').note); ctx.updateList(result('two').note);
  expect(ctx.loadList).not.toHaveBeenCalled(); expect(ctx.loadTags).not.toHaveBeenCalled();
  expect(ctx.listNeedsRefresh).toBe(true);
});
test('closing the modal refreshes the list once after multiple saved edits', () => {
  const ctx = vm.createContext({ listNeedsRefresh: true, wikiAutocomplete: { close: jest.fn() }, clearTimeout: jest.fn(), saveTimer: null, loadList: jest.fn(), loadTags: jest.fn(), returnModal: null, modal: { addEventListener: jest.fn() } });
  vm.runInContext(source.match(/  modal.addEventListener\('hidden.bs.modal', \(\) => \{[^]*?\n  \}\);/)[0], ctx);
  const close = ctx.modal.addEventListener.mock.calls[0][1]; close(); close();
  expect(ctx.loadList).toHaveBeenCalledTimes(1); expect(ctx.loadTags).toHaveBeenCalledTimes(1);
});
