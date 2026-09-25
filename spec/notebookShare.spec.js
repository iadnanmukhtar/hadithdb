'use strict';
jest.mock('../lib/NotebookDrive', () => ({ get: jest.fn(), render: text => jest.requireActual('../lib/UserNotebook').render(text) }));
jest.mock('../lib/GoogleAuth', () => ({ verifyRequest: jest.fn(async req => {
  const uid = req.headers.authorization?.replace('Bearer ', '');
  return ['alice', 'bob'].includes(uid) ? { uid, name: uid === 'alice' ? 'Amina أحمد' : 'Other Author', photo: 'https://example.com/avatar.png', email: uid + '@private.test' } : null;
}) }));
jest.mock('../lib/Model', () => ({ Item: { itemFromRef: jest.fn() } }));
const Notebook = require('../lib/NotebookDrive');
const Shares = require('../lib/NotebookShare');
const express = require('express');
const http = require('http');
const path = require('path');
let server, base, rows, notes, authors;
const fixture = { source_key: 'item:42', title: 'My <private> reflection', markdown: '# العربية\n\n==**نص**== __العربية__\n\n[[Secret note|Another note]]\n\nbukhari:100\n\n<script>bad()</script>',
  version: 1, driveFileUrl: 'https://drive.google.com/file/d/private-file/view', tags: ['hidden-tag'], revision: 'private-revision' };
