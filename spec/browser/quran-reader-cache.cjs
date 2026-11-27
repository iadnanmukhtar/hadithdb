// Run against the local reader with node spec/browser/quran-reader-cache.cjs.
'use strict';
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

async function run() {
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    const page = await browser.newPage({ ignoreHTTPSErrors: true });
    const origin = process.env.UX_TEST_ORIGIN || 'http://localhost:3004';
    await page.setViewportSize({ width: 390, height: 844 });
    // The whole-book browser test exercises the installer. Isolate foreground requests here.
    await page.addInitScript(() => {
      const request = navigator.locks.request.bind(navigator.locks);
      navigator.locks.request = (name, ...args) => name.startsWith('hadithdb:download:')
        ? Promise.resolve() : request(name, ...args);
    });
    await page.route('**/quran-library/editions/**', route => route.fulfill({ status: 404, body: '' }));
    let revisionOffset = 0;
    let quranRevisionOffset = 0;
    // The simulated unpublished edition also supplies the initial document hints.
    await page.route('**/quran/**', async route => {
      if (!route.request().isNavigationRequest()) return route.fallback();
      const response = await route.fetch({ headers: { ...route.request().headers(), 'Sec-Fetch-Dest': 'document' } });
      const body = (await response.text()).replace(/const entries = (\{[\s\S]*?\n\});/, (_, json) => {
        const entries = JSON.parse(json);
        for (const entry of Object.values(entries)) {
          entry.hash = null;
          entry.version += entry.book === 'quran' ? quranRevisionOffset : revisionOffset;
        }
        return 'const entries = ' + JSON.stringify(entries) + ';';
      });
      await route.fulfill({ response, body });
    });
    await page.route('**/proxy/quran-reader/versions', async route => {
      const response = await route.fetch();
      const versions = await response.json();
      versions['en-pickthall'] += revisionOffset;
      versions.quran += quranRevisionOffset;
      await route.fulfill({ response, json: versions });
    });
    const counts = { script: 0, translation: 0 };
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.pathname.endsWith('/text/warsh/0')) counts.script++;
      if (url.pathname.endsWith('/translations/local') && url.searchParams.get('whole') === '1'
          && url.searchParams.get('src') === 'en-pickthall' && url.searchParams.get('s') === '2') counts.translation++;
    });

    // A missing manifest or a delayed catalog must not hold the first page blank.
    let releaseMetadata;
    const metadata = new Promise(resolve => { releaseMetadata = resolve; });
    const holdMetadata = async route => { await metadata; await route.fallback(); };
    await page.route('**/quran-library/editions/**', holdMetadata);
    await page.route('**/proxy/quran-reader/versions', holdMetadata);
    try {
      await page.goto(origin + '/quran/page/42', {waitUntil: 'domcontentloaded'});
      await page.locator('[data-quran-mushaf-page="42"] .quran-corpus-word').first().waitFor({state: 'visible'});
    } finally {
      releaseMetadata();
      await page.unroute('**/quran-library/editions/**', holdMetadata);
      await page.unroute('**/proxy/quran-reader/versions', holdMetadata);
    }

    async function read() {
      await page.goto(origin + '/quran/1/1', { waitUntil: 'domcontentloaded' });
      return page.evaluate(async () => {
        await bookReaderCache.versions(true);
        const book = { alias: 'en-pickthall', lang: 'en' };
        const [script, first, second] = await Promise.all([
          fetchQuranScriptRefs('warsh', ['2:255']),
          fetchQuranLocalTranslation(book, 2, 255),
          fetchQuranLocalTranslation(book, 2, 256)
        ]);
        return [script.ayahsByRef['2:255'], first.entries[0].html, second.entries[0].html];
      });
    }

    const initial = await read();
    assert.ok(initial.every(Boolean));
    assert.notEqual(initial[1], initial[2]);
    assert.deepEqual(counts, { script: 1, translation: 1 });
    assert.deepEqual(await read(), initial);
    assert.deepEqual(counts, { script: 1, translation: 1 });
    // Force an edition refresh and exercise overflow storage without changing SQL.
    revisionOffset++;
    await page.addInitScript(() => {
      const write = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key.includes('/translations/local?')) throw new DOMException('Full', 'QuotaExceededError');
        return write.call(this, key, value);
      };
    });
    assert.deepEqual(await read(), initial);
    assert.deepEqual(await read(), initial);
    assert.deepEqual(counts, { script: 1, translation: 2 });
    await page.setViewportSize({ width: 1440, height: 900 });
    let sheetDownloads = 0;
    let htmlDownloads = 0;
    page.on('request', request => {
      if (new URL(request.url()).pathname.endsWith('/api/page-data/2')) sheetDownloads++;
      if (new URL(request.url()).pathname.endsWith('/api/page/2')) htmlDownloads++;
    });
    for (let visit = 0; visit < 4; visit++) {
      if (visit === 2) quranRevisionOffset++;
      if (visit === 3) quranRevisionOffset--; // An older manifest must not replace the newer copy.
      await page.goto(origin + '/quran/page/1?script=indo-pak', { waitUntil: 'domcontentloaded' });
      await page.evaluate(() => bookReaderCache.versions(true));
      await page.locator('[data-open-mushaf-book]').first().click();
      await page.locator('#mushaf-book [data-book-page="2"] [data-quran-script-applied="indo-pak"]')
        .first().waitFor({ state: 'attached' });
      const record = await page.evaluate(() => JSON.parse(localStorage.getItem('hadithdb:quran-reader:v1:/quran/api/page-data/2')));
      assert.ok(Array.isArray(record.data.lines));
      assert.ok(record.data.headings.some(heading => heading.title_en && heading.start <= 1 && heading.end >= 5));
      assert.ok(record.data.defaultTranslation['2:5'].text);
      assert.equal(htmlDownloads, 0);
      assert.equal(sheetDownloads, visit >= 2 ? 2 : 1);
    }
    // Compare a continuation page and a multi-surah page with the canonical
    // server template, including marker order, heading links and head data.
    for (const number of [3, 604]) {
      const server = await page.request.get(origin + '/quran/page/' + number);
      assert.equal(server.status(), 200);
      const matches = await page.evaluate(async ({ number, source }) => {
        const original = new DOMParser().parseFromString(source, 'text/html');
        const rendered = await publicMushafPage(number);
        function snapshot(doc) {
          const sheet = doc.querySelector('[data-quran-mushaf-page] > .quran-mushaf-sheet');
          return {
            words: [...sheet.querySelectorAll('.quran-corpus-word, .quran-mushaf-ayah-marker')]
              .map(node => [node.dataset.quranRef, node.textContent]),
            headings: [...sheet.querySelectorAll('.quran-mushaf-page-passage a')].map(a => [a.textContent, a.getAttribute('href')]),
            title: doc.title, canonical: doc.querySelector('link[rel=canonical]').href,
            schema: [...doc.querySelectorAll('script[type="application/ld+json"]')].map(node => JSON.parse(node.textContent))
          };
        }
        return JSON.stringify(snapshot(original)) === JSON.stringify(snapshot(rendered));
      }, { number, source: await server.text() });
      assert.equal(matches, true, 'Rendered page ' + number + ' matches the public document');
    }
    assert.equal(await page.evaluate(() => localQuranMushafPageForRef('114:6')), 604);
    console.log('Verified JSON storage, revision updates, quota fallback, page rendering and shared spread downloads.');
  } finally {
    await browser.close();
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
