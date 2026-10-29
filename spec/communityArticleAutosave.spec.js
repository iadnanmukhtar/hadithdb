'use strict';
const fs = require('fs'), vm = require('vm');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(require.resolve('../public/static/js/community.js'), 'utf8');
const names = ['payload', 'signature', 'scheduleArticleSave', 'invalidatePreview', 'save', 'performArticleSave'];
const functions = names.map(name => {
  const start = source.search(new RegExp(`  (?:async )?function ${name}\\(`));
  const lineEnd = source.indexOf('\n', start);
  return source.slice(start, source[lineEnd - 1] === '}' ? lineEnd : source.indexOf('\n  }', lineEnd) + 4);
}).join('\n');
function harness() {
  const dom = new JSDOM('<form id="editor-form"><input id="kind" value="article"><input id="title" required value="Title"><input id="subtitle"><input id="cover-url"><textarea id="markdown" required>Original body</textarea><input id="tags"></form><button id="publish"></button><button id="delete"></button><button id="unpublish"></button><div id="preview-panel"></div><div id="editor-status"></div>');
  const $ = id => dom.window.document.getElementById(id);
  const ctx = vm.createContext({ $, view: 'write', me: {}, dirty: false, editing: {id: 3, version: 1, status: 'published'}, epoch: 1,
    savingPost: false, articleSaveTask: null, articleSaveTimer: null, previewSignature: null,
    window: {}, setTimeout, clearTimeout, URL, location: {href: 'https://example.test/community/write?post=3'}, history: {replaceState: jest.fn()},
    api: jest.fn(), populate: jest.fn(), renderEditorBlog: jest.fn(), status: jest.fn() });
  vm.runInContext(functions, ctx);
  ctx.api.mockImplementation(async () => ({post: {id: 3, version: 2, status: 'published'}}));
  return {ctx, $};
}
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());
test('debounces edits into a private draft save without repopulating the editor', async () => {
  const {ctx, $} = harness();
  $('markdown').setSelectionRange(2, 5, 'backward'); $('markdown').scrollTop = 60;
  ctx.invalidatePreview(); await jest.advanceTimersByTimeAsync(1000);
  ctx.invalidatePreview(); await jest.advanceTimersByTimeAsync(1799); expect(ctx.api).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(1);
  expect(ctx.api).toHaveBeenCalledWith('/posts/3', 'PUT', expect.objectContaining({action:'draft', version:1}));
  expect(ctx.populate).not.toHaveBeenCalled(); expect(ctx.dirty).toBe(false);
  expect([$('markdown').selectionStart, $('markdown').selectionEnd, $('markdown').scrollTop]).toEqual([2,5,60]);
});
test('saves newer edits after an in-flight save with the updated version', async () => {
  const {ctx, $} = harness(); let resolve;
  ctx.api.mockImplementationOnce(() => new Promise(r => {resolve=r;}));
  ctx.invalidatePreview(); await jest.advanceTimersByTimeAsync(1800);
  $('markdown').value = 'Newer body'; ctx.invalidatePreview();
  await jest.advanceTimersByTimeAsync(1800);
  resolve({post: {id:3, version:2, status:'published'}}); await jest.advanceTimersByTimeAsync(1800);
  expect(ctx.api).toHaveBeenCalledTimes(2);
  expect(ctx.api.mock.calls[1][2]).toMatchObject({markdown:'Newer body', version:2, action:'draft'});
  expect($('markdown').value).toBe('Newer body');
});
test('manual publish waits for autosave and uses its version', async () => {
  const {ctx} = harness(); let resolve;
  ctx.api.mockImplementationOnce(() => new Promise(r => {resolve=r;}));
  ctx.invalidatePreview(); await jest.advanceTimersByTimeAsync(1800);
  const publish = ctx.save('publish');
  expect(ctx.api).toHaveBeenCalledTimes(1);
  resolve({post:{id:3, version:2, status:'published'}}); await publish;
  expect(ctx.api.mock.calls[1][2]).toMatchObject({action:'publish',version:2});
});
test('failed save leaves draft dirty and reports failure without an automatic retry loop', async () => {
  const {ctx, $} = harness(); ctx.api.mockRejectedValue(new Error('Offline'));
  ctx.invalidatePreview(); await jest.advanceTimersByTimeAsync(10000);
  expect(ctx.dirty).toBe(true); expect(ctx.api).toHaveBeenCalledTimes(1);
  expect($('editor-status').textContent).toBe('Not saved: Offline');
});
test('incomplete fields wait for further editing without a validation popup', async () => {
  const {ctx, $} = harness(); $('title').value='';
  ctx.invalidatePreview(); await jest.advanceTimersByTimeAsync(1800);
  expect(ctx.api).not.toHaveBeenCalled(); expect(ctx.dirty).toBe(true);
});
test('uploads defer autosave until completion', async () => {
  const {ctx} = harness(); ctx.window.communityMediaPending=1;
  ctx.invalidatePreview(); await jest.advanceTimersByTimeAsync(1800); expect(ctx.api).not.toHaveBeenCalled();
  ctx.window.communityMediaPending=0; await jest.advanceTimersByTimeAsync(1800); expect(ctx.api).toHaveBeenCalledTimes(1);
});
test('reference expansion during a slow autosave is preserved and saved next', async () => {
  const {ctx, $} = harness();
  const editor = $('markdown'), win = editor.ownerDocument.defaultView;
  ctx.document = editor.ownerDocument; ctx.Event = win.Event;
  vm.runInContext(source.match(/  function installReferenceExpansion\([^]*?\n  }/)[0], ctx);
  editor.addEventListener('input', ctx.invalidatePreview);
  ctx.installReferenceExpansion(editor, () => !!ctx.me);
  let finishSave;
  ctx.api.mockImplementationOnce(() => new Promise(r => { finishSave = r; }));
  ctx.invalidatePreview(); await jest.advanceTimersByTimeAsync(1800);
  ctx.api.mockResolvedValueOnce({edits:[{start:0,end:11,text:'Expanded Arabic and English'}]});
  editor.value='bukhari:100\n'; editor.setSelectionRange(12,12);
  editor.dispatchEvent(new win.InputEvent('input',{inputType:'insertLineBreak',bubbles:true}));
  await jest.advanceTimersByTimeAsync(0);
  expect(ctx.api.mock.calls[1]?.[0]).toBe('/auto-expand');
  expect(editor.value).toBe('Expanded Arabic and English\n');
  finishSave({post:{id:3,version:2,status:'published'}});
  await jest.advanceTimersByTimeAsync(1800);
  expect(ctx.api.mock.calls[2][2]).toMatchObject({markdown:'Expanded Arabic and English\n',version:2,action:'draft'});
});
test('a late save cannot replace another account state', async () => {
  const {ctx} = harness(); let resolve;
  ctx.api.mockImplementationOnce(() => new Promise(r => {resolve=r;}));
  ctx.invalidatePreview(); await jest.advanceTimersByTimeAsync(1800);
  ctx.epoch++; ctx.editing=null; ctx.dirty=false;
  resolve({post:{id:3,version:2,status:'published'}}); await jest.advanceTimersByTimeAsync(1800);
  expect(ctx.editing).toBe(null); expect(ctx.history.replaceState).not.toHaveBeenCalled();
});
