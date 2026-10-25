'use strict';
const {chromium}=require('playwright');
const path=require('path');
test('blog edit links follow ownership, sign-out, and infinite-scroll additions',async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage();
  await page.setContent('<main><a hidden data-blog-edit data-author="owner">Edit article</a><a hidden data-blog-edit data-author="other">Edit article</a></main>');
  await page.evaluate(()=>{window.token=null;window.hadithAuth={getToken:async()=>window.token};window.fetch=async()=>({ok:true,json:async()=>({author:{handle:'owner'}})});});
  await page.addScriptTag({path:path.join(__dirname,'../public/static/js/blog-edit.js')});
  expect(await page.locator('[data-blog-edit]:visible').count()).toBe(0);
  await page.evaluate(()=>{window.token='owner-token';document.dispatchEvent(new Event('hadithAuthChanged'));});
  await page.waitForFunction(()=>document.querySelectorAll('[data-blog-edit]:not([hidden])').length===1);
  await page.evaluate(()=>document.querySelector('main').insertAdjacentHTML('beforeend','<a hidden data-blog-edit data-author="owner">Edit loaded article</a>'));
  await page.waitForFunction(()=>document.querySelectorAll('[data-blog-edit]:not([hidden])').length===2);
  await page.evaluate(()=>{window.token=null;document.dispatchEvent(new Event('hadithAuthChanged'));});
  expect(await page.locator('[data-blog-edit]:visible').count()).toBe(0);
 }finally{await browser.close();}
});
