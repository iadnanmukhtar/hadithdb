'use strict';
const ejs = require('ejs');
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const template = fs.readFileSync(path.join(__dirname, '../views/sub-views/sirah_item.ejs'), 'utf8');
function render(overrides = {}, title = true, editMode = false) {
 return cheerio.load(ejs.render(template, {
  i: { id: 1, num: '813787', ref: 'ibnhisham:813787', book_shortName_en: 'Sirat Ibn Hisham', book_shortName: 'سيرة ابن هشام', body: 'النص العربي', title: 'العنوان', ...overrides },
  site: {editMode}, utils: require('../lib/Utils'), arabic: require('../lib/Arabic'), title
 }, { filename: path.join(__dirname, '../views/sub-views/sirah_item.ejs') }));
}
test.each(['history', 'ibnhisham'])('%s shows passage titles and individual links in scrolling and detail views', alias => {
 for (const title of [false, true]) {
  const $ = render({ book_alias: alias, num: '12', ref: `${alias}:12`, title_en: 'English title', body_en: 'English text' }, title);
  expect($('h1[lang=en].fs-5').text()).toBe('English title');
  expect($('h1[lang=ar].fs-5').text()).toBe('العنوان');
  expect($('article > header.col-12 > h1.fs-5')).toHaveLength(2);
  expect($('article > section h1')).toHaveLength(0);
  expect($('article > header').last().next().is('section')).toBe(true);
  expect($(`b a[href="/${alias}:12"]`)).toHaveLength(2);
 }
});
test('untitled passages omit empty title headings', () => {
 const $ = render({ title: '', title_en: '' }, false);
 expect($('h1')).toHaveLength(0);
});
test('untranslated Sirah occupies the full reader width without an empty English column', () => {
 const $ = render({ title_en: 'Translated heading only', text_en: 'النص العربي الاحتياطي' });
 expect($('section[data-reader-language-column=english]')).toHaveLength(0);
 expect($('section[data-reader-language-column=arabic]').hasClass('col-12')).toBe(true);
 expect($('header[lang=en]').text()).toContain('Translated heading only');
 expect($('#813787')).toHaveLength(1);
});
test('translated Sirah uses two language columns with its English text and notes', () => {
 const $ = render({ body_en: 'English text', footnote_en: 'English note' });
 expect($('section[data-reader-language-column]')).toHaveLength(2);
 expect($('section[data-reader-language-column=arabic]').hasClass('col-md-6')).toBe(true);
 expect($('[data-reader-language-column=english]').text()).toContain('English text');
 expect($('[data-reader-language-column=english] .footnote').text()).toContain('English note');
});
test('Sirah passages expose bookmark, note source, like, reflection, and non-image sharing actions', () => {
 const $ = render();
 expect($('.sirah-item-actions .hadith-bookmark-btn')).toHaveLength(1);
 expect($('.sirah-item-actions .hadith-like-btn')).toHaveLength(1);
 expect($('.sirah-item-actions .hadith-comment-count')).toHaveLength(1);
 expect($('.sirah-item-actions [data-content-share-trigger]')).toHaveLength(1);
 expect($('.sirah-item-actions .hadith-share-action-link').text()).toContain('Share');
 expect($('.sirah-item-actions').text()).not.toMatch(/Sharh|Sound/i);
 expect($('.sirah-item-actions').closest('.h')).toHaveLength(1);
 expect($('.sirah-item-actions .reflection-count-link').attr('data-reflection-disclosure-trigger')).toBe('sirah-comments-1-disclosure');
 expect($('#sirah-comments-1-disclosure')).toHaveLength(1);
 expect($('#sirah-comments-1').attr('data-target-type')).toBe('hadith');
});
test('Sirah passage detail stays on one item while search pagination remains available', () => {
 const search = fs.readFileSync(path.join(__dirname, '../views/search.ejs'), 'utf8');
 expect(search).not.toContain('data-reader-infinite="hadith-sirah"');
 expect(search).toContain('data-search-next-url="<%= page.next %>"');
 expect(search).toContain("item.single && (['sirah', 'history'].includes(item.doctype) || ['sirah', 'history'].includes(item.book_type))");
});

test('Sirah chapters and sections share one infinite reader mode across chapter boundaries', () => {
 for (const name of ['section', 'chapter']) {
  const source = fs.readFileSync(path.join(__dirname, `../views/${name}.ejs`), 'utf8');
  expect(source).toContain("book.type === 'sirah' ? 'hadith-sirah-reader'");
 }
});

