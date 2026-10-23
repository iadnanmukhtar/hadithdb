'use strict';
const fs = require('fs');
const { chromium } = require('playwright');
const template = fs.readFileSync(require.resolve('../views/sub-views/notebook_modal.ejs'), 'utf8');
const styles = ['notebook-surface', 'notebook-editor', 'notebook-wiki-options'].map(id =>
  [...template.matchAll(new RegExp(`#${id} \\{[^}]+\\}`, 'g'))].map(match => match[0]).join('\n')).join('\n');
let browser, page;
jest.setTimeout(30000);
beforeAll(async () => { browser = await chromium.launch({ channel: 'chrome', headless: true }); });
afterEach(async () => { await page?.close(); });
afterAll(async () => { await browser?.close(); });

async function setup(width, prefix) {
  page = await browser.newPage({ viewport: { width, height: 750 } });
  page.setDefaultTimeout(5000);
  await page.setContent(`<style>${styles}
    body {margin: 16px} #notebook-surface {height:620px}
    #notebook-editor {flex:1;min-height:0;box-sizing:border-box;width:100%;font:20px/36px monospace;padding:12px;border:1px solid;}
    #notebook-wiki-options [role=option] {padding:8px}
    </style><div id="notebook-surface"><textarea id="notebook-editor" dir="auto"></textarea><div id="notebook-wiki-options" hidden></div></div>`);
  await page.addScriptTag({ path: require.resolve('../public/static/js/notebook-wiki.js') });
  await page.evaluate(prefix => {
    const editor = document.querySelector('textarea');
    window.queries = [];
    NotebookWiki.install(editor, document.querySelector('#notebook-wiki-options'), async query => {
      queries.push(query);
      return { notes: Array.from({length:20}, (_, i) => ({title:`The Mahdi ${i}`})) };
    });
    editor.value = prefix + '[[Ma' + '\nFurther paragraphs below.'.repeat(70);
    editor.focus(); editor.setSelectionRange(prefix.length + 4, prefix.length + 4);
    editor.scrollTop = 0;
    editor.dispatchEvent(new Event('input', {bubbles:true}));
  }, prefix);
  await page.locator('#notebook-wiki-options').waitFor({state:'visible'});
}
async function geometry() {
  return page.evaluate(() => {
    const editor = document.querySelector('textarea'), popup = document.querySelector('#notebook-wiki-options');
    return { editor: editor.getBoundingClientRect().toJSON(), popup: popup.getBoundingClientRect().toJSON(), scroll:editor.scrollTop };
  });
}

test.each([900, 320])('suggestions sit below the active line and complete without moving the note at width %i', async width => {
  await setup(width, 'Heading\n\n- Details on ');
  const before = await geometry();
  // The caret is on the third 36px line, far above the textarea bottom.
  expect(before.popup.top).toBeGreaterThan(before.editor.top + 12 + 72);
  expect(before.popup.top).toBeLessThan(before.editor.top + 12 + 108 + 8);
  expect(before.popup.left).toBeGreaterThanOrEqual(before.editor.left);
  expect(before.popup.right).toBeLessThanOrEqual(before.editor.right + 1);
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  expect(await page.locator('textarea').inputValue()).toContain('[[The Mahdi 1]]\nFurther');
  expect(await page.locator('#notebook-wiki-options').isVisible()).toBe(false);
  expect((await geometry()).scroll).toBe(before.scroll);
});

test.each([900, 320])('suggestions follow wrapped Arabic lines, scrolling and resizing at width %i', async width => {
  const prefix = 'العربية جميلة ومفيدة '.repeat(8) + '\nDetails ';
  await setup(width, prefix);
  const before = await geometry();
  expect(before.popup.top).toBeGreaterThan(before.editor.top + 100);
  await page.locator('textarea').evaluate(editor => { editor.scrollTop += 36; });
  await page.waitForTimeout(50);
  const after = await geometry();
  expect(after.popup.top).toBeCloseTo(before.popup.top - 36, 0);
  await page.setViewportSize({width:width + 60, height:750});
  await page.waitForTimeout(50);
  const resized = await geometry();
  expect(resized.popup.right).toBeLessThanOrEqual(resized.editor.right + 1);
  await page.locator('#notebook-wiki-option-2').click();
  expect(await page.locator('textarea').inputValue()).toContain('[[The Mahdi 2]]');
});

test('keyboard navigation scrolls only the suggestions and Escape dismisses them', async () => {
  await setup(500, 'Details ');
  const scroll = (await geometry()).scroll;
  for (let i = 0; i < 15; i++) await page.keyboard.press('ArrowDown');
  expect(await page.locator('#notebook-wiki-options').evaluate(popup => popup.scrollTop)).toBeGreaterThan(0);
  expect((await geometry()).scroll).toBe(scroll);
  await page.keyboard.press('Escape');
  expect(await page.locator('#notebook-wiki-options').isVisible()).toBe(false);
});