const request = (url, method = 'GET', uid = 'alice', body) => fetch(base + url, {
  method, headers: { ...(uid ? { Authorization: 'Bearer ' + uid } : {}), 'Content-Type': 'application/json' },
  ...(body ? { body: JSON.stringify(body) } : {})
});
beforeAll(async () => {
  global.dbPool = { query(statement, values, callback) {
    try {
      let result;
      if (statement.startsWith('CREATE')) result = {};
      else if (statement.startsWith('INSERT INTO user_notebook_authors')) { authors.set(values[0], { name: values[1], photo: values[2] }); result = {}; }
      else if (statement.startsWith('SELECT name, photo')) result = authors.has(values[0]) ? [authors.get(values[0])] : [];
      else if (statement.startsWith('INSERT')) {
        const [uid, source, token, file] = values, key = uid + ':' + source, old = rows.get(key);
        rows.set(key, { user_uid: uid, source_key: source, token: old?.drive_file_url === file ? old.token : token, drive_file_url: file }); result = {};
      } else if (statement.startsWith('DELETE')) { rows.delete(values[0] + ':' + values[1]); result = {}; }
      else if (statement.includes('WHERE token=?')) result = [...rows.values()].filter(row => row.token === values[0]);
      else { const row = rows.get(values[0] + ':' + values[1]); result = row ? [row] : []; }
      callback(null, result);
    } catch (err) { callback(err); }
  } };
  const app = express(); app.use(express.json()); app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, '../views'));
  app.get('/test-owner', (_req, res) => res.send('<!doctype html><html><body></body></html>'));
  app.use('/static', express.static(path.join(__dirname, '../public/static')));
  app.get(['/notebook/shared/:token', '/quran/notebook/shared/:token'], require('../routes/notebook_shared'));
  app.use('/api/notebook', require('../routes/notebook')); app.use('/quran/api/notebook', require('../routes/notebook'));
  server = http.createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
});
afterAll(() => new Promise(resolve => server.close(resolve)));
beforeEach(() => {
  rows = new Map(); authors = new Map(); notes = new Map([['alice:item:42', { ...fixture }]]);
  Notebook.get.mockReset().mockImplementation(async (uid, source) => notes.get(uid + ':' + source) || null);
  global.books = [{ alias: 'bukhari' }];
});
test('sharing controls require authentication and use the authenticated owner', async () => {
  for (const method of ['GET', 'POST', 'DELETE']) expect((await request('/api/notebook/share?source=item:42', method, null, method === 'GET' ? null : { source_key: 'item:42' })).status).toBe(401);
  expect((await request('/api/notebook/share', 'POST', 'bob', { source_key: 'item:42', uid: 'alice' })).status).toBe(404);
  const created = await request('/api/notebook/share', 'POST', 'alice', { source_key: 'item:42' });
  const { token } = await created.json(); expect(token).toMatch(/^[a-f0-9]{64}$/);
  expect(await (await request('/api/notebook/share?source=item:42', 'GET', 'bob')).json()).toEqual({ token: null });
  await request('/api/notebook/share', 'DELETE', 'bob', { source_key: 'item:42', uid: 'alice' });
  expect((await request('/notebook/shared/' + token, 'GET', null)).status).toBe(200);
});
test('public page is read-only, exposes only title and rendered content, and prevents caching/indexing', async () => {
  const { token } = await Shares.enable('alice', 'item:42');
  for (const prefix of ['', '/quran']) {
    const response = await request(prefix + '/notebook/shared/' + token, 'GET', null);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('x-robots-tag')).toContain('noindex');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    const html = await response.text();
    expect(html).toContain('My &lt;private&gt; reflection');
    expect(html).toContain('<mark><strong>'); expect(html).toContain('data-notebook-overline');
    expect(html).toContain('Another note'); expect(html).not.toContain('Secret note');
    for (const privateText of ['hidden-tag', 'private-file', 'private-revision', 'alice', 'data-notebook-reference', 'data-notebook-wiki', '<textarea', '<script>']) expect(html).not.toContain(privateText);
    for (const method of ['POST', 'PUT', 'DELETE']) expect((await request(prefix + '/notebook/shared/' + token, method, null, { markdown: 'overwrite' })).status).toBe(404);
  }
});
test('public authors come from verified identity, with no email or editable body impersonation', async () => {
  const response = await request('/api/notebook/share', 'POST', 'alice', { source_key: 'item:42', name: 'Forged author', photo: 'https://evil.test/avatar' });
  const { token } = await response.json();
  let shared = await Shares.read(token);
  expect(shared.author).toEqual({ name: 'Amina أحمد', photo: 'https://example.com/avatar.png' });
  const html = await (await request('/notebook/shared/' + token, 'GET', null)).text();
  expect(html).toContain('Amina أحمد'); expect(html).toContain('https://example.com/avatar.png');
  for (const hidden of ['alice@private.test', 'Forged author', 'evil.test', 'Read-only']) expect(html).not.toContain(hidden);
  await Shares.rememberAuthor({ uid: 'alice', name: 'Updated Author', photo: 'javascript:alert(1)' });
  shared = await Shares.read(token); expect(shared.author).toEqual({ name: 'Updated Author', photo: null });
  await Shares.rememberAuthor({ uid: 'alice', name: 'alice@private.test', email: 'alice@private.test' });
  expect((await Shares.read(token)).author).toEqual({ name: 'Author', photo: null });
});
test('saved edits are live, re-enabling is stable, revocation is immediate and renewed links differ', async () => {
  const { token } = await Shares.enable('alice', 'item:42');
  expect((await Shares.enable('alice', 'item:42')).token).toBe(token);
  notes.get('alice:item:42').markdown = 'Latest saved edit';
  expect((await Shares.read(token)).html).toContain('Latest saved edit');
  await Shares.revoke('alice', 'item:42');
  expect((await request('/notebook/shared/' + token, 'GET', null)).status).toBe(404);
  expect((await Shares.enable('alice', 'item:42')).token).not.toBe(token);
});
test('deleted, replaced and disconnected notes do not remain public', async () => {
  const { token } = await Shares.enable('alice', 'item:42');
  notes.delete('alice:item:42');
  await expect(Shares.read(token)).rejects.toMatchObject({ status: 404 });
  notes.set('alice:item:42', { ...fixture, driveFileUrl: 'https://drive.google.com/file/d/replacement/view' });
  await expect(Shares.read(token)).rejects.toMatchObject({ status: 404 });
  expect((await Shares.status('alice', 'item:42')).token).toBeNull();
  const next = await Shares.enable('alice', 'item:42'); expect(next.token).not.toBe(token);
  Notebook.get.mockRejectedValue(Object.assign(new Error('private credential detail'), { status: 428 }));
  const response = await request('/notebook/shared/' + next.token, 'GET', null);
  expect(response.status).toBe(404); expect(await response.text()).not.toContain('private credential detail');
});
test('revocation during a Drive read wins and malformed tokens never fetch private notes', async () => {
  await expect(Shares.read('invalid')).rejects.toMatchObject({ status: 404 }); expect(Notebook.get).not.toHaveBeenCalled();
  const { token } = await Shares.enable('alice', 'item:42');
  Notebook.get.mockImplementationOnce(async () => { await Shares.revoke('alice', 'item:42'); return fixture; });
  await expect(Shares.read(token)).rejects.toMatchObject({ status: 404 });
});

