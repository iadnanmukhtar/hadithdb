// Check painted accessory spacing on both states of the shared masthead search.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

async function check(page, route, width) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto('http://localhost:3004' + route, { waitUntil: 'domcontentloaded' });
  const button = page.locator('.command-search-compact-trigger');
  await button.waitFor();
  const { leading, trailing, expected, compact } = await button.evaluate(async el => {
    await document.fonts.ready;
    const bounds = el.getBoundingClientRect();
    const icon = el.querySelector('i').getBoundingClientRect();
    const shortcut = el.querySelector('kbd').getBoundingClientRect();
    if (!shortcut.width) {
      return { compact: true, leading: icon.left - bounds.left, trailing: bounds.right - icon.right,
          expected: (bounds.width - icon.width) / 2 };
    }
    return {
      compact: false, leading: el.querySelector('i').getBoundingClientRect().left - bounds.left,
      trailing: bounds.right - el.querySelector('kbd').getBoundingClientRect().right,
      expected: .85 * parseFloat(getComputedStyle(document.documentElement).fontSize)
    };
  });
  console.log({ route, width, leading, trailing, expected });
  assert.equal(compact, width < 1200, 'collapsed search at ' + width);
  for (const inset of [leading, trailing]) assert(Math.abs(inset - expected) < 1);
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    const page = await browser.newPage();
    for (const route of ['/settings', '/books'])
      for (const width of [992, 1199, 1200, 1280]) await check(page, route, width);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
