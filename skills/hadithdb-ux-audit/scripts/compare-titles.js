// Run against the local development server, with the accepted reference route first.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

async function measure(page, path) {
  await page.goto(new URL(path, 'http://localhost:3004').href, { waitUntil: 'domcontentloaded' });
  const heading = page.locator('main h1:visible').first();
  await heading.waitFor();
  return heading.evaluate(async element => {
    await document.fonts.ready;
    const style = getComputedStyle(element);
    return Object.fromEntries(['fontFamily', 'fontSize', 'fontWeight', 'lineHeight'].map(key => [key, style[key]]));
  });
}

async function compare(reference, candidate) {
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    const page = await browser.newPage();
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const expected = await measure(page, reference);
      const actual = await measure(page, candidate);
      console.log({ width, reference, expected, candidate, actual });
      assert.deepEqual(actual, expected);
    }
  } finally {
    await browser.close();
  }
}

compare(process.argv[2] || '/settings', process.argv[3] || '/books').catch(error => {
  console.error(error);
  process.exitCode = 1;
});
