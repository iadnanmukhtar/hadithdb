'use strict';
const fs = require('fs'), vm = require('vm');
const source = fs.readFileSync(require.resolve('../public/static/js/notebook.js'), 'utf8');
const functions = ['scheduleReferenceExpansion', 'autoExpandReferences'].map(name => source.match(new RegExp(`  (?:async )?function ${name}\\([^]*?\\n  }`))[0]).join('\n');
function harness() {
  const { JSDOM } = require('jsdom');
  const editor = new JSDOM('<textarea></textarea>').window.document.querySelector('textarea');
  editor.value = 'Before\nbukhari:100\n'; editor.setSelectionRange(editor.value.length, editor.value.length);
  const ctx = vm.createContext({ editor, current: {}, busy: false, locked: false, editing: true, generation: 1,
    referenceEpoch: 0, referenceTimer: null, composingReference: false, setTimeout, clearTimeout,
    api: jest.fn(), scheduleSave: jest.fn() });
  vm.runInContext(functions, ctx); return ctx;
}
const expanded = { edits: [{ start: 7, end: 18, text: '\n\n> العربية\n> English ([source](/bukhari:100))\n\n' }] };
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());
test('expands a standalone reference after Enter and preserves caret, scroll, and edit mode', async () => {
  const ctx = harness(), original = ctx.editor.value;
  ctx.editor.scrollTop = 42; ctx.api.mockResolvedValue(expanded);
  ctx.scheduleReferenceExpansion({ inputType: 'insertLineBreak' }); 
  expect(ctx.api).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(0);
  expect(ctx.editor.value).toBe('Before\n' + expanded.edits[0].text + '\n');
  expect(ctx.editor.selectionStart).toBe(original.length + expanded.edits[0].text.length - 11);
  expect(ctx.editor.scrollTop).toBe(42); expect(ctx.editing).toBe(true);
  expect(ctx.scheduleSave).toHaveBeenCalledTimes(1);
});
test.each(['typing', 'switch', 'composition', 'lock', 'preview'])('late lookups do not overwrite the draft after %s', async action => {
  const ctx = harness(); let resolve;
  ctx.api.mockImplementation(() => new Promise(r => { resolve = r; }));
  ctx.scheduleReferenceExpansion({ inputType: 'insertLineBreak' }); await jest.advanceTimersByTimeAsync(650);
  if (action === 'typing') ctx.editor.value += ' newer';
  if (action === 'switch') ctx.generation++;
  if (action === 'composition') ctx.composingReference = true;
  if (action === 'lock') ctx.locked = true;
  if (action === 'preview') ctx.editing = false;
  const text = ctx.editor.value; resolve(expanded); await Promise.resolve(); await Promise.resolve();
  expect(ctx.editor.value).toBe(text); expect(ctx.scheduleSave).not.toHaveBeenCalled();
});
test('composition and ordinary prose do not schedule lookups', async () => {
  const ctx = harness(); ctx.composingReference = true; ctx.scheduleReferenceExpansion({ inputType: 'insertLineBreak' });
  await jest.advanceTimersByTimeAsync(1000); expect(ctx.api).not.toHaveBeenCalled();
  ctx.composingReference = false; ctx.editor.value = 'Ordinary prose'; ctx.scheduleReferenceExpansion({ inputType: 'insertLineBreak' });
  await jest.advanceTimersByTimeAsync(1000); expect(ctx.api).not.toHaveBeenCalled();
});
test('a failed lookup keeps the draft available', async () => {
  const ctx = harness(), text = ctx.editor.value; ctx.api.mockRejectedValue(Error('Offline'));
  ctx.scheduleReferenceExpansion({ inputType: 'insertLineBreak' }); await jest.advanceTimersByTimeAsync(1000);
  expect(ctx.editor.value).toBe(text); expect(ctx.scheduleSave).not.toHaveBeenCalled();
});
test('maps the live backward selection after the lookup starts', async () => {
  const ctx = harness(); let resolve;
  ctx.api.mockImplementation(() => new Promise(r => { resolve = r; }));
  ctx.scheduleReferenceExpansion({ inputType: 'insertLineBreak' }); await jest.advanceTimersByTimeAsync(0);
  ctx.editor.setSelectionRange(0, 6, 'backward');
  resolve(expanded); await Promise.resolve(); await Promise.resolve();
  expect([ctx.editor.selectionStart, ctx.editor.selectionEnd, ctx.editor.selectionDirection]).toEqual([0, 6, 'backward']);
});
test.each([
  ['bukhari:100 ', 'insertText'],
  ['bukhari:100.', 'insertText'],
  ['bukhari:100\n', 'insertFromPaste'],
  ['Before bukhari:100\n', 'insertLineBreak'],
  ['bukhari:100 after\n', 'insertLineBreak'],
  ['bukhari:100\nOther text\n', 'insertLineBreak'],
])('does not expand %s on %s', async (text, inputType) => {
  const ctx = harness(); ctx.editor.value = text;
  ctx.editor.setSelectionRange(ctx.editor.value.length, ctx.editor.value.length);
  ctx.scheduleReferenceExpansion({ inputType }); await jest.advanceTimersByTimeAsync(1000);
  expect(ctx.api).not.toHaveBeenCalled();
});
