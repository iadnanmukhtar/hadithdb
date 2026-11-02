'use strict';
const {load}=require('cheerio');
const Notebook=require('../lib/UserNotebook');
const normalize=require('../lib/NotebookDirection');
test.each(['> العربية\n> English translation','> العربية\n>\n> English translation','<blockquote><p>العربية<br>English translation</p></blockquote>','<blockquote>العربية<br>English translation</blockquote>'])('mixed quote sections switch direction without changing text: %s',source=>{
 const $=load(Notebook.render(source));
 expect($('blockquote').map((_,el)=>$(el).attr('dir')).get()).toEqual(['rtl','ltr']);
 expect($('blockquote p').map((_,el)=>$(el).attr('dir')).get()).toEqual(['rtl','ltr']);
 expect($('blockquote').map((_,el)=>$(el).text().trim()).get()).toEqual(['العربية','English translation']);
});
test('formatting and links spanning a language break survive in both sections',()=>{
 const html=Notebook.render('> **العربية\n> English** [source](/bukhari:1)\n> العربية');const $=load(html);
 expect($('blockquote').map((_,el)=>$(el).attr('dir')).get()).toEqual(['rtl','ltr','rtl']);
 expect($('blockquote strong')).toHaveLength(2);
 expect($('a').first().attr('href')).toBe('/bukhari:1');
 expect(normalize(html)).toBe(html);
});
test('ordinary paragraphs independently align each language line without splitting inline phrases',()=>{
 const $=load(Notebook.render('English with العربية inline\nالعربية\nEnglish again'));
 expect($('.notebook-text-line').map((_,el)=>$(el).attr('dir')).get()).toEqual(['ltr','rtl','ltr']);
 expect($('.notebook-text-line').first().text()).toBe('English with العربية inline');
});
test('loose bilingual list items place markers according to their own text',()=>{
 const source='- ﴿التَّائِبُونَ الْعَابِدُونَ﴾ [سُورَةُ التَّوْبَةِ ٩:١١٢](/quran/9:112)\n\n  > English translation\n\n- English item\n\n  - العربية';
 const $=load(Notebook.render(source),null,false);
 expect($('li').map((_,el)=>$(el).attr('dir')).get()).toEqual(['rtl','ltr','rtl']);
 expect($('li p').first().attr('dir')).toBe('rtl');
 expect(normalize($.root().html())).toBe($.root().html());
});
