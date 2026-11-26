// Run against a preview serving this checkout. Save passage captures outside the repo.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');

async function capture(browser, origin, output, width, height, stylesheet) {
  const phone = width === 390;
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: phone, isMobile: phone });
  try {
    const page = await context.newPage();
    const response = page.waitForResponse(r => new URL(r.url()).pathname === '/static/css/style.css');
    const [, css] = await Promise.all([
      page.goto(new URL('/quran/en-khattab/quran:9:120', origin).href),
      response
    ]);
    assert.deepEqual(await css.body(), stylesheet, 'Preview stylesheet differs from checkout');
    const passage = lang => page.locator('.quran-passage-section [lang="' + lang + '"] .body.passage')
      .filter({ has: page.locator('.ayah[data-quran-ref="9:120"]') }).first();
    for (const [step, number] of [120, 121, 120].entries()) {
      const ref = '9:' + number;
      if (step) {
        const marker = passage('ar').locator('.quran-ayah-end-marker[data-quran-ref="' + ref + '"]');
        const study = page.locator('[data-quran-mushaf-ayah-view]');
        if (phone) {
          await marker.tap();
          await study.tap();
        } else {
          await marker.press('Enter');
          await study.press('Enter');
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
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    await capture(browser, origin, output, 1440, 900, stylesheet);
    await capture(browser, origin, output, 390, 844, stylesheet);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
