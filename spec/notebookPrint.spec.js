'use strict';
const fs = require('fs');
const { chromium } = require('playwright');
const Notebook = require('../lib/UserNotebook');
const script = fs.readFileSync(require.resolve('../public/static/js/notebook.js'), 'utf8');
const printNote = script.match(/  async function printNote\([^]*?\n  }/)[0];
let browser, context, page, server, origin;
jest.setTimeout(30000);
beforeAll(async () => {
  server = require('http').createServer((req, res) => {
    if (/^\/static\/fonts\/kitab-base(?:-b)?\.woff2$/.test(req.url)) {
      res.setHeader('Content-Type', 'font/woff2');
      res.end(fs.readFileSync(require('path').join(__dirname, '../public', req.url)));
    } else { res.setHeader('Content-Type', 'text/html'); res.end('<button id="print">Print</button>'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
});
afterAll(async () => { await browser?.close(); await new Promise(resolve => server.close(resolve)); });
beforeEach(async () => {
  context = await browser.newContext();
  page = await context.newPage();
  await page.goto(origin + '/notebook');
  await page.addScriptTag({ path: require.resolve('../public/static/js/notebook-print.js') });
  await page.evaluate(() => {
    const open = window.open.bind(window);
    window.open = (...args) => {
      const popup = open(...args);
      popup.print = () => { popup.didPrint = true; };
      return popup;
    };
  });
});
afterEach(async () => { await context.close(); });

test('prints the current draft with safe metadata, Arabic, links and complete pagination', async () => {
  const markdown = '# Draft heading\n\nبِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ\n\nA reference quran:1:1 and a [link](https://example.com).[^1]\n\n[^1]: Footnote text.\n\n' + 'A paragraph for pagination.\n\n'.repeat(100) + 'END OF NOTE';
  await page.evaluate(({ printNote, markdown, html }) => {
    window.current = { source_key: 'item:1', source_title: 'quran:1:1', source_url: '/quran:1:1', markdown: 'Old saved body' };
    window.editor = { value: markdown }; window.titleEditor = { value: '<img src=x onerror=alert(1)> Draft title' };
    window.tagEditor = { value: 'study reflection' }; window.busy = false; window.generation = 1;
    window.printButton = document.getElementById('print'); window.status = { textContent: '' };
    window.api = async (path, method, body) => { window.request = { path, method, body }; return { html }; };
    (0, eval)(printNote); printButton.addEventListener('click', window.printNote);
  }, { printNote, markdown, html: Notebook.render(markdown) });
  const popupPromise = page.waitForEvent('popup');
  await page.click('#print');
  const popup = await popupPromise;
  await popup.waitForFunction(() => window.didPrint, null, { timeout: 5000 });
  expect(await page.evaluate(() => request)).toEqual({ path: '/preview', method: 'POST', body: { markdown } });
  expect(await popup.locator('header h1').textContent()).toBe('<img src=x onerror=alert(1)> Draft title');
  expect(await popup.locator('header img').count()).toBe(0);
  expect(await popup.locator('header a').getAttribute('href')).toBe(origin + '/quran:1:1');
  expect(await popup.locator('article').textContent()).toContain('END OF NOTE');
  expect(await popup.locator('article').textContent()).not.toContain('Old saved body');
  expect(await popup.locator('.notebook-expand-reference').count()).toBe(0);
  expect(await popup.evaluate(() => document.fonts.check('16px Kitab'))).toBe(true);
  expect(await popup.locator('article p[dir="auto"]').nth(0).evaluate(el => getComputedStyle(el).direction)).toBe('rtl');
  await popup.emulateMedia({ media: 'print' });
  expect(await popup.locator('aside').isVisible()).toBe(false);
  const pdf = await popup.pdf({ path: '/tmp/hadithdb-note-print.pdf', format: 'A4', preferCSSPageSize: true });
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  expect((pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length).toBeGreaterThan(1);
  await popup.screenshot({ path: '/tmp/hadithdb-note-print.png' });
  expect(await page.locator('#print').isEnabled()).toBe(true);
});

test('blocked popups report a useful error before rendering', async () => {
  expect(await page.evaluate(async () => {
    window.open = () => null;
    try { await NotebookPrint.open({}, () => { throw Error('Should not render'); }, () => true); }
    catch (err) { return err.message; }
  })).toContain('Allow pop-ups');
});

test('a stale response closes the print window without exposing the note', async () => {
  const popupPromise = page.waitForEvent('popup');
  const result = page.evaluate(() => NotebookPrint.open({ title: 'Private' }, async () => ({ html: '<p>Private note</p>' }), () => false));
  const popup = await popupPromise;
  await result;
  if (!popup.isClosed()) await popup.waitForEvent('close');
  expect(popup.isClosed()).toBe(true);
});

test('render failures close the empty window and preserve the error', async () => {
  const popupPromise = page.waitForEvent('popup');
  const result = page.evaluate(async () => {
    try { await NotebookPrint.open({}, async () => { throw Error('Please sign in.'); }, () => true); }
    catch (err) { return err.message; }
  });
  const popup = await popupPromise;
  expect(await result).toBe('Please sign in.');
  if (!popup.isClosed()) await popup.waitForEvent('close');
  expect(popup.isClosed()).toBe(true);
});