test('public outline handles nested and duplicate headings with sticky desktop/mobile navigation', async () => {
  notes.get('alice:item:42').markdown = Array.from({ length: 8 }, (_, index) =>
    `${index % 2 ? '###' : '##'} Section العربية\n\n${'A paragraph to give each section room to scroll.\n\n'.repeat(12)}`).join('\n');
  const { token } = await Shares.enable('alice', 'item:42');
  const browser = await require('playwright').chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
    await page.goto(base + '/notebook/shared/' + token);
    const links = page.locator('.shared-note-outline a');
    await page.waitForFunction(() => document.querySelector('.shared-note-outline a[aria-current="location"]'));
    const headerBox = await page.locator('header').boundingBox(), articleBox = await page.locator('article').boundingBox();
    expect(headerBox.x).toBeCloseTo(articleBox.x, 0);
    expect(headerBox.x + headerBox.width).toBeCloseTo(articleBox.x + articleBox.width, 0);
    expect(await links.count()).toBe(8);
    expect(await links.nth(1).getAttribute('style')).toContain('--outline-depth: 1');
    const ids = await links.evaluateAll(items => items.map(item => item.hash));
    expect(new Set(ids).size).toBe(8);
    expect(await links.first().textContent()).toBe('Section العربية');
    expect(await page.locator('.notebook-outline-arabic').first().evaluate(el => getComputedStyle(el).fontFamily)).toContain('NotebookKitab');
    await links.nth(4).click();
    await page.waitForFunction(() => document.querySelector('.shared-note-outline a[aria-current="location"]').hash === '#shared-note-heading-5');
    expect(new URL(page.url()).hash).toBe('#shared-note-heading-5');
    expect((await page.locator('#shared-note-heading-5').boundingBox()).y).toBeGreaterThanOrEqual(0);
    const desktopOutline = await page.locator('.shared-note-outline').boundingBox();
    expect(desktopOutline.y).toBeCloseTo(16, 0);
    expect(desktopOutline.x + desktopOutline.width).toBeLessThan((await page.locator('article').boundingBox()).x);
    await page.screenshot({ path: '/tmp/notebook-shared-outline-desktop.png' });
    await page.locator('#shared-note-heading-6').evaluate(heading => window.scrollTo(0, window.scrollY + heading.getBoundingClientRect().top - 16));
    await page.waitForFunction(() => document.querySelector('.shared-note-outline a[aria-current="location"]').hash === '#shared-note-heading-6');
    const baseSize = await page.locator('article').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    for (const value of ['150', '75', '200', '100']) {
      await page.locator('#shared-note-zoom').fill(value);
      expect(await page.locator('#shared-note-zoom-value').textContent()).toBe(value + '%');
      expect(await page.locator('article').evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeCloseTo(baseSize * Number(value) / 100);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await links.nth(2).click();
    await page.waitForFunction(() => document.querySelector('.shared-note-outline a[aria-current="location"]').hash === '#shared-note-heading-3');
    const mobileOutline = await page.locator('.shared-note-outline').boundingBox();
    const heading = await page.locator('#shared-note-heading-3').boundingBox();
    expect(mobileOutline.y).toBeCloseTo(0, 0);
    expect(heading.y).toBeGreaterThanOrEqual(mobileOutline.y + mobileOutline.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('#shared-note-zoom').fill('200');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: '/tmp/notebook-shared-outline-mobile.png' });
    notes.get('alice:item:42').markdown = 'A note with no headings.';
    await page.goto(base + '/notebook/shared/' + token);
    expect(await page.locator('.shared-note-outline').count()).toBe(0);
    expect(await page.locator('article').textContent()).toContain('A note with no headings.');
  } finally { await browser.close(); }
});

