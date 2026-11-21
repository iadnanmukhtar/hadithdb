// Check painted accessory spacing on both consumers of the beta masthead.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

async function check(page, route, width) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto('http://localhost:3004' + route, { waitUntil: 'domcontentloaded' });
  const button = page.locator('.command-search-compact-trigger');
  await button.waitFor();
  const { leading, trailing, expected } = await button.evaluate(async el => {
    await document.fonts.ready;
    const bounds = el.getBoundingClientRect();
    return {
      leading: el.querySelector('i').getBoundingClientRect().left - bounds.left,
      trailing: bounds.right - el.querySelector('kbd').getBoundingClientRect().right,
      expected: .85 * parseFloat(getComputedStyle(document.documentElement).fontSize)
    };
  });
  console.log({ route, width, leading, trailing, expected });
  for (const inset of [leading, trailing]) assert(Math.abs(inset - expected) < 1);
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    const page = await browser.newPage();
    for (const route of ['/settings', '/books'])
      for (const width of [992, 1280]) await check(page, route, width);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
