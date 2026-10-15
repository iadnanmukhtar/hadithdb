'use strict';
const fs = require('fs');
const ejs = require('ejs');
const {chromium} = require('playwright');
const source = fs.readFileSync(require.resolve('../public/static/js/notebook.js'), 'utf8');
const functions = ['mode', 'renderNoteMetadata', 'renderNoteTags'].map(name => source.match(new RegExp(`  function ${name}\\([^]*?\\n  }`))[0]).join('\n');
const handlers = source.slice(source.indexOf("  const tagsToggle ="), source.indexOf("  toggle.addEventListener('click'"));
let browser, page, markup;
jest.setTimeout(30000);
beforeAll(async () => {
  markup = (await ejs.renderFile(require.resolve('../views/sub-views/notebook_modal.ejs'), {utils:{scriptAssetVersion:()=> 'test'}})).replace(/<script[^]*?<\/script>/g,'');
  browser = await chromium.launch({channel:'chrome',headless:true});
});
afterAll(async () => {await browser?.close();});
beforeEach(async () => {
  page = await browser.newPage({viewport:{width:390,height:844}});
  const siteStyles = fs.readFileSync(require.resolve('../public/static/css/style.css'), 'utf8').replace(/@import[^;]+;/g, '');
  await page.setContent('<style>'+siteStyles+'\n.d-flex{display:flex!important}</style>'+markup);
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
test('tags toggle reclaims space and restores tag editing with keyboard controls', async () => {
  const bar = page.locator('#notebook-tag-bar');
  const button = page.locator('#notebook-tags-toggle');
  const height = await bar.evaluate(element => element.getBoundingClientRect().height);
  expect(height).toBeGreaterThan(0);
  await button.press('Enter');
  expect(await bar.isVisible()).toBe(false);
  expect(await button.getAttribute('aria-expanded')).toBe('false');
  expect(await button.getAttribute('aria-label')).toBe('Show tags');
  expect(await bar.evaluate(element => element.getBoundingClientRect().height)).toBe(0);
  await button.press('Space');
  expect(await bar.isVisible()).toBe(true);
  expect(await button.getAttribute('aria-expanded')).toBe('true');
  await page.locator('#notebook-note-tags').click();
  expect(await page.locator('#notebook-tag-editor').isVisible()).toBe(true);
});
test.each([390, 1280])('dates open without growing the footer at %ipx', async width => {
  await page.setViewportSize({width, height:844});
  await page.evaluate(() => {
    current.version=1; current.created_at='2026-10-09T21:17:00Z'; current.updated_at='2026-10-15T17:22:00Z';
    renderNoteMetadata();
  });
  const footer = page.locator('#notebook-modal .modal-footer');
  const height = await footer.evaluate(element => element.getBoundingClientRect().height);
  const summary = page.locator('#notebook-dates summary');
  expect(await summary.isVisible()).toBe(true);
  expect(await page.locator('#notebook-dates-content').isVisible()).toBe(false);
  await summary.press('Enter');
  expect(await page.locator('#notebook-dates-content').textContent()).toContain('Created:');
  expect(await page.locator('#notebook-dates-content').textContent()).toContain('Modified:');
  expect(await page.locator('#notebook-dates-content').isVisible()).toBe(true);
  expect(await footer.evaluate(element => element.getBoundingClientRect().height)).toBe(height);
  await summary.press('Escape');
  expect(await page.locator('#notebook-dates-content').isVisible()).toBe(false);
});

test.each([390, 1280])('footer icons share one row with site styles at %ipx', async width => {
  await page.setViewportSize({width, height:844});
  await page.evaluate(() => { current.version=1; renderNoteMetadata(); });
  const positions = await page.locator('#notebook-modal .modal-footer > .notebook-tool:not([hidden]), #notebook-dates summary').evaluateAll(elements => elements.map(element => {
    const rect = element.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, height: rect.height };
  }).filter(rect => rect.height > 0));
  expect(positions.length).toBeGreaterThan(4);
  expect(Math.max(...positions.map(rect => rect.top)) - Math.min(...positions.map(rect => rect.top))).toBeLessThan(2);
  await page.locator('#notebook-dates summary').click();
  const bounds = await page.locator('#notebook-dates-content').boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
});
test.each([768, 1280])('fullscreen zoom sits left of icons without moving the right edge at %ipx', async width => {
  await page.setViewportSize({width,height:844});
  await page.evaluate(() => {current.version=1; renderNoteMetadata();});
  const saveBefore = await page.locator('#notebook-save').boundingBox();
  await page.locator('#notebook-modal .modal-dialog').evaluate(element => element.classList.add('modal-fullscreen'));
  const zoom = await page.locator('#notebook-zoom-control').boundingBox();
  const dates = await page.locator('#notebook-dates').boundingBox();
  const save = await page.locator('#notebook-save').boundingBox();
  expect(zoom.x + zoom.width).toBeLessThanOrEqual(dates.x);
  expect(Math.abs(zoom.y + zoom.height / 2 - save.y - save.height / 2)).toBeLessThan(2);
  expect(Math.abs(save.x - saveBefore.x)).toBeLessThan(2);
});
