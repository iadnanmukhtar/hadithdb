'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

function setup(fetch) {
  const html = fs.readFileSync(path.join(__dirname, '../views/sub-views/sharh_add_modal.ejs'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only' });
  const { window } = dom;
  const root = window.document.getElementById('sharh-add-modal');
  window.fetch = fetch;
  window.bootstrap = { Modal: { getOrCreateInstance: () => ({
    show: () => root.dispatchEvent(new window.Event('shown.bs.modal')),
    hide: () => root.dispatchEvent(new window.Event('hidden.bs.modal'))
  }) } };
  window.eval(fs.readFileSync(path.join(__dirname, '../public/static/js/sharh-add-modal.js'), 'utf8'));
  return { window, root, get: selector => root.querySelector(selector) };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('existing book selection returns its identity and both titles', async () => {
  const fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => [{ book_id: 42, title: 'شرح', title_en: 'Explanation' }] });
  const { window, get } = setup(fetch);
  window.hadithAuth = { getToken: async () => 'admin-token' };
  const choice = window.pickSharhBook({ apiPath: path => '/api' + path });
  await settle();
  expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer admin-token');
  expect(get('[data-sharh-submit]').disabled).toBe(true);
  get('#sharh-add-book').selectedIndex = 0;
  get('#sharh-add-book').dispatchEvent(new window.Event('change'));
  get('form').dispatchEvent(new window.Event('submit', { cancelable: true }));
  await expect(choice).resolves.toEqual({ bookId: '42', title: 'شرح', title_en: 'Explanation' });
  window.close();
});

test('new book requires Arabic and returns optional English; cancellation returns nothing', async () => {
  const { window, root, get } = setup(jest.fn().mockResolvedValue({ ok: true, json: async () => [] }));
  const choice = window.pickSharhBook({ apiPath: path => path });
  get('#sharh-add-mode').value = 'new';
  get('#sharh-add-mode').dispatchEvent(new window.Event('change'));
  expect(get('[data-sharh-submit]').disabled).toBe(true);
  get('#sharh-add-ar').value = ' جديد ';
  get('#sharh-add-en').value = ' New ';
  get('#sharh-add-ar').dispatchEvent(new window.Event('input'));
  get('form').dispatchEvent(new window.Event('submit', { cancelable: true }));
  await expect(choice).resolves.toEqual({ bookId: '', title: 'جديد', title_en: 'New' });
  const canceled = window.pickSharhBook({ apiPath: path => path });
  expect(get('#sharh-add-mode').value).toBe('existing');
  root.dispatchEvent(new window.Event('hidden.bs.modal'));
  await expect(canceled).resolves.toBeNull();
  window.close();
});

test('failed search leaves selection disabled and shows a recoverable error', async () => {
  const { window, root, get } = setup(jest.fn().mockRejectedValue(new Error('offline')));
  const choice = window.pickSharhBook({ apiPath: path => path });
  await settle();
  expect(get('[data-sharh-status]').textContent).toContain('Unable to load books');
  expect(get('[data-sharh-submit]').disabled).toBe(true);
  root.dispatchEvent(new window.Event('hidden.bs.modal'));
  await choice;
  window.close();
});
