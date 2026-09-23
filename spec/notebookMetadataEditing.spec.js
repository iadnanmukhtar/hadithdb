'use strict';
const fs = require('fs');
const ejs = require('ejs');
const {chromium} = require('playwright');
const source = fs.readFileSync(require.resolve('../public/static/js/notebook.js'), 'utf8');
const functions = ['mode', 'renderNoteMetadata', 'renderNoteTags'].map(name => source.match(new RegExp(`  function ${name}\\([^]*?\\n  }`))[0]).join('\n');
const handlers = source.slice(source.indexOf('  function editTags()'), source.indexOf("  toggle.addEventListener('click'"));
let browser, page, markup;
jest.setTimeout(30000);
beforeAll(async () => {
  markup = (await ejs.renderFile(require.resolve('../views/sub-views/notebook_modal.ejs'), {utils:{scriptAssetVersion:()=> 'test'}})).replace(/<script[^]*?<\/script>/g,'');
  browser = await chromium.launch({channel:'chrome',headless:true});
});
afterAll(async () => {await browser?.close();});
beforeEach(async () => {
  page = await browser.newPage({viewport:{width:390,height:844}});
  await page.setContent('<style>.d-flex{display:flex!important}</style>'+markup);
  await page.evaluate(({functions,handlers}) => {
    document.getElementById('notebook-modal').setAttribute('aria-hidden','false');
    window.editor=document.getElementById('notebook-editor'); window.preview=document.getElementById('notebook-preview');
    window.titleEditor=document.getElementById('notebook-title-editor'); window.tagEditor=document.getElementById('notebook-tag-editor');
    window.toggle=document.getElementById('notebook-preview-button');
    window.editing=false; window.titleEditing=false; window.tagsEditing=false; window.busy=false;
    window.current={title:'My note',hashtags:[],version:0}; window.wikiAutocomplete={close:()=>{}};
    window.scheduleSave=()=>{}; titleEditor.value='My note'; tagEditor.value='reflection';
    (0,eval)(functions+'\n'+handlers); mode(true);
  },{functions,handlers});
});
afterEach(async () => {await page.close();});
test('body editing keeps title and tags collapsed until each is clicked', async () => {
  expect(await page.locator('#notebook-title-editor').isVisible()).toBe(false);
  expect(await page.locator('#notebook-tag-editor').isVisible()).toBe(false);
  expect(await page.locator('#notebook-tag-help').isVisible()).toBe(false);
  expect(await page.locator('#notebook-references').count()).toBe(0);
  await page.locator('#notebook-note-title').click();
  expect(await page.locator('#notebook-title-editor').isVisible()).toBe(true);
  expect(await page.locator('#notebook-tag-editor').isVisible()).toBe(false);
  await page.locator('#notebook-title-editor').fill('Updated title');
  await page.locator('#notebook-editor').click();
  expect(await page.locator('#notebook-title-editor').isVisible()).toBe(false);
  expect(await page.locator('#notebook-note-title').textContent()).toBe('Updated title');
  await page.locator('#notebook-note-tags').click();
  expect(await page.locator('#notebook-tag-editor').isVisible()).toBe(true);
  expect(await page.locator('#notebook-note-tags').isVisible()).toBe(false);
  await page.locator('#notebook-tag-editor').fill('reflection study');
  await page.locator('#notebook-tag-editor').press('Enter');
  expect(await page.locator('#notebook-tag-editor').isVisible()).toBe(false);
  expect(await page.locator('#notebook-tag-help').isVisible()).toBe(false);
  expect(await page.locator('#notebook-note-tags').textContent()).toContain('study');
});
test('an untitled note shows a compact clickable title placeholder', async () => {
  await page.evaluate(() => {titleEditor.value='';mode(true);});
  expect(await page.locator('#notebook-note-title').textContent()).toBe('Add a title');
  expect(await page.locator('#notebook-title-editor').isVisible()).toBe(false);
  await page.locator('#notebook-note-title').press('Enter');
  expect(await page.locator('#notebook-title-editor').isVisible()).toBe(true);
});
