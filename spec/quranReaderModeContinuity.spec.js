'use strict';
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const { JSDOM } = require('jsdom');
const Links = require('../public/static/js/quran-reader-links');
const ReaderBar = require('../lib/QuranReaderBar');
const source = fs.readFileSync(require.resolve('../public/static/js/script.js'), 'utf8');

async function render(url, context = {}, locals = {}) {
  const parsed = new URL(url, 'http://localhost:3004');
  const req = { originalUrl: parsed.pathname + parsed.search, path: parsed.pathname, query: Object.fromEntries(parsed.searchParams), cookies: {} };
  const bar = ReaderBar.context(req, {context}, locals);
  const html = await ejs.renderFile(path.join(__dirname,'../views/sub-views/quran_bar.ejs'), {quranBar:bar,req,utils:{quranUrl:(_req,url)=>url}});
  return {html,bar,req};
}
async function browser() {
  const {html} = await render('/quran/page/42?ayah=2:255', {quranReaderRef:'2:255'});
  const dom = new JSDOM(html, {url:'http://localhost:3004/quran/page/42?ayah=2:255&script=warsh',runScripts:'outside-only'});
  dom.window.QuranReaderLinks = Links;
  dom.window.quranUrl = value => value;
  dom.window.getLastVisitedQuranTafsirSlug = () => 'ibn-kathir';
  dom.window.eval(source.slice(source.indexOf('function copyQuranReaderModeHrefs('),source.indexOf('function initQuranMenuRows(')));
  return dom;
}
function hrefs(doc) { return Object.fromEntries(Array.from(doc.querySelectorAll('[data-quran-reader-mode-link]')).map(a=>[a.dataset.quranReaderModeLink,a.getAttribute('href')])); }

test.each([
 ['/quran/2/10',{passage:true,quranReaderRef:'2:142',section:{start:'2:142',mushafPage:22}},'passage','2:142'],
 ['/quran/en-haleem/quran:2:255',{passage:true,quranReaderRef:'2:255',section:{start:'2:253',mushafPage:42},quranCommentaryBook:{type:'trans',alias:'haleem',quranBookSlug:'en-haleem'}},'passage','2:255'],
 ['/quran/tafsir/ibn-kathir/quran:2:255',{quranReaderRef:'2:255',section:{start:'2:253',mushafPage:42},quranCommentaryBook:{type:'tafsir',alias:'ibn-kathir'}},'tafsir','2:255'],
 ['/quran/page/42?ayah=2:255',{},'mushaf','2:255'],
 ['/quran/page/42?review=2:255',{},'review','2:255'],
 ['/quran/page/42?ayah=2:255&memorize',{},'memorize','2:255'],
 ['/quran/translations/quran:2:142',{quranReaderRef:'2:142',section:{mushafPage:22}},'translations','2:142'],
 ['/quran',{},'catalog',''], ['/quran/tafsir',{},'tafsir',''], ['/quran/translations',{},'translations',''], ['/quran/review',{},'review','']
])('one consistent bar on %s',async(url,ctx,mode,ref)=>{
 const {html,bar}=await render(url,ctx),dom=new JSDOM(html),doc=dom.window.document;
 expect(doc.querySelectorAll('[data-quran-bar]')).toHaveLength(1);
 expect(doc.querySelectorAll('.chapter-toc-toggle')).toHaveLength(1);
 expect(doc.querySelector('.chapter-toc-toggle').textContent.trim()).toBe('Nav');
 expect(doc.querySelector('.bi-compass')).not.toBeNull();
 expect(doc.querySelector('[href="#toc2"]')).toBeNull();
 expect(doc.querySelector('[data-quran-script-switcher]')).not.toBeNull();
 expect(Object.keys(hrefs(doc))).toEqual(['passage','tafsir','mushaf','memorize','review']);
 expect(bar.mode).toBe(mode); expect(bar.ref).toBe(ref);
 expect(hrefs(doc).review).toBe('/quran/review');
 if(ref) for(const [key,href] of Object.entries(hrefs(doc))) if(key !== 'review') expect(decodeURIComponent(href)).toContain(ref);
 dom.window.close();
});

test('successive Tafsir passages update every mode, while Mudhakkir stays independent',async()=>{
 const dom=await browser(),{document:doc}=dom.window;
 for(const [ref,page] of [['2:255',42],['2:256',43],['2:255',42]]) {
  const marker=doc.createElement('section');marker.setAttribute('data-reader-quran-ref',ref);marker.setAttribute('data-quran-reader-mushaf-href',`/quran/page/${page}`);
  dom.window.updateQuranReaderModeHrefs(marker);
  const links=hrefs(doc);
  expect(links.passage).toBe(`/quran:${ref}`);
  expect(links.tafsir).toBe(`/quran/tafsir/ibn-kathir/quran:${ref}`);
  for(const mode of ['mushaf','memorize']) { const dest=new URL(links[mode],'http://localhost');expect(dest.pathname).toBe(`/quran/page/${page}`);expect(dest.searchParams.get('ayah')).toBe(ref);expect(dest.searchParams.get('script')).toBe('warsh'); }
  expect(links.review).toBe('/quran/review');
  expect(new URL(links.memorize,'http://localhost').searchParams.has('memorize')).toBe(true);
 }
 dom.window.close();
});

