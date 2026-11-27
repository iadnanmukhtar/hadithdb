// Replace one published book in an open browser without changing the source database.
'use strict';
const { chromium } = require('playwright');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      const interval = window.setInterval.bind(window);
      window.setInterval = (fn, delay, ...args) => interval(fn, delay === 60000 ? 1500 : delay, ...args);
    });
    const alias = 'en-pickthall';
    const url = '/quran/api/proxy/translations/local?src=en-pickthall&s=114&lang=en&render=reader&whole=1';
    const body = version => JSON.stringify({ entries: [{ ayahs_start: 1, count: 0, html: 'Edition ' + version }] });
    const hash = version => createHash('sha256').update(body(version)).digest('hex');
    let version = 1, corrupt = false;
    await page.route('**/quran-library/editions/' + alias, route => route.fulfill({
      json: { book: alias, format: 3, version, files: { [url]: hash(version) } }
    }));
    for (const revision of [1,2]) await page.route('**/quran-library/files/' + hash(revision), route =>
      route.fulfill({ body: corrupt ? '{}' : body(revision), contentType: 'application/json' }));
    await page.goto((process.env.UX_TEST_ORIGIN || 'http://localhost:3004') + '/quran/en-pickthall/1/1', {waitUntil:'domcontentloaded'});
    async function activeVersion(expected) {
      const deadline = Date.now() + 45000;
      while (Date.now() < deadline) {
        const version = await page.evaluate(async alias => {
          const response = await (await caches.open('hadithdb-reader-editions-v1')).match('/quran-library/editions/' + alias);
          return response && (await response.json()).version;
        },alias);
        if (version === expected) return;
        await new Promise(resolve => setTimeout(resolve,100));
      }
      throw Error('No complete edition ' + expected);
    }
    const read = () => page.evaluate(async () => (await fetchQuranLocalTranslation({alias:'en-pickthall',lang:'en'},114,1)).entries[0].html);
    await activeVersion(1);
    version = 2;
    corrupt = true;
    await page.evaluate(async () => {
      try { await publishedQuran.install('en-pickthall', () => true, () => 0); } catch (e) { return; }
      throw new Error('A damaged download was accepted');
    });
    assert.equal(await read(),'Edition 1');
    corrupt = false;
    await activeVersion(2);
    assert.equal(await read(),'Edition 2');
    console.log('Verified complete edition survives a damaged update and switches automatically after a verified retry.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
