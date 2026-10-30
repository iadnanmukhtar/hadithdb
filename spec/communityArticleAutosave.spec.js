'use strict';
const fs = require('fs'), vm = require('vm');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(require.resolve('../public/static/js/community.js'), 'utf8');
const names = ['payload', 'signature', 'scheduleArticleSave', 'invalidatePreview', 'save', 'performArticleSave', 'closeArticle', 'stageShortPostConversion'];
const functions = names.map(name => {
  const start = source.search(new RegExp(`  (?:async )?function ${name}\\(`));
  const lineEnd = source.indexOf('\n', start);
  return source.slice(start, source[lineEnd - 1] === '}' ? lineEnd : source.indexOf('\n  }', lineEnd) + 4);
}).join('\n');
function harness() {
  const dom = new JSDOM('<form id="editor-form"><input id="kind" value="article"><input id="title" required value="Title"><input id="subtitle"><input id="cover-url"><textarea id="markdown" required>Original body</textarea><input id="tags"></form><button id="publish"></button><button id="delete"></button><button id="unpublish"></button><div id="preview-panel"></div><div id="editor-status"></div>');
  const $ = id => dom.window.document.getElementById(id);
  const ctx = vm.createContext({ $, view: 'write', me: {}, dirty: false, editing: {id: 3, version: 1, status: 'published'}, epoch: 1,
    savingPost: false, articleReturnUrl: false, articleSaveTask: null, articleSaveTimer: null, previewSignature: null,
    window: {confirm: jest.fn(() => true)}, document: dom.window.document, setTimeout, clearTimeout, URL, location: {href: 'https://example.test/community/write?post=3', origin: 'https://example.test', pathname: '/community/write', assign: jest.fn()}, history: {replaceState: jest.fn(), back: jest.fn(), length: 2},
    sessionStorage: {removeItem: jest.fn(),setItem:jest.fn()}, api: jest.fn(), populate: jest.fn(() => { ctx.dirty = false; }), renderEditorBlog: jest.fn(), status: jest.fn() });
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

test.each(['published', 'pending'])('successful %s new publication returns to My Profile', async status => {
  const {ctx} = harness();
  ctx.api.mockResolvedValue({post: {id:3, version:2, status}});
  ctx.editing=null;
  await ctx.save('publish');
  expect(ctx.location.assign).toHaveBeenCalledWith('/community/mine');
});
test('failed publish stays in the editor', async () => {
  const {ctx} = harness(); ctx.api.mockRejectedValue(new Error('Offline'));
  await expect(ctx.save('publish')).rejects.toThrow('Offline');
  expect(ctx.location.assign).not.toHaveBeenCalled();
});
test('cancel returns to the originating page through history', () => {
  const {ctx} = harness();
  ctx.document = {referrer: 'https://example.test/community/following'};
  ctx.closeArticle();
  expect(ctx.history.back).toHaveBeenCalled();
});
test('cancel from a direct entry falls back to My Profile', () => {
  const {ctx} = harness(); ctx.closeArticle();
  expect(ctx.location.assign).toHaveBeenCalledWith('/community/mine');
});
test('declining to discard unsaved changes keeps the editor open', () => {
  const {ctx} = harness(); ctx.dirty=true; ctx.window.confirm.mockReturnValue(false);
  ctx.closeArticle();
  expect(ctx.dirty).toBe(true);
  expect(ctx.location.assign).not.toHaveBeenCalled();
  expect(ctx.history.back).not.toHaveBeenCalled();
});

test('edits made during an update save before returning to the reading view', async () => {
  const {ctx, $} = harness(); let finish;
  ctx.api.mockImplementationOnce(() => new Promise(resolve => { finish=resolve; }));
  const publishing=ctx.save('publish');
  $('markdown').value='A newer edit'; ctx.invalidatePreview();
  finish({post:{id:3,version:2,status:'published'}}); await publishing;
  expect(ctx.location.assign).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(1800);
  expect(ctx.api.mock.calls[1][2]).toMatchObject({action:'draft',markdown:'A newer edit',version:2});
  expect(ctx.location.assign).toHaveBeenCalledWith('/community/p/3');
});

 test('conversion edits and cancellation leave the published post untouched', async () => {
  const {ctx, $} = harness(); ctx.editing.conversionPending=true;
  $('markdown').value='Proposed article'; ctx.invalidatePreview();
  await jest.advanceTimersByTimeAsync(10000);
  await ctx.save('draft',true);
  expect(ctx.api).not.toHaveBeenCalled();
  ctx.closeArticle();
  expect(ctx.api).not.toHaveBeenCalled();
  expect(ctx.sessionStorage.removeItem).toHaveBeenCalledWith('community-convert-3');
  expect(ctx.location.assign).toHaveBeenCalledWith('/community/mine');
 });
 test.each(['draft','publish'])('explicit %s commits the staged conversion', async action => {
  const {ctx} = harness(); ctx.editing.conversionPending=true;
  await ctx.save(action);
  expect(ctx.api).toHaveBeenCalledWith('/posts/3','PUT',expect.objectContaining({convertToArticle:true,kind:'article',version:1,action}));
  expect(ctx.sessionStorage.removeItem).toHaveBeenCalledWith('community-convert-3');
 });

test('opening short-post conversion stages editor text without saving the article', async () => {
 const {ctx,$}=harness();ctx.me={author:{handle:'writer'}};
 $('subtitle').value='Introduction';$('markdown').value='Full article';ctx.invalidatePreview();
 ctx.stageShortPostConversion();await jest.advanceTimersByTimeAsync(3000);
 expect(ctx.api).not.toHaveBeenCalled();
 expect(JSON.parse(ctx.sessionStorage.setItem.mock.calls[0][1])).toMatchObject({markdown:'Introduction\n\nFull article',version:1,handle:'writer'});
 expect(ctx.location.assign).toHaveBeenCalledWith('/community/mine?editPost=3&convertToNote=1');
});
test('blank rich article source does not autosave even when native required is delegated to the rich editor',async()=>{
 const {ctx,$}=harness();$('markdown').required=false;$('markdown').value='   ';
 ctx.invalidatePreview();await jest.advanceTimersByTimeAsync(1800);
 expect(ctx.api).not.toHaveBeenCalled();expect($('editor-status').textContent).toBe('Add article text to save.');
});

test('updating an existing article returns to its canonical reading page',async()=>{
 const {ctx}=harness();ctx.api.mockResolvedValue({post:{id:3,version:2,status:'published',url:'/blog/existing-article'}});
 await ctx.save('publish');expect(ctx.location.assign).toHaveBeenCalledWith('/blog/existing-article');
});
