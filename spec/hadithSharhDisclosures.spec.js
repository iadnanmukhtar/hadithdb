'use strict';
const fs = require('fs');
const { JSDOM } = require('jsdom');
const script = fs.readFileSync('public/static/js/script.js', 'utf8');
const init = script.slice(script.indexOf('function initHadithSharhDisclosures('), script.indexOf('function hadithSharhGoogleUrl('));
const column = (id, lang) => `<div class="hadith-sharh-collapse-wrap"><div id="${id}" data-hadith-sharh-collapsible></div><button data-hadith-sharh-expand data-hadith-sharh-more-label="${lang === 'en' ? 'More...' : 'مزيد...'}" data-hadith-sharh-less-label="${lang === 'en' ? 'Less...' : 'أقل...'}" aria-expanded="false" hidden></button></div>`;
test.each(['en', 'ar'])('%s control toggles both languages, leaving other entries alone', lang => {
 const dom = new JSDOM(`<article class="hadith-sharh-entry">${column('en','en')}${column('ar','ar')}</article><article class="hadith-sharh-entry">${column('other','en')}</article>`, {runScripts:'outside-only'});
 const {window} = dom;
 window.requestAnimationFrame = callback => callback();
 const bodies = [...window.document.querySelectorAll('[data-hadith-sharh-collapsible]')];
 bodies.forEach(body => {
  Object.defineProperty(body, 'scrollHeight', {value:300});
  Object.defineProperty(body, 'clientHeight', {value:100,configurable:true});
 });
 window.eval(init);
 window.initHadithSharhDisclosures(window.document);
 window.initHadithSharhDisclosures(window.document);
 const controls = bodies.map(body => body.nextElementSibling);
 controls[lang === 'en' ? 0 : 1].click();
 expect(bodies.map(body => body.classList.contains('is-expanded'))).toEqual([true,true,false]);
 expect(controls.map(button => button.getAttribute('aria-expanded'))).toEqual(['true','true','false']);
 expect(controls.slice(0,2).map(button => button.textContent)).toEqual(['Less...','أقل...']);
 expect(controls[0].getAttribute('aria-controls')).toBe('en ar');
 // Collapse from the opposite language; short translations regain their hidden control.
 Object.defineProperty(bodies[0], 'clientHeight', {value:300});
 controls[lang === 'en' ? 1 : 0].click();
 expect(bodies.map(body => body.classList.contains('is-expanded'))).toEqual([false,false,false]);
 expect(controls.slice(0,2).map(button => button.textContent)).toEqual(['More...','مزيد...']);
 expect(controls[0].hidden).toBe(true);
 expect(controls[1].hidden).toBe(false);
 dom.window.close();
});
