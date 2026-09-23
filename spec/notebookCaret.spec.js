'use strict';
const fs = require('fs');
const { chromium } = require('playwright');
const Notebook = require('../lib/UserNotebook');
const source = fs.readFileSync(require.resolve('../public/static/js/notebook.js'), 'utf8');
const handlers = source.slice(source.indexOf('  function previewCaretOffset('), source.indexOf('  async function openWiki('));
jest.setTimeout(30000);
let browser, page;
beforeAll(async () => { browser = await chromium.launch({ channel: 'chrome', headless: true }); });
beforeEach(async () => { page = await browser.newPage(); });
afterEach(async () => { await page?.close(); });
afterAll(async () => { await browser?.close(); });
test.each([
  ['العربية هنا\nEnglish words here', 18, 'ltr', 12, 30],
  ['English words here\nالعربية هنا', 22, 'rtl', 19, 30],
])('horizontal selection follows the active paragraph: %s', async (markdown, position, direction, start, end) => {
  const template = fs.readFileSync(require.resolve('../views/sub-views/notebook_modal.ejs'), 'utf8');
  const style = template.match(/#notebook-editor \{[^}]+\}/)[0];
  await page.setContent(`<style>${style}</style><textarea id="notebook-editor" dir="auto" style="width:600px"></textarea>`);
  await page.evaluate(({markdown, source}) => {
    window.editor = document.querySelector('textarea');
    editor.value = markdown;
    (0, eval)(source.slice(source.indexOf('  function updateEditorCaretDirection()'), source.indexOf("  saveButton.addEventListener('click', saveAndPreview)")));
  }, {markdown, source});
  const left = direction === 'ltr' ? -1 : 1;
  const cases = [
    ['Shift+ArrowLeft', position + left],
    ['Shift+ArrowRight', position - left],
  ];
  if (process.platform === 'darwin') cases.push(
    ['Meta+Shift+ArrowLeft', direction === 'ltr' ? start : end],
    ['Meta+Shift+ArrowRight', direction === 'ltr' ? end : start],
  );
  for (const [key, target] of cases) {
    await page.locator('textarea').evaluate((editor, position) => {
      editor.dir = 'auto'; editor.focus(); editor.setSelectionRange(position, position);
    }, position);
    await page.keyboard.press(key);
    expect(await page.locator('textarea').evaluate(editor => [editor.selectionStart, editor.selectionEnd]))
      .toEqual([Math.min(position, target), Math.max(position, target)]);
  }
});
test.each([
  ['Plain paragraph with some words.', 'some', 0],
  ['# Heading\n\nFirst **bold words** and *italic words*.\n\nLast paragraph.', 'words', 1],
  ['Repeated paragraph.\n\nRepeated paragraph.', 'paragraph', 1],
  ['> العربية جميلة ومفيدة\n\nAnother paragraph.', 'جميلة', 0],
  ['Escaped \\*stars\\* and &amp; entities here.', 'entities', 0],
  ['- First item\n- Second **item** here', 'here', 0],
])('click preserves the source caret: %s', async (markdown, word, occurrence) => {
  await page.setContent('<textarea id="editor" hidden></textarea><div id="preview" style="font:20px monospace;width:600px"></div>');
  await page.evaluate(({ markdown, html, handlers }) => {
    window.editor = document.getElementById('editor'); window.preview = document.getElementById('preview');
    editor.value = markdown; preview.innerHTML = html;
    window.current = {}; window.busy = false; window.editing = false;
    window.mode = () => { editor.hidden = false; preview.hidden = true; };
    window.expandReference = () => {};
    (0, eval)(handlers);
  }, { markdown, html: Notebook.render(markdown), handlers });
  const point = await page.evaluate(({ word, occurrence }) => {
    const walker = document.createTreeWalker(preview, NodeFilter.SHOW_TEXT);
    let node, remaining = occurrence;
    while ((node = walker.nextNode())) {
      let start = 0, found;
      while ((found = node.textContent.indexOf(word, start)) !== -1) {
        if (remaining-- === 0) {
          const range = document.createRange(); range.setStart(node, found + 1); range.setEnd(node, found + 1);
          const rect = range.getBoundingClientRect(); return { x: rect.x, y: rect.y + rect.height / 2 };
        }
        start = found + word.length;
      }
    }
    throw Error('Missing target text');
  }, { word, occurrence });
  await page.mouse.click(point.x, point.y);
  const actual = await page.evaluate(() => ({ start: editor.selectionStart, end: editor.selectionEnd, focused: document.activeElement === editor }));
  let expected = -1;
  for (let i = 0; i <= occurrence; i++) expected = markdown.indexOf(word, expected + 1);
  expect(actual).toEqual({ start: expected + 1, end: expected + 1, focused: true });
});

test.each([420, 290])('scrolling between distant passages keeps the clicked caret visible at width %i', async width => {
  const markdown = Array.from({ length: 70 }, (_, i) => `Paragraph ${i}: A long passage with **formatted words** and more text to wrap across several lines. This is the target${i} location.`).join('\n\n');
  await page.setContent(`<style>textarea, #preview {box-sizing:border-box;width:${width}px;height:240px;overflow:auto;font:20px/1.8 monospace} p {margin:0 0 20px}</style><textarea id="editor" hidden></textarea><div id="preview"></div>`);
  await page.evaluate(({ markdown, html, handlers }) => {
    window.editor = document.getElementById('editor'); window.preview = document.getElementById('preview');
    editor.value = markdown; preview.innerHTML = html;
    window.current = {}; window.busy = false; window.editing = false;
    window.mode = () => { editor.hidden = false; preview.hidden = true; editor.focus(); };
    window.expandReference = () => {};
    (0, eval)(handlers);
  }, { markdown, html: Notebook.render(markdown), handlers });
  for (const index of [40, 5, 65, 20, 0, 69]) {
    await page.evaluate(() => { editor.hidden = true; preview.hidden = false; });
    await page.locator('#preview').hover();
    await page.mouse.wheel(0, index > 30 ? 30000 : -30000);
    const point = await page.evaluate(index => {
      const paragraph = preview.querySelectorAll('p')[index];
      paragraph.scrollIntoView({block:'center'});
      const node = paragraph.lastChild;
      const range = document.createRange(), offset = node.textContent.indexOf(`target${index}`) + 3;
      range.setStart(node, offset); range.setEnd(node, offset);
      const rect = range.getBoundingClientRect();
      preview.scrollTop += rect.top - preview.getBoundingClientRect().top - 100;
      const visible = range.getBoundingClientRect();
      return {x:visible.x,y:visible.y+visible.height/2};
    }, index);
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(100);
    const state = await page.evaluate(() => ({offset:editor.selectionStart,scroll:editor.scrollTop}));
    expect(state.offset).toBe(markdown.indexOf(`target${index}`) + 3);
    if (index) expect(state.scroll).toBeGreaterThan(index * 100);
    // Native caret movement would scroll substantially if our caret were off-screen.
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(50);
    const nativeScroll = await page.evaluate(() => editor.scrollTop);
    expect(Math.abs(nativeScroll - state.scroll)).toBeLessThan(72);
  }
});

test.each(['missing hit test', 'element hit test', 'focus scroll'])('preserves a scrolled click with %s', async failure => {
  const markdown = Array.from({length: 40}, (_, i) => `Paragraph ${i} with words and target${i} here.`).join('\n\n');
  await page.setContent('<style>#preview, textarea {width:400px;height:220px;overflow:auto;font:20px/1.8 monospace}</style><textarea id="editor" hidden></textarea><div id="preview" tabindex="0"></div>');
  await page.evaluate(({markdown, html, handlers, failure}) => {
    window.editor = document.getElementById('editor'); window.preview = document.getElementById('preview');
    editor.value = markdown; preview.innerHTML = html;
    window.current = {}; window.busy = false; window.editing = false;
    window.mode = () => {editor.hidden = false; preview.hidden = true; editor.focus();};
    window.expandReference = () => {};
    if (failure === 'missing hit test') {
      document.caretPositionFromPoint = () => null;
      document.caretRangeFromPoint = () => null;
    } else if (failure === 'element hit test') {
      document.caretPositionFromPoint = () => ({offsetNode: preview, offset: 0});
    } else {
      preview.addEventListener('mousedown', () => { preview.scrollTop += 150; });
    }
    (0, eval)(handlers);
  }, {markdown, html:Notebook.render(markdown), handlers, failure});
  const point = await page.evaluate(() => {
    const paragraph = preview.querySelectorAll('p')[25];
    paragraph.scrollIntoView({block:'center'});
    const node = paragraph.firstChild, index = node.nodeValue.indexOf('target25') + 3;
    const range = document.createRange();range.setStart(node,index);range.collapse(true);
    const rect = range.getBoundingClientRect();
    return {x:rect.x,y:rect.y+rect.height/2};
  });
  await page.mouse.click(point.x, point.y);
  expect(await page.evaluate(() => editor.selectionStart)).toBe(markdown.indexOf('target25') + 3);
});