test('Sirah navigation includes chapters without sections in both directions', () => {
 const { adjacentHeadings } = require('../lib/SirahReader');
 const rows = [{level:1,h1:1},{level:2,h1:1,h2:1},{level:1,h1:2},{level:1,h1:3},{level:2,h1:3,h2:1}];
 const book = {alias:'ibnhisham'};
 expect(adjacentHeadings(rows,{h1:1,h2:1},book).next.path).toBe('ibnhisham/2');
 const middle = adjacentHeadings(rows,{h1:2},book);
 expect(middle.prev.path).toBe('ibnhisham/1/1');
 expect(middle.next.path).toBe('ibnhisham/3/1');
 expect(adjacentHeadings(rows,{h1:3,h2:1},book).next).toBeNull();
});

test('chapter opening passages precede their first section without repeating section content', () => {
 const { adjacentHeadings } = require('../lib/SirahReader');
 const rows = [{level:1,h1:10,direct_count:1},{level:2,h1:10,h2:1},{level:1,h1:11,direct_count:2}];
 const book = {alias:'ibnhisham'};
 expect(adjacentHeadings(rows,{h1:10},book).next.path).toBe('ibnhisham/10/1');
 expect(adjacentHeadings(rows,{h1:10,h2:1},book).prev.path).toBe('ibnhisham/10');
 expect(adjacentHeadings(rows,{h1:10,h2:1},book).next.path).toBe('ibnhisham/11');
});
test.each(['history', 'ibnhisham'])('%s uses the shared hadith typography for both languages and footers', alias => {
 const $=render({book_alias:alias,body_en:'English text',footnote:'حاشية عربية',footnote_en:'English footer'});
 for(const lang of ['ar','en']) {
  expect($(`.h[lang=${lang}] .hadith-body-content.content-markdown p`)).toHaveLength(1);
  expect($(`.h[lang=${lang}] footer.footnote.content-markdown p`)).toHaveLength(1);
 }
});

test('English-only Sirah uses full width and resolves separately stored footnotes with passage-specific IDs', () => {
 const $ = render({ id: 22, book_alias: 'yqsirah', body: '', text: 'A note[^p44n1].', title: '', body_en: 'A note[^p44n1].', footnote_en: '[^p44n1]: Source explanation.' });
 expect($('section[data-reader-language-column=arabic]')).toHaveLength(0);
 expect($('section[data-reader-language-column=english]').hasClass('col-12')).toBe(true);
 const target=$('.footnote-ref a').attr('href');
 expect(target).toContain('sirah-22-en');
 expect($(target).text()).toContain('Source explanation.');
 expect($('.footnote-backref').attr('href')).toContain('sirah-22-en');
 expect($('.hadith-body-content').text()).not.toContain('[^p44n1]');
 const other=render({id:23,body:'',body_en:'Another note[^p44n1].',footnote_en:'[^p44n1]: Another explanation.'});
 expect(other('.footnote-ref a').attr('href')).not.toBe(target);
});

test('English footnotes beginning with an Arabic honorific keep English reading direction', () => {
 const $=render({body:'',body_en:'Note[^n].',footnote_en:'[^n]: ﷺ (Salla-llahu alayhi wa sallam) - peace be upon him.'});
 expect($('.footnote-item').attr('dir')).toBe('ltr');
 expect($('.footnote-item p').attr('dir')).toBe('ltr');
 expect($('.footnote-item').text()).toContain('ﷺ');
});

 test.each(['yqsirah', 'ibnhisham', 'history'])('%s has separate inline Markdown body and footnote editors in admin mode', alias => {
 const $=render({book_alias:alias,body:'نص عربي',body_en:'Text[^n1].',footnote_en:'[^n1]: A note.'},true,true);
 expect($('[data-prop="hadith.body_en"]').attr('data-markdown-source')).toBe('Text[^n1].');
 expect($('[data-prop="hadith.footnote_en"]').attr('data-markdown-source')).toBe('[^n1]: A note.');
 expect($('[data-prop="hadith.body_en"] .footnotes')).toHaveLength(0);
 expect($('[data-prop="hadith.footnote_en"] .footnote-item')).toHaveLength(1);
 const target=$('.footnote-ref a').first().attr('href');
 expect($(target)).toHaveLength(1);
 expect($('[data-prop="hadith.title_en"]')).toHaveLength(1);
 expect($('[data-prop="hadith.body"]')).toHaveLength(1);
 });
 test('public sirah reader has no edit controls',()=>{const $=render({body_en:'Text',footnote_en:'Note'});expect($('._e, [data-sirah-editor]')).toHaveLength(0);});

