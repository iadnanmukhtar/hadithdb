// Compare the live components on the local Books beta route.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const surfaces = [
  ['.top-nav-menu-toggle', '#offcanvas-topnav .btn-close'],
  ['[data-command-search-open]:visible', '[data-command-search-close]'],
  ['.book-catalog-details-button:visible', '.book-catalog-dialog .btn-close'],
  ['#audit-notebook-opener', '#notebook-modal .modal-header .btn-close']
];

async function verify(page) {
  await page.goto('http://localhost:3004/books/beta?hadith', { waitUntil: 'domcontentloaded' });
  await page.locator('.book-catalog-summary:visible').first().waitFor();
  // Exercise the shared modal without signing in or creating a note.
  await page.evaluate(() => {
    const trigger = document.createElement('button');
    trigger.id = 'audit-notebook-opener';
    trigger.textContent = 'Open Notebook';
    trigger.dataset.bsToggle = 'modal';
    trigger.dataset.bsTarget = '#notebook-modal';
    document.body.append(trigger);
  });
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => {
      document.documentElement.dataset.bsTheme = theme;
      document.body.dataset.bsTheme = theme;
    }, theme);
    let reference;
    for (const [trigger, selector] of surfaces) {
      const opener = page.locator(trigger).first();
      const close = page.locator(selector);
      await opener.click();
      await close.waitFor();
      await page.mouse.move(0, 0);
      const appearance = await close.evaluate(button => {
        const css = getComputedStyle(button);
        const glyph = getComputedStyle(button, '::before');
        return { size: [button.offsetWidth, button.offsetHeight], glyph: [glyph.width, glyph.height],
          mask: glyph.maskImage, fill: css.backgroundColor, color: css.color, radius: css.borderRadius };
      });
      assert.deepEqual(appearance.size, [44, 44], selector);
      assert.deepEqual(appearance.glyph, ['18px', '18px'], selector);
      assert.notEqual(appearance.mask, 'none', selector);
      if (reference) assert.deepEqual(appearance, reference, selector);
      reference = appearance;
      await close.focus();
      await page.keyboard.press('Tab');
      await page.keyboard.press('Shift+Tab');
      assert.equal(await close.evaluate(button => getComputedStyle(button).outlineWidth), '2px', selector);
      await close.click();
      await close.waitFor({ state: 'hidden' });
      assert(await opener.evaluate(button => document.activeElement === button), trigger);
    }
  }
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    const page = await browser.newPage({ reducedMotion: 'reduce' });
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await verify(page);
    }
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
