// Verify the automatic download against the local catalog in a fresh browser profile.
'use strict';
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

async function run() {
  const origin = process.env.UX_TEST_ORIGIN || 'http://localhost:3004';
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    const path = '/quran/1/1';
    const downloads = [];
    const fragments = [];
    page.on('response', response => {
      if (['fetch','xhr'].includes(response.request().resourceType()) && (response.headers()['content-type'] || '').startsWith('text/html') && new URL(response.url()).origin === origin) fragments.push(response.url());
    });
    page.on('request', request => {
      const url = new URL(request.url());
      if (request.resourceType() === 'fetch' && /text\/html/.test(request.headers().accept || '') || url.pathname.includes('/quran-library/files/') || /\/api\/(relationships|corpus(?:\/|-chapter)|study-index|introductions\/|text\/|page-data\/|page-batch\/|page-outlines\/|proxy\/translations\/local)/.test(url.pathname)) downloads.push(url);
    });
    await page.goto(origin + path, { waitUntil: 'domcontentloaded' });
    const firstVerse = page.locator('[data-quran-translation-target="1"][data-quran-surah="1"][data-quran-ayah="1"]').first();
    await firstVerse.waitFor();
    assert.match(await firstVerse.innerText(), /In the Name of Allah—the Most Compassionate, Most Merciful/);
    async function inventory() {
      return page.evaluate(async () => {
        const cache = await caches.open('hadithdb-reader-editions-v1');
        const paths = [];
        for (const book of ['quran', 'en-khattab']) {
          const response = await cache.match('/quran-library/editions/' + book);
          if (response) paths.push(...Object.keys((await response.json()).files));
        }
        return {
          scripts: [...paths].filter(p => p.includes('/api/text/')).length,
          translations: [...paths].filter(p => p.includes('src=en-khattab') && p.includes('whole=1')).length,
          pages: [...paths].filter(p => p.includes('/api/page-data/')).length,
          outlines: [...paths].filter(p => p.includes('/api/page-outlines/')).length
        };
      });
    }
    page.on('response', response => {
      if (response.status() >= 400 && response.url().includes('/quran/api/')) console.error(response.status(), response.url());
    });
    async function waitFor(predicate) {
      const deadline = Date.now() + 600000;
      let last;
      let report = Date.now() + 15000;
      while (Date.now() < deadline) {
        last = await inventory();
        if (Date.now() > report) {
          console.log('Downloaded', last);
          report = Date.now() + 15000;
        }
        if (await predicate(last)) return last;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      throw new Error('Incomplete library: ' + JSON.stringify(last));
    }
    await waitFor(() => page.evaluate(async () => (await (await caches.open('hadithdb-reader-files:quran')).keys()).length >= 4));
    await page.reload({ waitUntil: 'domcontentloaded' });
    const totals = await waitFor(count => count.scripts === 87 && count.translations === 114 && count.pages === 604 && count.outlines === 114);
    await page.reload({ waitUntil: 'domcontentloaded' });
    downloads.length = 0;
    fragments.length = 0;
    const result = await page.evaluate(async () => {
      const texts = await Promise.all(['uthmani', 'indo-pak', 'warsh'].map(async script =>
        (await fetchQuranScriptRefs(script, ['114:6'])).ayahsByRef['114:6']));
      const translation = await fetchQuranLocalTranslation({ alias: 'en-khattab', lang: 'en' }, 114, 6);
      const ayah = await localQuranReaderAyah(114, 6);
      const number = await localQuranMushafPageForRef('114:6');
      if (number !== 604) throw new Error('Incorrect final ayah page');
      const sheet = await publicMushafPage(number);
      return { texts, translation: translation.entries[0].html, next: ayah.next_ref,
        defaultTranslation: ayah.en.body, words: sheet.querySelectorAll('.quran-corpus-word').length };
    });
    assert.ok(result.texts.every(Boolean));
    assert.ok(result.translation && result.defaultTranslation && result.words);
    assert.equal(result.next, 'quran:1:1');
    await page.goto(origin + '/quran/en-khattab/2/1', { waitUntil: 'domcontentloaded' });
    await page.locator('main[data-quran-infinite-passage]').waitFor();
    await page.locator('.quran-infinite-sentinel').scrollIntoViewIfNeeded();
    await page.locator('[data-quran-infinite-page="1"]').first().waitFor({ state: 'attached' });
    await page.goto(origin + '/quran/en-khattab/quran:2:255', {waitUntil:'domcontentloaded'});
    await page.locator('main[data-quran-infinite-passage] .quran-ayah-hero').first().waitFor();
    assert.ok(page.url().includes('/en-khattab/quran:2:255'));
    assert.match(await page.title(), /2:255/);
    const phrases = page.locator('main .quran-ayah-hero .quran-mutashabihat').first();
    assert.equal(await phrases.locator('.quran-mutashabihat-match').count(), 0);
    await phrases.locator('summary').first().click();
    await phrases.locator('.quran-mutashabihat-match').first().waitFor({state: 'attached'});
    assert.equal(await page.locator('[data-quran-bar]').first().getAttribute('data-quran-study-book'), 'en-khattab');
    await page.goto(origin + '/quran/page/42?script=indo-pak', { waitUntil: 'domcontentloaded' });
    await page.locator('[data-quran-mushaf-page="42"] [data-quran-script-applied="indo-pak"]').first().waitFor({ state: 'attached' });
    assert.deepEqual(downloads.map(url => url.pathname), []);
    assert.deepEqual(fragments, []);
    await page.goto(origin + '/quran/en-pickthall/1/1', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('main[data-quran-infinite-passage] [data-quran-passage-translation-select]')?.value === 'en-pickthall');
    assert.equal(await page.evaluate(async () => (await selectedQuranAudioTranslationBook()).alias), 'en-pickthall');
    await page.context().addCookies([{ name: 'quranPreferredTranslationAlias', value: 'en-pickthall', url: origin }]);
    const returningReader = await context.newPage();
    await returningReader.goto(origin + path, { waitUntil: 'domcontentloaded' });
    await returningReader.waitForFunction(() => document.querySelector('main[data-quran-infinite-passage] [data-quran-passage-translation-select]')?.value === 'en-pickthall');
    const explicit = await page.context().newPage();
    await explicit.goto(origin + '/quran/en-khattab/1/1', { waitUntil: 'domcontentloaded' });
    const explicitVerse = explicit.locator('[data-quran-translation-target="1"][data-quran-surah="1"][data-quran-ayah="1"]').first();
    await explicitVerse.waitFor();
    assert.match(await explicitVerse.innerText(), /In the Name of Allah—the Most Compassionate, Most Merciful/);
    console.log('Verified resumed installation and unseen-page reads', totals);
  } finally {
    await browser.close();
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
