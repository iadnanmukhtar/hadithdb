'use strict';
const fs = require('fs');
const vm = require('vm');
const script = fs.readFileSync(require.resolve('../public/static/js/notebook-drive.js'), 'utf8');
function panel(settings = false) {
  const elements = {};
  for (const name of ['icon', 'message', 'connect', 'folder', 'disconnect']) elements[name] = { hidden: true, listeners: {}, setAttribute() {}, addEventListener(event, callback) { this.listeners[event] = callback; } };
  return { hidden: true, dataset: {}, elements, hasAttribute: name => settings && name === 'data-notebook-drive-settings', querySelector: selector => elements[selector.match(/drive-(\w+)/)[1]] };
}
async function setup(connected) {
  const notebook = panel(), settings = panel(true);
  const fetch = jest.fn(async (_url, options) => {
    if (options.method === 'DELETE') connected = false;
    return { ok: true, json: async () => ({ configured: true, connected, migrated: true, folderUrl: connected ? 'https://drive.google.com/drive/folders/example' : null }) };
  });
  const document = { querySelectorAll: () => [notebook, settings], addEventListener() {}, dispatchEvent: jest.fn() };
  vm.runInNewContext(script, { window: { hadithAuth: { getToken: async () => 'test-token' } }, document, fetch, quranApiPath: path => '/api' + path, CustomEvent: function(type) { this.type = type; } });
  await new Promise(resolve => setImmediate(resolve));
  return { notebook, settings, fetch, document };
}
test('connected notebook hides its banner while Settings exposes connection controls', async () => {
  const { notebook, settings } = await setup(true);
  expect(notebook.hidden).toBe(true);
  expect(notebook.elements.folder.hidden).toBe(true);
  expect(notebook.elements.disconnect.hidden).toBe(true);
  expect(settings.hidden).toBe(false);
  expect(settings.elements.connect.hidden).toBe(true);
  expect(settings.elements.disconnect.hidden).toBe(false);
  expect(settings.elements.folder.hidden).toBe(false);
});
test('disconnected users can connect from Settings and Notebook', async () => {
  const { notebook, settings } = await setup(false);
  for (const target of [notebook, settings]) {
    expect(target.hidden).toBe(false);
    expect(target.elements.connect.hidden).toBe(false);
    expect(typeof target.elements.connect.listeners.click).toBe('function');
    expect(target.elements.disconnect.hidden).toBe(true);
  }
});
test('disconnecting in Settings refreshes both panels and notifies the notebook', async () => {
  const { notebook, settings, fetch, document } = await setup(true);
  await settings.elements.disconnect.listeners.click();
  expect(fetch).toHaveBeenCalledWith('/api/notebook/drive', expect.objectContaining({ method: 'DELETE' }));
  expect(settings.elements.connect.hidden).toBe(false);
  expect(settings.elements.disconnect.hidden).toBe(true);
  expect(notebook.hidden).toBe(false);
  expect(document.dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'notebookDriveDisconnected' }));
});