test('selected Study ayah overrides passage start and resolves its exact Mushaf page',async()=>{
 const dom=await browser(),doc=dom.window.document;
 const marker=doc.createElement('main');marker.setAttribute('data-reader-quran-ref','2:253');marker.innerHTML='<section class="quran-passage-section"><span class="ayah ayah-selected" data-quran-ref="2:255"></span></section>';
 dom.window.updateQuranReaderModeHrefs(marker);
 expect(hrefs(doc).passage).toBe('/quran:2:255');
 const next=doc.createElement('section');next.setAttribute('data-reader-quran-ref','2:260');dom.window.updateQuranReaderModeHrefs(next);
 const mushaf=new URL(hrefs(doc).mushaf,'http://localhost');
 expect(mushaf.pathname).toBe('/quran/navigate');expect(mushaf.searchParams.get('ref')).toBe('2:260');
 expect(hrefs(doc).review).toBe('/quran/review');
 dom.window.close();
});

test('Mushaf selection wins over the copied page start, and scrolling pages updates context',async()=>{
 const dom=await browser(),doc=dom.window.document;
 const page=doc.createElement('article');page.setAttribute('data-quran-mushaf-page','42');page.setAttribute('data-quran-reader-first-ref','2:253');page.innerHTML='<span class="quran-mushaf-ayah-selected" data-quran-ref="2:255"></span>';
 dom.window.updateQuranReaderModeHrefs(page);expect(hrefs(doc).passage).toBe('/quran:2:255');
 const next=doc.createElement('article');next.setAttribute('data-quran-mushaf-page','43');next.setAttribute('data-quran-reader-first-ref','2:257');dom.window.updateQuranReaderModeHrefs(next);expect(hrefs(doc).passage).toBe('/quran:2:257');expect(hrefs(doc).mushaf).toContain('/page/43?ayah=2:257');
 dom.window.close();
});

test('a visible selected ayah at the page bottom wins over the next-page observer',async()=>{
 const dom=await browser(),doc=dom.window.document;
 const reader=doc.createElement('main');reader.setAttribute('data-quran-mushaf-reader','');
 reader.innerHTML='<article data-quran-mushaf-page="42"><span class="quran-mushaf-search-ayah" data-quran-ref="2:256"></span></article><article data-quran-mushaf-page="43" data-quran-reader-first-ref="2:257"></article>';
 doc.body.append(reader);
 const selected=reader.querySelector('span');selected.getBoundingClientRect=()=>({top:210,bottom:240,height:30});
 const incoming=reader.querySelectorAll('article')[1];
 dom.window.updateQuranReaderModeHrefs(incoming);
 expect(hrefs(doc).passage).toBe('/quran:2:256');
 expect(hrefs(doc).mushaf).toContain('/page/42?ayah=2:256');
 selected.getBoundingClientRect=()=>({top:-50,bottom:-20,height:30});
 dom.window.updateQuranReaderModeHrefs(incoming);
 expect(hrefs(doc).passage).toBe('/quran:2:257');
 dom.window.close();
});

test('a changed Study hero selection survives later observer updates without reusing its old page mapping',async()=>{
 const dom=await browser(),doc=dom.window.document;
 const main=doc.createElement('main');main.innerHTML='<span data-quran-infinite-anchor="1" data-quran-url="/quran:2:255" data-quran-reader-first-ref="2:255" data-quran-reader-mushaf-href="/quran/page/42?ayah=2:255"></span><section class="quran-passage-section"><span class="ayah ayah-selected" data-quran-ref="2:258"></span></section>';
 doc.body.append(main);
 dom.window.updateQuranReaderModeHrefs(main,'2:258');
 const anchor=main.querySelector('[data-quran-infinite-anchor]');
 dom.window.updateQuranReaderModeHrefs(anchor);
 expect(hrefs(doc).passage).toBe('/quran:2:258');
 const destination=new URL(hrefs(doc).mushaf,'http://localhost');
 expect(destination.pathname).toBe('/quran/navigate');expect(destination.searchParams.get('ref')).toBe('2:258');
 expect(anchor.getAttribute('data-quran-url')).toBe('/quran:2:258');
 dom.window.close();
});
