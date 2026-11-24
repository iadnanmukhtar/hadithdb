'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const ejs = require('ejs');
const { chromium } = require('playwright');
const base = process.env.UX_TEST_ORIGIN || 'http://localhost:3004';

async function verify(width, browser) {
  const context = await browser.newContext({ viewport: { width, height: 850 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  let settings = {};
  let rejectNext = true;
  await context.addInitScript(() => {
    window.hadithAuth = {
      getUser: async () => ({ uid: 'fixture', email: 'fixture@example.test' }),
      getToken: async () => 'test-only', requireToken: async () => 'test-only'
    };
  });
  await context.route('**/*', route => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.pathname.endsWith('/api/user-settings')) {
      if (req.method() === 'PUT') {
        if (rejectNext) {
          rejectNext = false;
          return route.fulfill({ status: 503, json: { error: 'Fixture unavailable' } });
        }
        settings = req.postDataJSON().settings;
      }
      return route.fulfill({ json: { settings } });
    }
    if (req.headers().authorization || !['GET', 'HEAD'].includes(req.method())) return route.fulfill({ json: {} });
    return route.continue();
  });
  try {
    await page.goto(base + '/settings', { waitUntil: 'domcontentloaded' });
    await page.locator('summary:has([data-setting-summary="script"])').click();
    const script = page.locator('input[name="settings-quran-script"][value="indo-pak"]');
    await page.locator('label').filter({ has: script }).click();
    await page.getByText('Unable to save Quran script.', { exact: true }).waitFor();
    assert.equal(await script.isChecked(), false);
    await page.locator('label').filter({ has: script }).click();
    await page.getByText('Quran script saved. It will be used on Quran pages.').waitFor();
    assert.equal(settings.quran.script, 'indo-pak');
    await page.goto(base + '/quran/settings', { waitUntil: 'domcontentloaded' });
    await page.locator('summary:has([data-setting-summary="script"])').click();
    await page.waitForSelector('input[value="indo-pak"]:checked:enabled');

    const html = await ejs.renderFile(path.join(__dirname, '../../views/notebook_shared.ejs'), {
      unavailable: false, readerVersion: 'fixture',
      note: { title: 'Fixture note', html: '<h2 id="heading">Heading</h2><p>Reading text</p>',
        outline: [{ id: 'heading', depth: 0, parts: [{ text: 'Heading' }] }] }
    });
    await page.route('**/ux-shared-fixture', route => route.fulfill({ contentType: 'text/html', body: html }));
    await page.goto(base + '/ux-shared-fixture');
    await page.getByRole('link', { name: 'Heading', exact: true }).click();
    assert.equal(new URL(page.url()).hash, '#heading');
    const zoom = page.getByRole('slider');
    await zoom.focus();
    await zoom.press('ArrowRight');
    assert.equal(await page.locator('#shared-note-zoom-value').textContent(), '105%');
    console.log('Settings rollback, retry, Quran variant and shared-note navigation and zoom passed at', width);
  } finally {
    await context.close();
  }
}

(async () => {
  const browser = await chromium.launch({ channel: process.env.UX_BROWSER_CHANNEL || 'chrome' });
  try {
    for (const width of [390, 1440]) await verify(width, browser);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
