'use strict';
const fs = require('fs');
const vm = require('vm');
const script = fs.readFileSync(require.resolve('../public/static/js/notebook.js'), 'utf8');
const code = script.slice(script.indexOf('  let ayahNoteRequest = 0;'), script.indexOf("  document.addEventListener('quranAyahNoteTarget'"));
function setup() {
  let resolve;
  const pending = new Promise(r => { resolve = r; });
  const menu = { hidden: false }, handlers = {};
  const button = { dataset: { ayahNoteRef: 'quran:2:255' }, firstElementChild: {}, disabled: true,
    setAttribute: jest.fn(), removeAttribute: jest.fn(), closest: () => menu,
    addEventListener: (name, handler) => { handlers[name] = handler; } };
  const context = vm.createContext({ generation: 0, buttons: new Map(), api: jest.fn(() => pending), markSource: jest.fn(), open: jest.fn(),
    window: { hadithAuth: { getToken: async () => 'token' } }, document: { querySelectorAll: () => [] } });
  vm.runInContext(code, context);
  return { button, menu, handlers, context, resolve };
}
test('first click while canonical ayah lookup is pending opens the note once it resolves', async () => {
  const { button, menu, handlers, context, resolve } = setup();
  context.prepareAyahNote(button);
  context.prepareAyahNote(button);
  expect(context.api).not.toHaveBeenCalled();
  expect(button.disabled).toBe(false);
  const click = handlers.click({ preventDefault() {}, stopPropagation() {} });
  expect(menu.hidden).toBe(true);
  expect(context.open).not.toHaveBeenCalled();
  const source = { source_key: 'item:204673', source_title: 'quran:2:255', source_url: '/quran:2:255' };
  resolve({ source, note: null });
  await click;
  expect(context.api).toHaveBeenCalledTimes(1);
  expect(context.open).toHaveBeenCalledTimes(1);
  expect(context.open).toHaveBeenCalledWith(source);
  expect(button.firstElementChild.className).toBe('bi bi-sticky');
  expect(context.buttons.size).toBe(0);
  expect(context.markSource).not.toHaveBeenCalled();
});
test('switching ayahs while the first click is waiting never opens the old note', async () => {
  const { button, handlers, context, resolve } = setup();
  context.prepareAyahNote(button);
  const click = handlers.click({ preventDefault() {}, stopPropagation() {} });
  button.dataset.ayahNoteRef = 'quran:2:256';
  resolve({ source: { source_key: 'item:204673' } });
  await click;
  expect(context.open).not.toHaveBeenCalled();
});
