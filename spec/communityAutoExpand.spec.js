'use strict';
const fs = require('fs'), vm = require('vm');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(require.resolve('../public/static/js/community.js'), 'utf8');
const install = source.match(/  function installReferenceExpansion\([^]*?\n  }/)[0];
function harness(text = 'quran:2:255\n') {
  const dom = new JSDOM('<dialog open><form><textarea></textarea></form></dialog>');
  const { document, Event, InputEvent } = dom.window;
  const editor = document.querySelector('textarea');
  editor.value = text; editor.setSelectionRange(text.length, text.length);
  const api = jest.fn();
  const ctx = vm.createContext({ document, Event, epoch: 1, api });
  vm.runInContext(install, ctx);
  let available = true;
  ctx.installReferenceExpansion(editor, () => available);
  const input = (inputType = 'insertLineBreak') => editor.dispatchEvent(new InputEvent('input', { inputType, bubbles: true }));
  return { editor, api, ctx, document, Event, input, disable: () => { available = false; } };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
test.each(['quran:2:255', 'quran:2:255-257', 'bukhari:100'])('expands %s after Enter and notifies the community editor', async ref => {
  const h = harness(ref + '\n');
  h.api.mockResolvedValue({ edits: [{ start: 0, end: ref.length, text: 'Expanded quotation' }] });
  const changed = jest.fn(); h.editor.addEventListener('input', changed);
  h.editor.scrollTop = 42;
  h.input(); await flush();
  expect(h.api).toHaveBeenCalledWith('/auto-expand', 'POST', { markdown: ref + '\n', newlineOffset: ref.length }, '/notebook');
  expect(h.editor.value).toBe('Expanded quotation\n');
  expect(h.editor.selectionStart).toBe(h.editor.value.length);
  expect(h.editor.scrollTop).toBe(42);
  expect(changed).toHaveBeenCalledTimes(2);
});
test.each([
  ['quran:2:255\n', 'insertFromPaste'], ['quran:2:255 ', 'insertText'],
  ['See bukhari:100\n', 'insertLineBreak'], ['[bukhari:100](/bukhari:100)\n', 'insertLineBreak'],
  ['`bukhari:100`\n', 'insertLineBreak']
])('does not expand %s on %s', async (text, type) => {
  const h = harness(text); h.input(type); await flush(); expect(h.api).not.toHaveBeenCalled();
});
test.each(['typing', 'account', 'reset', 'submit', 'close', 'composition', 'busy'])('discards a late response after %s', async action => {
  const h = harness(); let resolve;
  h.api.mockImplementation(() => new Promise(r => { resolve = r; }));
  h.input();
  if (action === 'typing') { h.editor.value += 'more'; h.input('insertText'); }
  if (action === 'account') h.ctx.epoch++;
  if (action === 'reset' || action === 'submit') h.editor.form.dispatchEvent(new h.Event(action));
  if (action === 'close') h.editor.closest('dialog').dispatchEvent(new h.Event('close'));
  if (action === 'composition') h.editor.dispatchEvent(new h.Event('compositionstart'));
  if (action === 'busy') h.disable();
  const text = h.editor.value;
  resolve({ edits: [{ start: 0, end: 11, text: 'Expanded' }] }); await flush();
  expect(h.editor.value).toBe(text);
});
test('lookup failure preserves the reference', async () => {
  const h = harness(); h.api.mockRejectedValue(new Error('Offline'));
  h.input(); await flush(); expect(h.editor.value).toBe('quran:2:255\n');
});
test('installs expansion on both community composers', () => {
  expect(source).toContain("installReferenceExpansion($('markdown'),");
  expect(source).toContain("installReferenceExpansion($('quick-text'),");
});
