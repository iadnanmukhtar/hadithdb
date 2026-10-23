'use strict';
const ejs = require('ejs');
const fs = require('fs');
const { chromium } = require('playwright');
let browser, page, markup;
jest.setTimeout(30000);
beforeAll(async () => {
  markup = (await ejs.renderFile(require.resolve('../views/sub-views/notebook_modal.ejs'), { utils: { scriptAssetVersion: () => 'test' } })).replace(/<script[^]*?<\/script>/g, '');
  browser = await chromium.launch({ channel: 'chrome', headless: true });
});
afterAll(async () => browser?.close());
beforeEach(async () => {
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.setContent('<style>[hidden]{display:none!important} #notebook-modal{display:block}</style>' + markup);
  if (process.env.NOTEBOOK_QA_BOOTSTRAP) {
    await page.addStyleTag({ content: fs.readFileSync(process.env.NOTEBOOK_QA_BOOTSTRAP, 'utf8') });
    await page.addStyleTag({ path: require.resolve('../public/static/css/style.css') });
  }
  await page.locator('#notebook-modal').evaluate(node => { node.setAttribute('aria-hidden', 'false'); node.classList.add('show'); });
  await page.addScriptTag({ path: require.resolve('../public/static/js/notebook-yaml.min.js') });
  await page.addScriptTag({ path: require.resolve('../public/static/js/notebook-frontmatter.js') });
  await page.evaluate(() => {
    document.getElementById('notebook-attachments').hidden = false;
    window.editor = document.getElementById('notebook-editor');
    window.title = document.getElementById('notebook-title-editor');
    window.tags = document.getElementById('notebook-tag-editor');
    editor.value = 'Body text'; title.value = 'My note'; tags.value = 'study صلاة';
    window.state = { busy: false, current: { source_key: 'general', version: '22', revision: 'private-checksum', created_at: '2026-10-12', attachments: [{ source_key: 'item:77', source_title: 'quran:2:255', source_url: '/quran:2:255' }] } };
    window.changes = 0;
    window.controls = NotebookFrontmatterEditor.install({ editor, titleEditor: title, tagEditor: tags, context: () => state, changed: () => changes++, render: () => {} });
    editor.value = controls.load(editor.value);
  });
});
afterEach(async () => page.close());
test('show/hide exposes current editable metadata without changing the note or revealing system fields', async () => {
  expect(await page.locator('#notebook-frontmatter-panel').isHidden()).toBe(true);
  await page.getByRole('button', { name: 'Show frontmatter', exact: true }).click();
  const value = await page.locator('#notebook-frontmatter-editor').inputValue();
  expect(value).toContain('My note'); expect(value).toContain('study'); expect(value).toContain('صلاة'); expect(value).toContain('quran:2:255');
  for (const field of ['source_key', 'created_at', 'revision', 'version', 'hadithunlocked', 'private-checksum']) expect(value).not.toContain(field);
  expect(await page.evaluate(() => changes)).toBe(0);
  expect(await page.locator('#notebook-editor').inputValue()).toBe('Body text');
  expect(await page.locator('#notebook-frontmatter').getAttribute('aria-expanded')).toBe('true');
  await page.screenshot({ path: '/tmp/notebook-frontmatter-panel-mobile.png' });
  await page.getByRole('button', { name: 'Hide frontmatter', exact: true }).click();
  expect(await page.locator('#notebook-frontmatter-panel').isHidden()).toBe(true);
});
test('title and tags controls immediately synchronize YAML while retaining custom fields and body', async () => {
  await page.evaluate(() => { editor.value = controls.load('---\ncustom:\n  topic: صبر\nattachments: []\n---\n\nBody text'); title.value = 'Changed title'; title.dispatchEvent(new Event('input')); tags.value = 'reflection'; tags.dispatchEvent(new Event('input')); });
  await page.getByRole('button', { name: 'Show frontmatter', exact: true }).click();
  const result = await page.evaluate(() => jsyaml.safeLoad(document.getElementById('notebook-frontmatter-editor').value));
  expect(result).toEqual({ title: 'Changed title', tags: ['reflection'], links: [], custom: { topic: 'صبر' } });
  expect(await page.locator('#notebook-editor').inputValue()).toBe('\nBody text');
  expect(await page.evaluate(() => controls.markdown(editor.value))).toMatch(/^---\n[\s\S]*custom:[\s\S]*---\n\nBody text$/);
});
test('YAML edits synchronize controls, reject protected fields, and retain invalid drafts', async () => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('button', { name: 'Show frontmatter', exact: true }).click();
  await page.locator('#notebook-frontmatter-editor').fill('title: From YAML\ntags: [reflection, صلاة]\nattachments: []\nauthor: أحمد');
  expect(await page.locator('#notebook-title-editor').inputValue()).toBe('From YAML');
  expect(await page.locator('#notebook-tag-editor').inputValue()).toBe('reflection صلاة');
  expect(await page.evaluate(() => controls.valid())).toBe(true);
  await page.screenshot({ path: '/tmp/notebook-frontmatter-panel-desktop.png' });
  await page.locator('#notebook-frontmatter-editor').fill('title: Safe\nversion: 999');
  expect(await page.evaluate(() => controls.valid())).toBe(false);
  expect(await page.locator('#notebook-frontmatter-status').textContent()).toContain('system metadata');
  await page.locator('#notebook-frontmatter-editor').fill('tags: [');
  expect(await page.evaluate(() => controls.valid())).toBe(false);
  expect(await page.locator('#notebook-editor').inputValue()).toBe('Body text');
  await page.locator('#notebook-frontmatter-editor').fill('title: Repaired\ntags: []');
  expect(await page.evaluate(() => controls.valid())).toBe(true);
  expect(await page.locator('#notebook-editor').inputValue()).toBe('Body text');
  await page.evaluate(() => controls.reset());
  expect(await page.locator('#notebook-frontmatter-panel').isHidden()).toBe(true);
  expect(await page.locator('#notebook-frontmatter-editor').inputValue()).toBe('');
});

