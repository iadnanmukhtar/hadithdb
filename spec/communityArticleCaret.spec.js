'use strict';
const fs = require('fs');
const { chromium } = require('playwright');
const source = fs.readFileSync(require.resolve('../public/static/js/community-formatting.js'), 'utf8');
const css = fs.readFileSync(require.resolve('../public/static/css/community.css'), 'utf8');
let browser, page;
beforeAll(async () => { browser = await chromium.launch({channel:'chrome',headless:true}); });
beforeEach(async () => { page = await browser.newPage(); });
afterEach(async () => { await page?.close(); });
afterAll(async () => { await browser?.close(); });
test.each([
  ['العربية هنا\nEnglish words here',18,'ltr',12,30],
  ['English words here\nالعربية هنا',22,'rtl',19,30]
])('article navigation follows the active paragraph: %s', async (markdown, position, direction, start, end) => {
  await page.setContent(`<style>${css}</style><section class="community-editor"><div id="community-format-toolbar"><select id="community-format-style"></select></div><textarea id="community-markdown" dir="auto" style="width:600px"></textarea></section>`);
  await page.addScriptTag({content:source});
  await page.locator('textarea').fill(markdown);
  const left = direction==='ltr' ? -1 : 1;
  const cases = [['Shift+ArrowLeft',position+left],['Shift+ArrowRight',position-left]];
  if(process.platform==='darwin') cases.push(['Meta+Shift+ArrowLeft',direction==='ltr'?start:end],['Meta+Shift+ArrowRight',direction==='ltr'?end:start]);
  for(const [key,target] of cases) {
    await page.locator('textarea').evaluate((editor, position) => {editor.dir='auto';editor.focus();editor.setSelectionRange(position,position);},position);
    await page.keyboard.press(key);
    expect(await page.locator('textarea').evaluate(editor=>[editor.selectionStart,editor.selectionEnd])).toEqual([Math.min(position,target),Math.max(position,target)]);
  }
});