test.each([['yqsirah','sirah'],['ibnhisham','sirah'],['history','sirah'],['history','history']])('%s (%s) H3 keeps the passage headline without a duplicate separator', (alias, bookType) => {
 const headingTemplate = fs.readFileSync(path.join(__dirname, '../views/sub-views/heading.ejs'), 'utf8');
 const renderHeading = (type, level, passageHasHeadline = true) => ejs.render(headingTemplate, {
  site: {editMode:false}, page: {context:{book:{alias,type},chapter:{h1:3}},menu:'Section'},
  heading:{id:19,level,h1:3,h2:3,h3:level===3?1:null,title_en:'Pre-Islamic Arabia: Various Paganistic Practices',path:`${alias}/3/3/1`},
  passageHasHeadline, headingEnglishOnly:true, contextOnly:true, req:{},
  utils:require('../lib/Utils'), arabic:require('../lib/Arabic')
 });
 const heading = renderHeading(bookType,3);
 const passage = render({book_alias:alias,num:'19',ref:`${alias}:19`,title:'',body:'',title_en:'Pre-Islamic Arabia: Various Paganistic Practices',body_en:'Passage text'});
 const $ = cheerio.load(heading + passage.html());
 expect($('heading.heading')).toHaveLength(0);
 expect($('h1[lang=en]').text()).toBe('Pre-Islamic Arabia: Various Paganistic Practices');
 expect($(`[data-hadith-heading-key="${alias}:3.3.1"]`)).toHaveLength(1);
 expect($('#S3-1')).toHaveLength(1);
 expect($('.heading-bookmark-btn')).toHaveLength(0);
 expect($('.hadith-bookmark-btn')).toHaveLength(1);
 expect($('[data-hadith-heading-key]').hasClass('mt-4')).toBe(false);
 for(const [type,level,hasTitle] of [['sirah',2,true],['hadith',3,true]])
  expect(cheerio.load(renderHeading(type,level,hasTitle))('heading.heading')).toHaveLength(1);
 const untitledPassage = cheerio.load(renderHeading('sirah',3,false));
 expect(untitledPassage('heading.heading')).toHaveLength(0);
 expect(untitledPassage('.sirah-subsection-heading')).toHaveLength(1);
});

 test.each(['sirah','history'])('%s routes through the shared passage renderer', type => {
  const include = jest.fn(() => '<article>Shared Sirah/History reader</article>');
  const source = fs.readFileSync(path.join(__dirname, '../views/sub-views/hadith.ejs'), 'utf8');
  ejs.render(source, {i:{book_type:type},title:false,searchResult:false,include});
  expect(include).toHaveBeenCalledWith('sirah_item.ejs', expect.objectContaining({title:false}));
 });

test.each(['yqsirah', 'ibnhisham', 'history'])('%s footnotes retain independent Arabic and English block directions', alias => {
 const notes='[^n]: Al-ayn (العين) — the evil eye.\n\n    > ﴿وَإِنَّهُ لَكِتَابٌ عَزِيزٌ﴾\n    >\n    > [فصلت ٤١](https://example.com/41)\n\n    <!-- -->\n\n    > It is indeed a mighty Book. ([Fussilat 41:41](https://example.com/41))\n\n[^ar]: حاشية عربية كاملة.';
 for(const editMode of [false,true]) {
  const $=render({book_alias:alias,body:'',body_en:'Notes[^n][^ar].',footnote_en:notes},true,editMode);
  const footnotes=$('.footnotes');
  expect(footnotes.find('blockquote').map((_,el)=>$(el).attr('dir')).get()).toEqual(['rtl','ltr']);
  expect(footnotes.find('blockquote').first().find('p').map((_,el)=>$(el).attr('dir')).get()).toEqual(['rtl','rtl']);
  expect(footnotes.find('.footnote-item').map((_,el)=>$(el).attr('dir')).get()).toEqual(['ltr','rtl']);
  $('.footnote-ref a').each((_,el)=>expect($($(el).attr('href')).length).toBe(1));
  expect(footnotes.find('.footnote-backref')).toHaveLength(2);
 }
});

test('Sirah passage video previews follow the body and preserve the editable source', () => {
 const body = 'Introduction [Watch lecture](https://youtu.be/dQw4w9WgXcQ?t=60).\n\nFinal paragraph.';
 for (const editMode of [false, true]) {
  const $ = render({ book_alias: 'yqsirah', num: '1', ref: 'yqsirah:1', body: '', body_en: body }, true, editMode);
  const content = $('.hadith-body-content');
  expect(content.children().last().hasClass('markdown-video-previews')).toBe(true);
  expect(content.find('.markdown-video-preview')).toHaveLength(1);
  if (editMode) expect(content.attr('data-markdown-source')).toBe(body);
 }
});
