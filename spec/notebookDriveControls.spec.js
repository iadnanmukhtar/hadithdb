'use strict';
const fs = require('fs');
const vm = require('vm');
const script = fs.readFileSync(require.resolve('../public/static/js/notebook-drive.js'), 'utf8');
function panel(settings = false) {
  const elements = {};
  for (const name of ['icon', 'message', 'connect', 'folder', 'disconnect']) elements[name] = { hidden: true, listeners: {}, setAttribute() {}, addEventListener(event, callback) { this.listeners[event] = callback; } };
  return { hidden: true, dataset: {}, elements, hasAttribute: name => settings && name === 'data-notebook-drive-settings', querySelector: selector => elements[selector.match(/drive-(\w+)/)[1]] };
}
async function setup(connected, needsDriveAccess = false, pickerConfig = { apiKey: "browser-key", appId: "123" }, pickerApi) {
  const notebook = panel(), settings = panel(true);
  const importButton = { hidden: true, disabled: false, listeners: {}, addEventListener(event, callback) { this.listeners[event] = callback; } };
  const fetch = jest.fn(async (_url, options) => {
    if (_url.endsWith('/import')) return { ok: true, json: async () => ({ notes: [{ title: 'Riyad 1 v2' }] }) };
    if (options.method === 'DELETE') connected = false;
    return { ok: true, json: async () => ({ configured: true, connected, migrated: true, needsDriveAccess, picker: pickerConfig, folderId: "folder", folderUrl: connected ? 'https://drive.google.com/drive/folders/example' : null }) };
  });
  const document = { querySelectorAll: selector => selector === '[data-notebook-drive-import]' ? [importButton] : [notebook, settings], addEventListener() {}, dispatchEvent: jest.fn() };
  const initTokenClient = jest.fn(() => ({ requestAccessToken: jest.fn() }));
  const initCodeClient = jest.fn(() => ({ requestCode: jest.fn() }));
  vm.runInNewContext(script, { window: { location: { origin: 'http://localhost:3004' }, hadithAuth: { getToken: async () => 'test-token' }, google: { picker: pickerApi, accounts: { oauth2: { initCodeClient, initTokenClient } } } }, document, fetch, quranApiPath: path => '/api' + path, CustomEvent: function(type) { this.type = type; } });
  await new Promise(resolve => setImmediate(resolve));
  return { notebook, settings, fetch, document, initCodeClient, initTokenClient, importButton };
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

test('old broad grants reconnect with limited Drive scope instead of rerunning migration', async () => {
  const { notebook, settings, initCodeClient, fetch } = await setup(true, true);
  for (const target of [notebook, settings]) {
    expect(target.hidden).toBe(false);
    expect(target.elements.connect.hidden).toBe(false);
    expect(target.elements.connect.textContent).toBe('Reconnect Google Drive');
    expect(target.elements.message.textContent).toContain('limited access');
  }
  settings.elements.connect.listeners.click();
  expect(initCodeClient).toHaveBeenCalledWith(expect.objectContaining({ scope: 'openid email https://www.googleapis.com/auth/drive.file', include_granted_scopes: false }));
  expect(fetch).not.toHaveBeenCalledWith('/api/notebook/drive/migrate', expect.anything());
});

test('import requests only file access after a click and is hidden when disconnected', async () => {
  const { importButton, initTokenClient } = await setup(true);
  expect(importButton.hidden).toBe(false);
  expect(initTokenClient).not.toHaveBeenCalled();
  importButton.listeners.click();
  expect(initTokenClient).toHaveBeenCalledWith(expect.objectContaining({ scope: 'https://www.googleapis.com/auth/drive.file', include_granted_scopes: false }));
  expect(importButton.disabled).toBe(true);
  const disconnected = await setup(false);
  expect(disconnected.importButton.hidden).toBe(true);
});
test('missing picker configuration is explained without requesting new authorization', async () => {
  const { importButton, initTokenClient, notebook } = await setup(true, false, null);
  importButton.listeners.click();
  expect(initTokenClient).not.toHaveBeenCalled();
  expect(notebook.elements.message.textContent).toContain('being set up');
  expect(importButton.disabled).toBe(false);
});

test('picker submits selected existing file IDs and refreshes notes after import', async () => {
  const picker = { dispose: jest.fn(), setVisible: jest.fn() };
  const builder = {};
  for (const method of ['addView', 'setTitle', 'setOAuthToken', 'setDeveloperKey', 'setAppId', 'setOrigin', 'enableFeature'])
    builder[method] = jest.fn(() => builder);
  builder.setCallback = jest.fn(callback => { builder.callback = callback; return builder; });
  builder.build = () => picker;
  const view = {};
  for (const method of ['setIncludeFolders', 'setSelectFolderEnabled', 'setParent']) view[method] = jest.fn(() => view);
  const api = { DocsView: function() { return view; }, ViewId: { DOCS: 'docs' }, PickerBuilder: function() { return builder; },
    Feature: { MULTISELECT_ENABLED: 'multiple' }, Action: { PICKED: 'picked', CANCEL: 'cancel' } };
  const { importButton, initTokenClient, fetch, document } = await setup(true, false, { apiKey: 'browser-key', appId: '123' }, api);
  importButton.listeners.click();
  await initTokenClient.mock.calls[0][0].callback({ access_token: 'ephemeral' });
  expect(picker.setVisible).toHaveBeenCalledWith(true);
  expect(view.setParent).toHaveBeenCalledWith('folder');
  await builder.callback({ action: 'picked', docs: [{ id: 'existing-file', name: 'Riyad 1 v2.md' }] });
  expect(fetch).toHaveBeenCalledWith('/api/notebook/drive/import', expect.objectContaining({ method: 'POST', body: JSON.stringify({ fileIds: ['existing-file'] }) }));
  expect(document.dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'notebookDriveConnected' }));
  expect(importButton.disabled).toBe(false);
  expect(picker.dispose).toHaveBeenCalled();
});