test('owner controls save before publishing, copy the link, revoke it and clear state between notes', async () => {
  const browser = await require('playwright').chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(base + '/test-owner');
    const markup = (await require('ejs').renderFile(path.join(__dirname, '../views/sub-views/notebook_modal.ejs'), { utils: { scriptAssetVersion: () => 'test' } })).replace(/<script[^]*?<\/script>/g, '');
    await page.setContent(markup);
    await page.addScriptTag({ path: path.join(__dirname, '../public/static/js/notebook-share.js') });
    await page.evaluate(() => {
      window.state = { current: { source_key: 'item:42' }, generation: 0, busy: false }; window.saved = false;
      window.quranApiPath = value => '/quran/api' + value;
      navigator.clipboard.writeText = async value => { window.copied = value; };
      window.controls = NotebookShare.install({ context: () => state, save: async () => { saved = true; return true; },
        api: async (path, method = 'GET', body) => {
          if (method === 'POST' && !saved) throw Error('Not saved');
          const response = await fetch('/quran/api/notebook' + path, { method, headers: { Authorization: 'Bearer alice', 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
          const result = await response.json(); if (!response.ok) throw Error(result.error); return result;
        }
      });
    });
    await page.locator('#notebook-share').click();
    await page.waitForFunction(() => document.getElementById('notebook-share-status').textContent === 'This note is private.');
    await page.locator('#notebook-share-enable').click();
    await page.locator('#notebook-share-active').waitFor({ state: 'visible' });
    const url = await page.locator('#notebook-share-url').inputValue();
    expect(url).toMatch(/\/quran\/notebook\/shared\/[a-f0-9]{64}$/);
    await page.locator('#notebook-share-copy').click(); expect(await page.evaluate(() => copied)).toBe(url);
    const guest = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await guest.route('https://example.com/avatar.png', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#d4a72c"/><circle cx="20" cy="14" r="7" fill="#fff8db"/><path d="M6 40v-6a14 14 0 0128 0v6" fill="#fff8db"/></svg>' }));
    await guest.goto(url);
    expect(await guest.locator('.shared-note-author-name').textContent()).toBe('Amina أحمد');
    expect(await guest.locator('.shared-note-profile-image').getAttribute('style')).toContain('https://example.com/avatar.png');
    expect(await guest.locator('article').textContent()).toContain('العربية');
    expect(await guest.locator('textarea, button, [contenteditable]').count()).toBe(0);
    expect(await guest.locator('input').count()).toBe(1);
    expect(await guest.locator('#shared-note-zoom').getAttribute('type')).toBe('range');
    expect(await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await guest.screenshot({ path: '/tmp/notebook-shared-mobile.png', fullPage: true });
    await guest.setViewportSize({ width: 1280, height: 850 });
    await guest.screenshot({ path: '/tmp/notebook-shared-desktop.png', fullPage: true });
    await page.locator('#notebook-share-revoke').click();
    await page.waitForFunction(() => document.getElementById('notebook-share-status').textContent.startsWith('Sharing stopped'));
    expect((await guest.reload()).status()).toBe(404);
    await page.evaluate(() => { state.generation++; controls.reset(); });
    expect(await page.locator('#notebook-share-panel').isHidden()).toBe(true);
    expect(await page.locator('#notebook-share-url').inputValue()).toBe('');
  } finally { await browser.close(); }
});

test('failed saves do not publish and delayed results cannot leak into the next note', async () => {
  const browser = await require('playwright').chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    const markup = (await require('ejs').renderFile(path.join(__dirname, '../views/sub-views/notebook_modal.ejs'), { utils: { scriptAssetVersion: () => 'test' } })).replace(/<script[^]*?<\/script>/g, '');
    await page.setContent(markup); await page.addScriptTag({ path: path.join(__dirname, '../public/static/js/notebook-share.js') });
    await page.evaluate(() => {
      window.state = { current: { source_key: 'item:42' }, generation: 0 }; window.writes = 0; window.delayLoad = false;
      window.controls = NotebookShare.install({ context: () => state, save: async () => false, api: async (path, method = 'GET') => {
        if (method !== 'GET') writes++;
        if (delayLoad) return new Promise(resolve => { window.finishLoad = resolve; });
        return { token: null };
      } });
    });
    await page.locator('#notebook-share').click(); await page.locator('#notebook-share-enable').click();
    expect(await page.evaluate(() => writes)).toBe(0);
    expect(await page.locator('#notebook-share-status').textContent()).toContain('Save the note successfully');
    await page.evaluate(() => { controls.reset(); delayLoad = true; });
    await page.locator('#notebook-share').click();
    await page.evaluate(() => { state.generation++; controls.reset(); finishLoad({ token: 'a'.repeat(64) }); });
    expect(await page.locator('#notebook-share-url').inputValue()).toBe('');
  } finally { await browser.close(); }
});
