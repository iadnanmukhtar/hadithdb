// Compare a TOC with the Books reference on each side of the navigation breakpoints.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

async function measure(page, route) {
  await page.goto(new URL(route, 'http://localhost:3004').href, { waitUntil: 'domcontentloaded' });
  await page.locator('.ux-rail-search:visible').first().waitFor();
  return page.evaluate(async () => {
    await document.fonts.ready;
    const box = selector => {
      const element = [...document.querySelectorAll(selector)].find(node => node.offsetWidth);
      if (!element) return null;
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    };
    return {
      subnav: box('.ux-subnav'), title: box('main .ux-page-title'),
      rail: box('.ux-rail-title'), search: box('.ux-rail-search'),
      picker: !!box('.ux-subnav-picker')
    };
  });
}

async function compare(routes) {
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    const page = await browser.newPage();
    for (const width of [390, 700, 701, 991, 992, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const reference = await measure(page, '/books?hadith');
      for (const route of routes) {
        const actual = await measure(page, route);
        assert.equal(actual.picker, width <= 700, route + ' collection picker at ' + width);
        assert.equal(!!actual.rail, width >= 992, route + ' rail at ' + width);
        for (const role of ['subnav', 'title', 'rail', 'search']) {
          if (role === 'rail' && width < 992) continue;
          for (const dimension of ['x', 'y', 'width', 'height']) {
            if (role === 'title' && dimension === 'height') continue; // Long titles wrap.
            if (role === 'search' && width < 992 && dimension === 'y') continue; // Bilingual subtitle.
            const delta = Math.abs(reference[role][dimension] - actual[role][dimension]);
            assert.ok(delta <= 1, route + ' at ' + width + ': ' + role + ' ' + dimension + ' differs by ' + delta + 'px');
          }
        }
        console.log('PASS', width, route);
      }
    }
  } finally {
    await browser.close();
  }
}

const routes = process.argv.slice(2);
compare(routes.length ? routes : ['/bukhari', '/quran/tafsir/saadi', '/sharh/malik-istidhkar']).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
