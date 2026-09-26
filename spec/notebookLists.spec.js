'use strict';
const fs = require('fs');
const { chromium } = require('playwright');
jest.mock('../lib/Model', () => ({ Item: {} }));
const Notebook = require('../lib/UserNotebook');
let browser;
beforeAll(async () => { browser = await chromium.launch({ channel: 'chrome', headless: true }); });
afterAll(async () => { await browser?.close(); });
test.each([390, 1280])('Arabic and mixed list markers stay inside the preview at %ipx', async width => {
  const page = await browser.newPage({ viewport: { width, height: 844 } });
  try {
    const css = fs.readFileSync(require.resolve('../views/sub-views/notebook_content_styles.ejs'), 'utf8');
    const html = Notebook.render('1. **الأُمُورُ بِمَقاصِدِهَا**\n2. اليَقِينُ لَا يَزُولُ بِالشَّكِّ\n3. المَشَقَّةُ تَجْلِبُ ٱلتَّيْسِيرَ\n4. الضَّرَرُ يُزَالُ\n5. العَادَةُ مُحَكَّمَةٌ\n6. English item\n   - عنصر فرعي\n   - Nested English');
    await page.setContent(`<style>${css}</style><div class="notebook-markdown" style="overflow:auto;font-size:20px">${html}</div>`);
    expect(await page.locator('ol > li').count()).toBe(6);
    const items = await page.locator('li').evaluateAll(elements => elements.map(el => {
      const box = el.getBoundingClientRect(), parent = el.parentElement.getBoundingClientRect();
      const style = getComputedStyle(el);
      return { direction: style.direction, room: style.direction === 'rtl' ? parent.right - box.right : box.left - parent.left, fontSize: parseFloat(style.fontSize), display: style.display };
    }));
    expect(items.map(item => item.direction)).toEqual(['rtl','rtl','rtl','rtl','rtl','ltr','rtl','ltr']);
    for (const item of items) {
      expect(item.display).toBe('list-item');
      expect(item.room).toBeGreaterThanOrEqual(item.fontSize * 1.5);
    }
    await page.screenshot({ path: `/tmp/notebook-arabic-lists-${width}.png` });
  } finally { await page.close(); }
});

test.each(['English quote', 'اقتباس عربي'])('quoted blocks contain nested bullets: %s', async heading => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    const css = fs.readFileSync(require.resolve('../views/sub-views/notebook_content_styles.ejs'), 'utf8');
    const html = Notebook.render(`> ${heading}\n>\n> - نقطة أولى\n>   - نقطة فرعية\n>     - Deeper bullet\n> - Second item\n>\n> 1. عنصر مرقم\n>    - Nested numbered item`);
    await page.setContent(`<style>${css}</style><article class="notebook-markdown">${html}</article>`);
    expect(await page.locator('blockquote > ul > li').count()).toBe(2);
    expect(await page.locator('blockquote > ul > li > ul > li > ul > li').count()).toBe(1);
    expect(await page.locator('blockquote > ol > li > ul > li').count()).toBe(1);
    const geometry = await page.locator('blockquote').evaluate(el => {
      const box = el.getBoundingClientRect();
      return { border: getComputedStyle(el).borderInlineStartWidth, direction: getComputedStyle(el).direction,
        contained: [...el.querySelectorAll('li')].every(li => { const b = li.getBoundingClientRect(); return b.left >= box.left && b.right <= box.right && b.bottom <= box.bottom; }) };
    });
    expect(geometry).toEqual({border:'3px', direction:heading === 'English quote' ? 'ltr' : 'rtl', contained:true});
    await page.screenshot({ path: `/tmp/notebook-quoted-bullets-${geometry.direction}.png` });
  } finally { await page.close(); }
});
