'use strict';
const ejs = require('ejs');
const fs = require('fs');
const { chromium } = require('playwright');
let browser, page, markup;
jest.setTimeout(30000);
beforeAll(async () => {
  markup = (await ejs.renderFile(require.resolve('../views/sub-views/notebook_modal.ejs'), { utils: { scriptAssetVersion: () => 'test' } })).replace(/<script[^]*?<\/script>/g, '');
  browser = await chromium.launch({ channel: 'chrome', headless: true });
});
afterAll(async () => browser?.close());
beforeEach(async () => {
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.setContent('<style>[hidden]{display:none!important} .d-flex{display:flex;gap:8px;flex-wrap:wrap} #notebook-modal{display:block} #notebook-surface{width:100%}</style>' + markup);
  if (process.env.NOTEBOOK_QA_BOOTSTRAP) {
    await page.addStyleTag({ content: fs.readFileSync(process.env.NOTEBOOK_QA_BOOTSTRAP, 'utf8') });
    await page.addStyleTag({ path: require.resolve('../public/static/css/style.css') });
  }
  await page.locator('#notebook-modal').evaluate(node => { node.setAttribute('aria-hidden', 'false'); node.classList.add('show'); });
  await page.addScriptTag({ path: require.resolve('../public/static/js/notebook-links.js') });
  await page.evaluate(() => {
    window.state = { busy: false, current: { source_key: 'general', title: 'My reflection', version: '1', markdown: 'Text', attachments: [] } };
    window.calls = []; window.opened = null; window.rejectSave = false;
    window.controls = NotebookAttachments.install({ context: () => state, save: async () => !rejectSave,
      setBusy: value => { state.busy = value; }, changed: note => { if (note.source_key === state.current.source_key) state.current = note; },
      open: note => { opened = note.source_key; }, api: async (path, method, body) => {
        calls.push({ path, method, body });
        if (method === 'PUT') return { note: { ...body, version: '2' } };
        if (path.startsWith('/attachment?')) return { source: { source_key: 'item:77', source_title: 'quran:2:255', source_url: '/quran:2:255' } };
        if (path.startsWith('/associated')) return { notes: [{ source_key: 'general', title: 'My reflection' }] };
        if (path.startsWith('/links')) return { notes: [{ source_key: 'general', title: 'My reflection' }] };
        if (path.startsWith('?source=')) return { note: { source_key: 'general', title: 'My reflection', markdown: 'Text', version: '1' } };
        throw Error('Unexpected API');
      } });
    controls.reset(state.current);
  });
});
afterEach(async () => page.close());
test('attach and detach by reference on mobile, preserving the note identity', async () => {
  await page.locator('#notebook-attachments summary').click();
  await page.locator('#notebook-attachment-reference').fill('quran:2:255');
  await page.locator('#notebook-attachment-reference').press('Enter');
  await page.getByRole('button', { name: 'Unlink quran:2:255', exact: true }).waitFor();
  expect(await page.evaluate(() => state.current.source_key)).toBe('general');
  expect(await page.locator('#notebook-attached-items a').getAttribute('href')).toBe('/quran:2:255');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/notebook-attachments-mobile.png' });
  await page.getByRole('button', { name: 'Unlink quran:2:255', exact: true }).click();
  await page.waitForFunction(() => state.current.attachments.length === 0);
});
test('an item shows associated notes and can attach an existing note without creating its own', async () => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => { state.current = { source_key: 'item:77', source_title: 'quran:2:255', source_url: '/quran:2:255', markdown: '', version: 0 }; controls.reset(state.current); });
  await page.getByRole('button', { name: 'My reflection', exact: true }).click();
  expect(await page.evaluate(() => opened)).toBe('general');
  await page.locator('#notebook-attachments summary').click();
  await page.locator('#notebook-attachment-search').fill('reflection');
  await page.getByRole('button', { name: 'Link “My reflection”', exact: true }).click();
  await page.waitForFunction(() => calls.some(call => call.method === 'PUT'));
  const writes = await page.evaluate(() => calls.filter(call => call.method === 'PUT'));
  expect(writes).toHaveLength(1);
  expect(writes[0].body.source_key).toBe('general');
  expect(writes[0].body.attachments[0].source_key).toBe('item:77');
  expect(await page.evaluate(() => state.current.version)).toBe(0);
  await page.screenshot({ path: '/tmp/notebook-attachments-desktop.png' });
});
test('unsaved edit failures block attachment changes and reset clears private labels', async () => {
  await page.locator('#notebook-attachments summary').click();
  await page.evaluate(() => { rejectSave = true; });
  await page.locator('#notebook-attachment-reference').fill('quran:2:255');
  await page.locator('#notebook-attachment-add').click();
  expect(await page.evaluate(() => calls)).toEqual([]);
  await page.evaluate(() => controls.reset(null));
  expect(await page.locator('#notebook-attachments').isHidden()).toBe(true);
  expect(await page.locator('#notebook-associated-notes').textContent()).toBe('');
});