test('an existing custom header does not hide saved links that have no YAML list yet', async () => {
  await page.evaluate(() => {
    state.current.markdown = '---\ntopic: Patience\n---\nBody text';
    editor.value = controls.load(state.current.markdown);
  });
  await page.getByRole('button', { name: 'Show frontmatter', exact: true }).click();
  const value = await page.evaluate(() => jsyaml.safeLoad(document.getElementById('notebook-frontmatter-editor').value));
  expect(value.links).toEqual(['quran:2:255']);
  expect(value.topic).toBe('Patience');
});
test('removing an existing YAML attachment list is not undone by refreshing FM', async () => {
  await page.evaluate(() => {
    state.current.markdown = '---\nattachments: [quran:2:255]\n---\nBody';
    editor.value = controls.load('---\ntopic: Patience\n---\nBody');
  });
  await page.getByRole('button', { name: 'Show frontmatter', exact: true }).click();
  const value = await page.evaluate(() => jsyaml.safeLoad(document.getElementById('notebook-frontmatter-editor').value));
  expect(value.links).toEqual([]);
});

test('original and additional items appear together and the original can be removed in FM', async () => {
  await page.evaluate(() => {
    Object.assign(state.current, { source_key: 'item:42', source_title: 'bukhari:100', source_url: '/bukhari:100', markdown: '---\nattachments: [quran:2:255]\n---\nBody' });
    editor.value = controls.load(state.current.markdown);
  });
  await page.getByRole('button', { name: 'Show frontmatter', exact: true }).click();
  expect(await page.evaluate(() => jsyaml.safeLoad(document.getElementById('notebook-frontmatter-editor').value).links)).toEqual(['bukhari:100', 'quran:2:255']);
  await page.locator('#notebook-frontmatter-editor').fill('links: [quran:2:255]');
  await page.evaluate(() => controls.refresh());
  expect(await page.evaluate(() => controls.linksEdited())).toBe(true);
  expect(await page.evaluate(() => jsyaml.safeLoad(document.getElementById('notebook-frontmatter-editor').value).links)).toEqual(['quran:2:255']);
});

test('imported frontmatter is kept out of the body editor and round-trips through the pulldown', async () => {
  await page.evaluate(() => {
    Object.assign(state.current, { title: 'Imported', tags: ['riyad'], markdown: '---\ntitle: Imported\ntags: [riyad]\nauthor: أحمد\n---\n# Body' });
    editor.value = controls.load(state.current.markdown);
    title.value = state.current.title; tags.value = state.current.tags.join(' ');
  });
  expect(await page.locator('#notebook-editor').inputValue()).toBe('# Body');
  await page.getByRole('button', { name: 'Show frontmatter', exact: true }).click();
  expect(await page.evaluate(() => jsyaml.safeLoad(document.getElementById('notebook-frontmatter-editor').value))).toMatchObject({ title: 'Imported', tags: ['riyad'], author: 'أحمد' });
  const combined = await page.evaluate(() => controls.markdown(editor.value));
  expect(combined).toContain('author: أحمد');
  expect(combined).toMatch(/---\n# Body$/);
});
