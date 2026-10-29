'use strict';
const { JSDOM } = require('jsdom');
const fs = require('fs');
const script = fs.readFileSync(require.resolve('../public/static/js/notebook-drive.js'), 'utf8');
async function setup({ connected = true, enabled = false, fail = false } = {}) {
  const template = fs.readFileSync(require.resolve('../views/settings.ejs'), 'utf8');
  const section = template.slice(template.indexOf('<div class="small" data-notebook-drive-panel'), template.indexOf('<section class="border-top pt-3" id="settings-payments-section"'));
  const dom = new JSDOM(section.replace(/<%[\s\S]*?%>/g, ''), { runScripts: 'outside-only' });
  const { window } = dom;
  window.hadithAuth = { getToken: async () => 'token' };
  window.quranApiPath = x => '/api' + x;
  window.fetch = jest.fn(async (url, options) => {
    if (url.endsWith('/shadow')) {
      if (options.method === 'PUT') {
        if (fail) return { ok: false, json: async () => ({ error: 'Please reconnect.' }) };
        enabled = JSON.parse(options.body).enabled;
      }
      return { ok: true, json: async () => ({ enabled, pending: 0 }) };
    }
    return { ok: true, json: async () => ({ configured: true, connected, migrated: true }) };
  });
  window.eval(script);
  await new Promise(resolve => setImmediate(resolve));
  return { dom, window, toggle: window.document.querySelector('[data-community-drive-enabled]'), controls: window.document.querySelector('[data-community-drive-controls]') };
}
test('optional copy switch saves the authenticated preference without backfilling or importing', async () => {
  const { dom, window, toggle, controls } = await setup();
  try {
    expect(controls.hidden).toBe(false);
    expect(toggle.checked).toBe(false);
    toggle.checked = true;
    toggle.dispatchEvent(new window.Event('change'));
    await new Promise(resolve => setImmediate(resolve));
    expect(toggle.checked).toBe(true);
    const writes = window.fetch.mock.calls.filter(([, options]) => options.method !== 'GET');
    expect(writes).toHaveLength(1);
    expect(writes[0]).toEqual(['/api/notebook/drive/shadow', expect.objectContaining({ method: 'PUT', body: '{"enabled":true}', headers: expect.objectContaining({ Authorization: 'Bearer token' }) })]);
  } finally { dom.window.close(); }
});
test('failed preference update restores the switch and shows the error', async () => {
  const { dom, window, toggle } = await setup({ fail: true });
  try {
    toggle.checked = true;
    toggle.dispatchEvent(new window.Event('change'));
    await new Promise(resolve => setImmediate(resolve));
    expect(toggle.checked).toBe(false);
    expect(window.document.querySelector('[data-notebook-drive-message]').textContent).toBe('Please reconnect.');
  } finally { dom.window.close(); }
});
test('copy controls stay hidden until a Drive connection exists', async () => {
  const { dom, controls } = await setup({ connected: false });
  expect(controls.hidden).toBe(true);
  dom.window.close();
});
