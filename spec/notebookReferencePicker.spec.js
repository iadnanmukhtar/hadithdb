'use strict';
const fs = require('fs');
const {chromium} = require('playwright');
const script = fs.readFileSync(require.resolve('../public/static/js/notebook-references.js'),'utf8');
const template = fs.readFileSync(require.resolve('../views/sub-views/notebook_modal.ejs'),'utf8');
const markup = template.match(/    <section id="notebook-references"[^]*?<\/section>/)[0];
let browser, page;
jest.setTimeout(30000);
beforeAll(async () => {browser=await chromium.launch({channel:'chrome',headless:true});});
afterAll(async () => {await browser?.close();});
beforeEach(async () => {
  page=await browser.newPage(); await page.setContent(markup);
  await page.addScriptTag({content:script});
  await page.evaluate(() => {
    window.changes=[];
    window.picker=window.NotebookReferences.install(document.getElementById('notebook-references'), {
      search:async () => ({references:[
        {ref:'bukhari:1',label:'bukhari:1',url:'/bukhari:1',type:'Hadith',fragment:'Actions depend on <i>intentions</i>'},
        {ref:'quran:2:255',label:'quran:2:255',url:'/quran:2:255',type:'Ayah',fragment:'اللَّهُ لَا إِلَٰهَ إِلَّا هُوَ'}
      ]}),
      onChange:value => changes.push(value),
      onEdit:() => picker.setEditing(true)
    });
    picker.reset();
  });
});
afterEach(async () => {await page.close();});
test('regular note UI attaches multiple references by keyboard and click, removes one, and displays saved links', async () => {
  await page.getByRole('button',{name:'Attach reference'}).click();
  const input=page.getByLabel('Search references to attach');
  await input.fill('intention');
  await page.getByRole('button',{name:/bukhari:1 · Hadith/}).waitFor();
  await input.press('ArrowDown'); await page.keyboard.press('Enter');
  await input.fill('quran');
  await page.getByRole('button',{name:/quran:2:255 · Ayah/}).click();
  expect(await page.evaluate(() => changes.at(-1).map(item=>item.ref))).toEqual(['bukhari:1','quran:2:255']);
  await input.fill('intention');
  await page.getByRole('status').filter({hasText:'No matching references.'}).waitFor();
  await page.getByRole('button',{name:'Remove reference bukhari:1'}).click();
  expect(await page.evaluate(() => changes.at(-1).map(item=>item.ref))).toEqual(['quran:2:255']);
  await page.evaluate(() => {picker.reset(changes.at(-1)); picker.setEditing(false);});
  expect(await page.getByRole('link',{name:'quran:2:255'}).getAttribute('href')).toBe('/quran:2:255');
  expect(await input.isVisible()).toBe(false);
  expect(await page.getByRole('button',{name:/Remove reference/}).count()).toBe(0);
});
test('resetting to another note ignores a stale search response', async () => {
  await page.evaluate(() => {
    const root = document.getElementById('notebook-references'); root.replaceWith(root.cloneNode(true));
    picker=window.NotebookReferences.install(document.getElementById('notebook-references'), {
      search:() => new Promise(resolve => {window.finishSearch=resolve;}), onChange:()=>{},onEdit:()=>{}
    });
    picker.setEditing(true);
  });
  await page.getByLabel('Search references to attach').fill('test');
  await page.waitForFunction(() => !!window.finishSearch);
  await page.evaluate(() => {picker.reset([]);finishSearch({references:[{ref:'old:1',label:'old:1',url:'/old:1'}]});});
  expect(await page.locator('[data-reference-results]').isVisible()).toBe(false);
});
