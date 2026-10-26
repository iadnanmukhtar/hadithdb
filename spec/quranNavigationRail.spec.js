'use strict';
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const { JSDOM } = require('jsdom');
jest.mock('../lib/QuranMushaf', () => ({ info: jest.fn(), page: jest.fn(), pageForRef: jest.fn() }));
jest.mock('../lib/QuranTocSubdivisions', () => ({ juzRows: jest.fn() }));
jest.mock('../lib/Utils', () => ({ quranUrl: (_req, url) => url }));
const Mushaf = require('../lib/QuranMushaf');
const Juz = require('../lib/QuranTocSubdivisions');
const Rail = require('../lib/QuranNavigationRail');
const surahs = [{num:1,name_en:'Al-Fatihah',name_ar:'الفاتحة',ayahs:7}, {num:2,name_en:'Al-Baqarah',name_ar:'البقرة',ayahs:286}];
const data = {surahs:surahs.map(s => ({num:s.num,name:s.name_en,arabic:s.name_ar,ayahs:s.ayahs})),juz:[{num:1,title:'الم',ref:'1:1'},{num:2,title:'سيقول',ref:'2:142'}],pages:604};
function response() { const res = {json:jest.fn(),redirect:jest.fn(),send:jest.fn(),status:jest.fn()}; res.status.mockReturnValue(res); return res; }
beforeEach(() => { jest.clearAllMocks(); global.surahs = surahs; Mushaf.info.mockResolvedValue({number_of_pages:604}); });

