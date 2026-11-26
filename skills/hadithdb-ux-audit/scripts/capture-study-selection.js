// Run against a preview serving this checkout. Save passage captures outside the repo.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium, firefox, webkit } = require('playwright');

async function capture(browser, origin, output, width, height, stylesheet, overlay) {
  const phone = width === 390;
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: phone, ...(phone ? { isMobile: true } : {}) });
  try {
    // Keep the third-party sign-in prompt from covering the anonymous reader.
    await context.route('https://accounts.google.com/gsi/**', route => route.abort());
    if (overlay) {
      const cssUrl = new URL('/static/css/style.css', origin);
      await context.route(url => url.origin === cssUrl.origin && url.pathname === cssUrl.pathname,
        route => route.fulfill({ contentType: 'text/css', body: stylesheet }));
    }
    const page = await context.newPage();
    const reminder = page.locator('#sunnah-dialog[open]');
    await page.addLocatorHandler(reminder, () => reminder.locator('[data-sunnah-close]').evaluate(el => el.click()));
    const response = page.waitForResponse(r => new URL(r.url()).pathname === '/static/css/style.css');
    const [, css] = await Promise.all([
      page.goto(new URL('/quran/en-khattab/quran:9:120', origin).href),
      response
    ]);
    assert.deepEqual(await css.body(), stylesheet, 'Preview stylesheet differs from checkout');
    // The reminder opens asynchronously on first visit and can trap keyboard focus.
    await reminder.waitFor({ timeout: 4000 }).catch(() => {});
    if (await reminder.count()) await reminder.locator('[data-sunnah-close]').evaluate(el => el.click());
    const passage = lang => page.locator('.quran-passage-section [lang="' + lang + '"] .body.passage')
      .filter({ has: page.locator('.ayah[data-quran-ref="9:120"]') }).first();
    for (const [step, number] of [120, 121, 120].entries()) {
      const ref = '9:' + number;
      if (step) {
        const marker = passage('ar').locator('.quran-ayah-end-marker[data-quran-ref="' + ref + '"]');
        const study = page.locator('[data-quran-mushaf-ayah-view]');
        if (phone) {
          await passage('ar').locator('.quran-mushaf-ayah-actions-toggle[data-quran-ref="' + ref + '"]').tap();
          await study.tap();
        } else {
          // Start at the preceding ayah marker and exercise the reader's tab order.
          const previous = passage('ar').locator('.quran-ayah-end-marker[data-quran-ref="9:' + (number - 1) + '"]');
          await previous.focus();
          const tabLimit = await passage('ar').locator('a, button, [tabindex]').count() + 1;
          for (let i = 0; i < tabLimit; i++) {
            await page.keyboard.press('Tab');
            if (await marker.evaluate(el => el === document.activeElement)) break;
          }
          assert.ok(await marker.evaluate(el => el.matches(':focus-visible')), 'Marker unreachable by Tab');
          await page.screenshot({ path: path.join(output, width + '-' + step + '-marker-focus.png') });
          await page.keyboard.press('Enter');
          await study.waitFor({ state: 'visible' });
          const menuTabLimit = await page.locator('#quran-mushaf-ayah-actions :is(a,button,[tabindex])').count() + 1;
          for (let i = 0; i < menuTabLimit; i++) {
            if (await study.evaluate(el => el === document.activeElement)) break;
            await page.keyboard.press('Tab');
          }
          assert.ok(await study.evaluate(el => el.matches(':focus-visible')), 'Expected keyboard focus on Study');
          await page.keyboard.press('Enter');
        }
      }
      for (const lang of ['ar', 'en']) {
        const body = passage(lang);
        await body.locator('.ayah-selected[data-quran-ref="' + ref + '"]').waitFor();
        assert.equal(await body.locator('.ayah-selected').count(), 1);
        await body.scrollIntoViewIfNeeded();
        await page.evaluate(() => document.fonts.ready.then(() => true));
        if (!step && lang === 'ar') {
          for (const neighbor of [119, 121])
            assert.equal(await body.locator('.ayah[data-quran-ref="9:' + neighbor + '"]').count(), 1);
          const word = body.locator('.ayah-selected .quran-corpus-word').first();
          await word.waitFor();
          assert.equal(await word.evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)');
          assert.ok(await word.evaluate(el => [...document.fonts].some(face =>
            face.family.replace(/["']/g, '') === 'Hafs' && face.status === 'loaded') &&
            getComputedStyle(el).fontFamily.includes('Hafs')), 'Expected loaded Hafs face');
        }
        await body.screenshot({ path: path.join(output, width + '-' + step + '-' + number + '-' + lang + '.png') });
      }
    }
  } finally {
    await context.close();
  }
}

(async () => {
  const [, , origin, output] = process.argv;
  assert.ok(origin && output, 'Supply preview origin and capture directory');
  const stylesheet = await fs.readFile(path.resolve(__dirname, '../../../public/static/css/style.css'));
  await fs.mkdir(output, { recursive: true });
  const overlay = process.argv.includes('--candidate-css');
  const fallback = process.argv.includes('--fallback');
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    const engine = fallback ? (width === 390 ? webkit : firefox) : chromium;
    const browser = await engine.launch(engine === chromium ? { channel: 'chrome' } : {});
    try {
      await capture(browser, origin, output, width, height, stylesheet, overlay);
      console.log(engine.name(), browser.version(), width, height, '120 → 121 → 120 passed');
    } finally {
      await browser.close();
    }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
