'use strict';
const { replacement } = require('../public/static/js/notebook-shortcuts');
const { chromium } = require('playwright');
const fs = require('fs');
const source = fs.readFileSync(require.resolve('../public/static/js/notebook-shortcuts'), 'utf8');
const apply = (value, edit) => value.slice(0, edit.start) + edit.text + value.slice(edit.end);

test.each(['**', '*', '__', '==', '~~'])('selection formatting toggles %s on Arabic without altering diacritics', marker => {
  const value = 'Before العَرَبِيَّة after', start = 7, end = value.indexOf(' after');
  const edit = replacement(value, start, end, marker);
  const formatted = apply(value, edit);
  expect(formatted).toBe(`Before ${marker}العَرَبِيَّة${marker} after`);
  const remove = replacement(formatted, edit.selectStart, edit.selectEnd, marker);
  expect(apply(formatted, remove)).toBe(value);
});
test('blank selections are unchanged and paragraph whitespace stays outside markers', () => {
  expect(replacement('text', 1, 1, '**')).toBeNull();
  expect(replacement(' \n ', 0, 3, '**')).toBeNull();
  const value = ' one \n\n two ';
  const edit = replacement(value, 0, value.length, '**');
  expect(apply(value, edit)).toBe(' **one** \n\n **two** ');
  const remove = replacement(apply(value, edit), edit.selectStart, edit.selectEnd, '**');
  expect(apply(apply(value, edit), remove)).toBe(value);
});
test('italic and bold can be combined without confusing their markers', () => {
  expect(apply('**word**', replacement('**word**', 2, 6, '*'))).toBe('***word***');
  expect(apply('***word***', replacement('***word***', 3, 7, '*'))).toBe('**word**');
  expect(apply('***word***', replacement('***word***', 3, 7, '**'))).toBe('*word*');
  expect(apply('<u>word</u>', replacement('<u>word</u>', 3, 7, '__'))).toBe('word');
});

let browser, page;
beforeAll(async () => { browser = await chromium.launch({ channel: 'chrome', headless: true }); });
afterAll(async () => { await browser?.close(); });
beforeEach(async () => {
  page = await browser.newPage();
  await page.setContent('<textarea id="editor"></textarea><input id="title">');
  await page.addScriptTag({ content: source });
  await page.evaluate(() => {
    window.editor = document.getElementById('editor'); window.allowed = true; window.inputs = 0;
    editor.addEventListener('input', () => inputs++);
    NotebookShortcuts.install(editor, () => allowed, () => {});
    editor.value = 'Before العربية after'; editor.focus(); editor.setSelectionRange(7, 14, 'backward');
  });
});
afterEach(async () => { await page?.close(); });
test.each([
  ['b', '**'], ['i', '*'], ['u', '__'], ['Shift+h', '=='], ['Shift+x', '~~']
])('%s formats, retains selection, toggles, and supports native undo', async (key, marker) => {
  for (const modifier of ['Meta', 'Control']) {
    await page.keyboard.press(`${modifier}+${key}`);
    expect(await page.locator('#editor').inputValue()).toBe(`Before ${marker}العربية${marker} after`);
    expect(await page.evaluate(() => editor.value.slice(editor.selectionStart, editor.selectionEnd))).toBe('العربية');
    expect(await page.evaluate(() => editor.selectionDirection)).toBe('backward');
    await page.keyboard.press(`${modifier}+${key}`);
    expect(await page.locator('#editor').inputValue()).toBe('Before العربية after');
  }
  expect(await page.evaluate(() => inputs)).toBeGreaterThan(0);
  await page.keyboard.press('Meta+' + key);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  expect(await page.locator('#editor').inputValue()).toBe('Before العربية after');
});
test('shortcuts stay in the enabled note editor and ignore unrelated combinations', async () => {
  await page.evaluate(() => allowed = false);
  await page.keyboard.press('Meta+b');
  expect(await page.locator('#editor').inputValue()).toBe('Before العربية after');
  await page.evaluate(() => allowed = true);
  await page.keyboard.press('Meta+Shift+s');
  expect(await page.locator('#editor').inputValue()).toBe('Before العربية after');
  await page.locator('#title').fill('Title');
  await page.locator('#title').press('Meta+b');
  expect(await page.locator('#title').inputValue()).toBe('Title');
});
test('Arabic keyboard letters use the physical shortcut key and ignore composition', async () => {
  await page.evaluate(() => editor.dispatchEvent(new KeyboardEvent('keydown', {key:'لا',code:'KeyB',ctrlKey:true,isComposing:true,bubbles:true,cancelable:true})));
  expect(await page.locator('#editor').inputValue()).toBe('Before العربية after');
  await page.evaluate(() => editor.dispatchEvent(new KeyboardEvent('keydown', {key:'لا',code:'KeyB',ctrlKey:true,bubbles:true,cancelable:true})));
  expect(await page.locator('#editor').inputValue()).toBe('Before **العربية** after');
});
