'use strict';
const fs=require('fs'),{chromium}=require('playwright');
let browser;
beforeAll(async()=>{browser=await chromium.launch({channel:'chrome',headless:true});});
afterAll(async()=>browser?.close());
test.each([390,1200])('article expands and restores without losing its draft at %i px',async width=>{
 const page=await browser.newPage({viewport:{width,height:850}});
 try{
  await page.setContent(`<style>:root{--bs-body-bg:#fff;--bs-body-color:#222}body{margin:0}header{height:200px}main{padding:20px}textarea{width:90%;height:100px}</style><header><button id="outside">Navigation</button></header><main><aside id="already-hidden" hidden>Hidden</aside><section class="community-editor"><button id="community-editor-fullscreen" aria-label="Expand article" aria-pressed="false"><i></i></button><div class="community-editor-top">Article</div><form><textarea id="draft">Draft العربية</textarea><button id="save">Save draft</button></form></section></main><footer>Footer</footer>`);
  await page.addStyleTag({path:'public/static/css/community.css'});
  await page.addScriptTag({path:'public/static/js/community-editor-layout.js'});
  await page.locator('#draft').fill('Edited draft العربية');
  await page.getByRole('button',{name:'Expand article'}).click();
  const box=await page.locator('.community-editor').boundingBox();
  expect(box.x).toBe(0);expect(box.y).toBe(0);expect(box.width).toBe(width);expect(box.height).toBe(850);
  expect(await page.locator('header').evaluate(el=>el.hidden && el.inert)).toBe(true);
  expect(await page.locator('#draft').inputValue()).toBe('Edited draft العربية');
  await page.locator('#save').focus();await page.keyboard.press('Tab');
  expect(await page.locator('#community-editor-fullscreen').evaluate(el=>el===document.activeElement)).toBe(true);
  await page.screenshot({path:`/tmp/article-fullscreen-${width}.png`});
  await page.keyboard.press('Escape');
  expect(await page.getByRole('button',{name:'Expand article'}).getAttribute('aria-pressed')).toBe('false');
  expect(await page.locator('header').evaluate(el=>!el.hidden && !el.inert)).toBe(true);
  expect(await page.locator('#already-hidden').evaluate(el=>el.hidden)).toBe(true);
  expect(await page.locator('#draft').inputValue()).toBe('Edited draft العربية');
 }finally{await page.close();}
});
test('article view includes the fullscreen control and initializer',()=>{
 const source=fs.readFileSync('views/community.ejs','utf8');
 expect(source).toContain('id="community-editor-fullscreen"');
 expect(source).toContain('/static/js/community-editor-layout.js');
 require('ejs').compile(source,{filename:'views/community.ejs'});
});