test.each([
  [{ref:'2:255',mode:'mushaf',memorize:''}, '/quran/page/42?ayah=2:255&memorize'],
  [{ref:'2:255',mode:'tafsir',book:'ibn-kathir'}, '/quran/tafsir/ibn-kathir/quran:2:255'],
  [{ref:'2:255',mode:'study',book:'sahih-international',ayat:''}, '/quran/sahih-international/quran:2:255?ayat'],
  [{ref:'2:142',mode:'translations'}, '/quran/translations/quran:2:142'],
  [{ref:'1:7'}, '/quran:1:7']
])('preserves the requested reader destination %j', async (query, target) => {
  Mushaf.pageForRef.mockResolvedValue(42); const res = response(), next = jest.fn();
  await Rail.navigate({query}, res, next); expect(next).not.toHaveBeenCalled(); expect(res.redirect).toHaveBeenCalledWith(302,target);
});
test('page navigation resolves its first verse for Study', async () => {
  Mushaf.page.mockResolvedValue({lines:[{words:[{surah:2,ayah:253,is_ayah_marker:0}]}]});
  const res = response(); await Rail.navigate({query:{page:'42',mode:'study'}},res,jest.fn());
  expect(res.redirect).toHaveBeenCalledWith(302,'/quran:2:253');
});
test.each([{ref:'2:287'},{ref:'115:1'},{ref:'2:0'},{page:'605'},{page:'2.5'}])('rejects out of range destinations %j', async query => {
  const res=response(); await Rail.navigate({query},res,jest.fn()); expect(res.status).toHaveBeenCalledWith(400); expect(res.redirect).not.toHaveBeenCalled();
});
test('metadata exposes canonical surah counts and Juz references', async () => {
  Juz.juzRows.mockResolvedValue([{num:2,title:'سيقول',start:'2:142'}]); const res=response();
  await Rail.data({},res,jest.fn()); expect(res.json.mock.calls[0][0]).toMatchObject({pages:604,surahs:[{num:1,ayahs:7},{num:2,ayahs:286}],juz:[{ref:'2:142'}]});
});
async function browser(fetcher) {
  const html = await ejs.renderFile(path.join(__dirname,'../views/sub-views/quran_navigation_rail.ejs'), {navigationMode:'mushaf',navigationBook:null,utils:{quranUrl:(_req,url)=>url},req:{}});
  const dom = new JSDOM(html,{url:'http://localhost/quran/page/42?memorize',runScripts:'outside-only'});
  dom.window.fetch = fetcher || jest.fn().mockResolvedValue({ok:true,json:async()=>data});
  dom.window.quranReaderModeFirstRef = () => '2:255';
  dom.window.eval(fs.readFileSync(path.join(__dirname,'../public/static/js/quran-navigation.js'),'utf8'));
  const rail=dom.window.document.querySelector('aside');
  rail.dispatchEvent(new dom.window.Event('show.bs.offcanvas'));
  await new Promise(resolve=>setImmediate(resolve));
  return {dom,rail,doc:dom.window.document};
}
test('tabs search both languages, select surah verses, and retain Mushaf mode', async () => {
  const {doc,dom}=await browser();
  expect(doc.querySelector('.is-current').textContent).toContain('Juz 2');
  doc.querySelector('[data-navigation-tab="verse"]').click();
  expect(doc.querySelectorAll('.quran-navigation-verses a')).toHaveLength(286);
  const verse=Array.from(doc.querySelectorAll('.quran-navigation-verses a')).find(a=>a.textContent==='255');
  expect(verse.href).toContain('ref=2%3A255&mode=mushaf&memorize=');
  const input=doc.querySelector('input'); input.value='الفاتحة'; input.dispatchEvent(new dom.window.Event('input'));
  const choices=Array.from(doc.querySelectorAll('.quran-navigation-column:first-child a')).filter(a=>!a.hidden);
  expect(choices).toHaveLength(1); choices[0].click();
  expect(doc.querySelectorAll('.quran-navigation-verses a')).toHaveLength(7);
  doc.querySelector('[data-navigation-tab="page"]').click();
  expect(doc.querySelectorAll('.quran-navigation-list a')).toHaveLength(604);
  dom.window.close();
});
test('failed metadata request offers a working retry', async () => {
  const fetcher=jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ok:true,json:async()=>data});
  const {rail,doc,dom}=await browser(fetcher); expect(doc.querySelector('[role="status"]').textContent).toContain('Retry');
  doc.querySelector('[role="status"] button').click(); await new Promise(resolve=>setImmediate(resolve));
  expect(rail.querySelectorAll('.quran-navigation-list a')).toHaveLength(2); dom.window.close();
});
test('Mushaf surah-name trigger opens the Surah tab for the clicked page', async () => {
  const {rail,doc,dom}=await browser();
  const trigger=doc.createElement('button'); trigger.dataset.navigationOpenTab='surah'; trigger.dataset.navigationSurah='1';
  const event=new dom.window.Event('show.bs.offcanvas'); Object.defineProperty(event,'relatedTarget',{value:trigger}); rail.dispatchEvent(event);
  expect(doc.querySelector('[data-navigation-tab="surah"]').getAttribute('aria-selected')).toBe('true');
  expect(doc.querySelector('.quran-navigation-list .is-current').textContent).toContain('Al-Fatihah');
  dom.window.close();
});
function mushafLabels() {
  const template=fs.readFileSync(path.join(__dirname,'../views/quran_mushaf.ejs'),'utf8');
  const start=template.indexOf('<span class="quran-mushaf-page-meta">');
  return ejs.render(template.slice(start,template.indexOf('</header>',start)),{firstJuz:{num:1},firstSurah:surahs[0],mushaf:{number:604}});
}
test('Mushaf navigation labels render without number inputs or forms', () => {
  const dom=new JSDOM(mushafLabels()), doc=dom.window.document;
  expect(doc.querySelectorAll('input, form')).toHaveLength(0);
  expect(doc.querySelectorAll('[data-bs-target="#quran-navigation-rail"]')).toHaveLength(4);
  expect(doc.querySelector('[data-navigation-open-tab="juz"]').textContent).toBe('Juz 1');
  expect(doc.querySelector('.quran-mushaf-page-number button').textContent).toBe('604');
  dom.window.close();
});
test.each([['juz','Juz 1'],['page','Page 604'],['surah','Al-Fatihah']])('Mushaf %s label opens its tab and selects the clicked page context',async (tab,label)=>{
  const {rail,doc,dom}=await browser();
  const labels=doc.createElement('div'); labels.innerHTML=mushafLabels(); doc.body.append(labels);
  const trigger=labels.querySelector(`[data-navigation-open-tab="${tab}"]`);
  const event=new dom.window.Event('show.bs.offcanvas'); Object.defineProperty(event,'relatedTarget',{value:trigger}); rail.dispatchEvent(event);
  expect(doc.querySelector(`[data-navigation-tab="${tab}"]`).getAttribute('aria-selected')).toBe('true');
  expect(rail.querySelector('.quran-navigation-list .is-current').textContent).toContain(label);
  dom.window.close();
});
test('Mushaf toolbar Juz progress follows the replacement label without an input',()=>{
  const dom=new JSDOM('<div id="sheet"><button data-navigation-juz="2">Juz 2</button></div><span data-quran-mushaf-current-juz></span><div data-quran-mushaf-header-juz="2" data-quran-mushaf-juz-start-page="22" data-quran-mushaf-juz-end-page="41"><a></a></div>',{runScripts:'outside-only'});
  const script=fs.readFileSync(path.join(__dirname,'../public/static/js/script.js'),'utf8');
  dom.window.eval(script.slice(script.indexOf('function updateQuranMushafHeaderJuz('),script.indexOf('function updateQuranMushafVisiblePage(')));
  dom.window.updateQuranMushafHeaderJuz(31,dom.window.document.getElementById('sheet'));
  expect(dom.window.document.querySelector('[data-quran-mushaf-current-juz]').textContent).toBe('2 · 50%');
  expect(dom.window.document.querySelector('a').getAttribute('aria-current')).toBe('page');
  dom.window.close();
});
