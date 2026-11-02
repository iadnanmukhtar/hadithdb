'use strict';
const fs=require('fs'),path=require('path'),ejs=require('ejs'),{chromium}=require('playwright');
const Notebook=require('../lib/UserNotebook');
let browser,page;
beforeAll(async()=>{browser=await chromium.launch({channel:'chrome',headless:true});});
afterAll(async()=>browser?.close());
afterEach(async()=>page?.close());
async function setup(kind,markdown,width=900){
 page=await browser.newPage({viewport:{width,height:850}});
 await page.route('http://editor.test/**',route=>{
  const url=new URL(route.request().url());
  if(url.pathname.startsWith('/static/fonts/'))return route.fulfill({body:fs.readFileSync(path.join(__dirname,'../public',url.pathname)),contentType:'font/woff2'});
  return route.fulfill({body:'<!doctype html>',contentType:'text/html'});
 });
 await page.goto('http://editor.test/');
 const controls=await ejs.renderFile('views/sub-views/content_format_controls.ejs',{styleId:'community-format-style'});
 const markup=kind==='note'?await ejs.renderFile('views/sub-views/notebook_modal.ejs',{utils:{scriptAssetVersion:()=>''}}):
  `<section class="${kind==='article'?'community-editor':'community-quick-dialog'}"><form>${kind==='article'?'<div id="community-format-toolbar" class="community-format-toolbar">'+controls+'</div>':''}<textarea id="${kind==='article'?'community-markdown':'community-quick-text'}" data-short-editor ${kind==='article'?'data-article-editor':''}></textarea></form></section>`;
 await page.setContent('<style>html{font-size:18px} [hidden]{display:none!important}</style>'+markup.replace(/<script[^]*?<\/script>/g,''));
 await page.addStyleTag({path:'public/static/css/community.css'});
 await page.addStyleTag({path:'public/static/css/markdown-content.css'});
 if(kind==='note')await page.locator('#notebook-modal').evaluate(el=>el.setAttribute('aria-hidden','false'));
 await page.addScriptTag({path:'node_modules/marked/lib/marked.umd.js'});
 for(const file of ['notebook-shortcuts','notebook-wiki','community-parallel-text','community-short-editor','community-formatting'])await page.addScriptTag({path:'public/static/js/'+file+'.js'});
 if(kind==='note')await page.addScriptTag({path:'public/static/js/notebook-rich-editor.js'});
 await page.exposeFunction('renderPreview',text=>Notebook.render(text));
 await page.evaluate(({kind,markdown})=>{
  window.source=document.querySelector('textarea[data-short-editor]');
  CommunityShortEditor.setPreviewRenderer(source,renderPreview);
  source.value=markdown;
  if(kind==='note'){document.querySelector('#notebook-preview').hidden=true;NotebookRichEditor.setEditing(true);}
  window.surface=CommunityShortEditor.get(source);window.rich=surface.rich;
  window.selectBlock=(selector='p',end=true)=>{rich.focus();const range=document.createRange();range.selectNodeContents(rich.querySelector(selector));range.collapse(!end);getSelection().removeAllRanges();getSelection().addRange(range);surface.selection();};
  selectBlock();
 },{kind,markdown});
}
for(const kind of ['post','article','note'])describe(kind,()=>{
 test.each(['English paragraph','العربية كلمات هنا'])('Enter, quote exit, and native undo remain editable: %s',async text=>{
  await setup(kind,'> '+text);
  await page.keyboard.press('Enter');await page.keyboard.type('Translation');
  expect(await page.evaluate(()=>source.value)).toBe('> '+text+'\n> Translation');
  await page.keyboard.press('Enter');await page.keyboard.press('Enter');
  await page.keyboard.press('Meta+z');await page.keyboard.press('Meta+Shift+z');await page.keyboard.type('Outside');
  expect(await page.evaluate(()=>source.value)).toBe('> '+text+'\n> Translation\n\nOutside');
 });
 test('Arabic insertion, soft break, deletion, paste, undo and redo share the same behavior',async()=>{
  await setup(kind,'Before');
  await page.keyboard.insertText(' العربية');await page.keyboard.press('Meta+z');
  expect(await page.evaluate(()=>source.value)).toBe('Before');
  await page.keyboard.press('Meta+Shift+z');await page.keyboard.press('Shift+Enter');await page.keyboard.type('Next');
  expect(await page.evaluate(()=>source.value)).toContain('Before العربية\nNext');
  await page.keyboard.press('Backspace');await page.keyboard.type('t');
  await page.evaluate(()=>{const data=new DataTransfer();data.setData('text/plain',' pasted');rich.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));});
  expect(await page.evaluate(()=>source.value)).toContain('Next pasted');
 });
 test('soft breaks inside a bilingual quote switch border sides while typing',async()=>{
  await setup(kind,'> العربية');
  await page.keyboard.press('Shift+Enter');await page.keyboard.type('English');
  expect(await page.evaluate(()=>source.value)).toBe('> العربية\n> English');
  expect(await page.locator('.notebook-quote-section').evaluateAll(els=>els.map(el=>getComputedStyle(el).direction))).toEqual(['rtl','ltr']);
 });
 test('Markdown caret direction follows the active language',async()=>{
  await setup(kind,'العربية هنا\nEnglish words');
  await page.evaluate(()=>{surface.toSource();source.focus();source.setSelectionRange(source.value.indexOf('words')+2,source.value.indexOf('words')+2);source.dir='rtl';});
  expect(await page.evaluate(()=>getComputedStyle(source).fontFamily)).toContain('NotebookEditableArabic');
  await page.keyboard.press('ArrowLeft');
  expect(await page.evaluate(()=>({direction:source.dir,position:source.selectionStart}))).toEqual({direction:'ltr',position:'العربية هنا\nEnglish words'.indexOf('words')+1});
 });
 test('formatted/Markdown round trip restores backward selection among repeated paragraphs',async()=>{
  await setup(kind,'Repeated العربية\n\nRepeated العربية\n\nLast');
  await page.evaluate(()=>{surface.toSource();source.focus();const start=source.value.indexOf('العربية',18);source.setSelectionRange(start,start+7,'backward');});
  await page.getByRole('button',{name:'Switch to formatted editing',exact:true}).click();
  expect(await page.evaluate(()=>({text:getSelection().toString(),paragraph:[...rich.querySelectorAll('p')].indexOf(getSelection().anchorNode.parentElement.closest('p')),backward:getSelection().focusNode===getSelection().getRangeAt(0).startContainer && getSelection().focusOffset===getSelection().getRangeAt(0).startOffset}))).toEqual({text:'العربية',paragraph:1,backward:true});
  await page.keyboard.type('replacement');
  expect(await page.evaluate(()=>source.value)).toBe('Repeated العربية\n\nRepeated replacement\n\nLast');
 });
 test('advanced blocks render through the shared renderer and survive surrounding edits',async()=>{
  const raw='```js\nconst value = 1;\n```';
  await setup(kind,'Before\n\n'+raw+'\n\nAfter');
  await page.waitForFunction(()=>rich.querySelector('[data-notebook-raw] code')?.textContent.includes('const value'));
  await page.keyboard.type(' changed');
  expect(await page.evaluate(()=>source.value)).toBe('Before changed\n\n'+raw+'\n\nAfter');
  expect(await page.evaluate(()=>source.hidden)).toBe(true);
  await page.evaluate(()=>{surface.selection();surface.toSource();});
  expect(await page.evaluate(()=>source.selectionStart)).toBe('Before changed'.length);
 });
 test('lists continue, exit, and preserve their content',async()=>{
  await setup(kind,'Paragraph\n\n- First العربية');
  await page.evaluate(()=>selectBlock('li'));
  await page.keyboard.press('Enter');await page.keyboard.type('Second');
  expect(await page.evaluate(()=>source.value)).toContain('- First العربية\n- Second');
  await page.keyboard.press('Enter');await page.keyboard.press('Enter');await page.keyboard.type('Outside');
  expect(await page.evaluate(()=>source.value)).toContain('\n\nOutside');
 });
 test('composition and unchanged save refresh preserve live text and caret',async()=>{
  await setup(kind,'Before');
  await page.evaluate(()=>rich.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true})));
  await page.keyboard.insertText(' العربية');
  await page.evaluate(()=>rich.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:' العربية'})));
  const same=await page.evaluate(()=>{const node=getSelection().anchorNode,offset=getSelection().anchorOffset;source.value=source.value;return getSelection().anchorNode===node && getSelection().anchorOffset===offset;});
  expect(same).toBe(true);
  await page.keyboard.type(' after');
  expect(await page.evaluate(()=>source.value)).toBe('Before العربية after');
 });
 test('keyboard selection, formatting and replacement preserve surrounding paragraphs',async()=>{
  await setup(kind,'Before\n\nMiddle words\n\nAfter');
  await page.evaluate(()=>selectBlock('p:nth-child(2)'));
  for(let i=0;i<5;i++)await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.press('Meta+b');await page.keyboard.type('replacement');
  expect(await page.evaluate(()=>source.value)).toBe('Before\n\nMiddle **replacement**\n\nAfter');
 });
 test('advanced syntax is preserved exactly through mode switching',async()=>{
  const markdown='Paragraph\n\n| Term | Meaning |\n| --- | --- |\n| العربية | Arabic |\n\n- [x] Done';
  await setup(kind,markdown);
  await page.waitForFunction(()=>rich.querySelector('table'));
  await page.getByRole('button',{name:'Switch to Markdown editing',exact:true}).click();
  expect(await page.evaluate(()=>source.value)).toBe(markdown);
  await page.getByRole('button',{name:'Switch to formatted editing',exact:true}).click();
  expect(await page.evaluate(()=>source.value)).toBe(markdown);
 });
 test('only the toolbar presentation differs',async()=>{
  await setup(kind,'Selected words');
  await page.evaluate(()=>{const r=document.createRange();r.selectNodeContents(rich.querySelector('p'));getSelection().removeAllRanges();getSelection().addRange(r);surface.selection();});
  expect(await page.locator('.community-selection-tools').isVisible()).toBe(kind==='post');
  if(kind!=='post')expect(await page.locator('.community-format-toolbar').isVisible()).toBe(true);
  const button=kind==='post'?page.locator('.community-selection-tools button[title="Bold"]'):page.locator('.community-format-toolbar [data-format="bold"]');
  await button.click();
  expect(await page.evaluate(()=>source.value)).toBe('**Selected words**');
 });
 test('underline uses the same Markdown selection and clear-formatting stays in formatted mode',async()=>{
  await setup(kind,'Selected words');
  await page.evaluate(()=>{const r=document.createRange();r.selectNodeContents(rich.querySelector('p'));getSelection().removeAllRanges();getSelection().addRange(r);surface.selection();});
  const underline=kind==='post'?page.locator('.community-selection-tools button[title="Underline"]'):page.locator('.community-format-toolbar [data-format="underline"]');
  if(kind==='post')await page.getByRole('button',{name:'More formatting',exact:true}).click();
  await underline.click();
  expect(await page.evaluate(()=>({text:source.value,selected:source.value.slice(source.selectionStart,source.selectionEnd)}))).toEqual({text:'__Selected words__',selected:'Selected words'});
  await page.evaluate(()=>{source.value='**Selected words**';surface.toFormatted();const r=document.createRange();r.selectNodeContents(rich.querySelector('strong'));rich.focus();getSelection().removeAllRanges();getSelection().addRange(r);surface.selection();});
  const clear=kind==='post'?page.locator('.community-selection-tools button[title="Clear formatting"]'):page.locator('.community-format-toolbar [data-format="clear"]');
  await clear.click();
  expect(await page.evaluate(()=>({text:source.value,formatted:source.hidden}))).toEqual({text:'Selected words',formatted:true});
 });
 test('highlight and heading changes preserve native undo and the insertion point',async()=>{
  await setup(kind,'Selected words');
  await page.evaluate(()=>{const r=document.createRange();r.selectNodeContents(rich.querySelector('p'));getSelection().removeAllRanges();getSelection().addRange(r);surface.selection();});
  const highlight=kind==='post'?page.locator('.community-selection-tools button[title="Highlight"]'):page.locator('.community-format-toolbar [data-format="highlight"]');
  await highlight.click();
  expect(await page.evaluate(()=>source.value)).toBe('==Selected words==');
  await page.keyboard.press('Meta+z');
  expect(await page.evaluate(()=>source.value)).toBe('Selected words');
  await page.evaluate(()=>{selectBlock();surface.format('style','2');});
  await page.keyboard.type(' appended');
  expect(await page.evaluate(()=>source.value)).toBe('## Selected words appended');
 });
 test.each([390,900])('bilingual typography and borders at %s px',async width=>{
  await setup(kind,'Paragraph\n\n> العربية هنا\n> English translation',width);
  await page.evaluate(()=>document.fonts.ready);
  const metrics=await page.locator('.community-rich-input').evaluate(el=>{
   const arabic=getComputedStyle(el.querySelector('.notebook-arabic'));
   const sections=[...el.querySelectorAll('.notebook-quote-section')].map(el=>{const s=getComputedStyle(el);return [s.direction,s.textAlign,s.borderInlineStartWidth,s.borderInlineStartColor];});
   return {arabic:[arabic.fontFamily,arabic.fontSize,arabic.lineHeight],sections};
  });
  expect(metrics).toEqual({arabic:['Hafs, serif','21.6px','32.4px'],sections:[['rtl','right','3px','rgb(44, 155, 229)'],['ltr','left','3px','rgb(44, 155, 229)']]});
  await page.screenshot({path:`/tmp/shared-editor-${kind}-${width}.png`});
 });
});

test.each([['Underline','__'],['Strikethrough','~~'],['Subscript','~'],['Superscript','^']])('post secondary menu applies %s to the retained selection',async(label,marker)=>{
 await setup('post','Selected');
 await page.evaluate(()=>{const range=document.createRange();range.selectNodeContents(rich.querySelector('p'));getSelection().removeAllRanges();getSelection().addRange(range);surface.selection();});
 const extra=page.getByRole('group',{name:'Additional formatting',exact:true});
 expect(await extra.isVisible()).toBe(false);
 expect(await page.locator('.community-selection-tools > button').allTextContents()).not.toContain(label);
 await page.getByRole('button',{name:'More formatting',exact:true}).click();
 expect(await extra.isVisible()).toBe(true);
 expect(await page.evaluate(()=>getSelection().toString())).toBe('Selected');
 await extra.getByRole('button',{name:label,exact:true}).click();
 expect(await page.evaluate(()=>source.value)).toBe(marker+'Selected'+marker);
 expect(await extra.isVisible()).toBe(false);
});
test.each([390,900])('post secondary formatting menu stays inside the viewport and dismisses at %s px',async width=>{
 await setup('post','Selected',width);
 await page.evaluate(()=>{const range=document.createRange();range.selectNodeContents(rich.querySelector('p'));getSelection().removeAllRanges();getSelection().addRange(range);surface.selection();});
 const more=page.getByRole('button',{name:'More formatting',exact:true});
 await more.click();
 const menu=page.getByRole('group',{name:'Additional formatting',exact:true});
 const box=await menu.boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width);
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 expect(await menu.isVisible()).toBe(true);
 await page.screenshot({path:'/tmp/post-secondary-formatting-'+width+'.png'});
 await more.press('Escape');expect(await menu.isVisible()).toBe(false);
 expect(await more.getAttribute('aria-expanded')).toBe('false');
 await more.press('Enter');expect(await menu.isVisible()).toBe(true);
 await page.locator('.community-rich-input').click({position:{x:8,y:8}});expect(await menu.isVisible()).toBe(false);
});

for(const kind of ['post','article','note'])describe(kind+' footnote audit',()=>{
 const original='Main text[^source] and again[^source].\n\n[^source]: English **bold** العربية\n\n    Second paragraph.';
 test('unrelated edits preserve the exact footnote definition',async()=>{
  await setup(kind,original);await page.keyboard.type(' More');
  expect(await page.evaluate(()=>source.value)).toBe(original.replace('again[^source].','again[^source]. More'));
 });
 test('footnote caret maps to source and back without losing its definition',async()=>{
  await setup(kind,original);
  await page.evaluate(()=>{selectBlock('.community-footnote-body p:last-child');surface.toSource();});
  expect(await page.evaluate(()=>source.selectionStart)).toBe(original.length);
  await page.getByRole('button',{name:'Switch to formatted editing',exact:true}).click();
  await page.keyboard.type(' Appended');
  expect(await page.evaluate(()=>source.value)).toContain('Second paragraph. Appended');
  expect(await page.locator('.community-footnote-body').innerText()).toContain('Appended');
 });
 test('Enter, formatting, undo and mode switching retain multiline footnotes',async()=>{
  await setup(kind,original);
  await page.evaluate(()=>selectBlock('.community-footnote-body p:last-child'));
  await page.keyboard.press('Enter');await page.keyboard.type('New paragraph');
  expect(await page.locator('.community-footnote-body').innerText()).toContain('New paragraph');
  for(let i=0;i<9;i++)await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.press('Meta+b');
  expect(await page.evaluate(()=>source.value)).toContain('    New **paragraph**');
  await page.keyboard.press('Meta+z');
  expect(await page.evaluate(()=>source.value)).not.toContain('**paragraph**');
  await page.getByRole('button',{name:'Switch to Markdown editing',exact:true}).click();
  const before=await page.evaluate(()=>source.value);
  await page.getByRole('button',{name:'Switch to formatted editing',exact:true}).click();
  expect(await page.evaluate(()=>source.value)).toBe(before);
 });
 test('subtext and center formatting remain inside the footnote definition',async()=>{
  await setup(kind,original);
  await page.evaluate(()=>{selectBlock('.community-footnote-body p:last-child');surface.format('style','subtext');});
  expect(await page.evaluate(()=>source.value)).toContain('    -# Second paragraph.');
  expect(await page.locator('.community-footnote-body .notebook-subtext').count()).toBe(1);
  await page.evaluate(()=>{selectBlock('.community-footnote-body p:first-child');surface.format('center');});
  const md=await page.evaluate(()=>source.value);
  expect(md).toContain('[^source]: <center>');expect(md).toContain('    </center>');
  expect(Notebook.render(md)).toContain('<center>');
 });
 test('footnotes use smaller text while keeping Arabic, bold, quote and heading formatting',async()=>{
  await setup(kind,'Main[^1]\n\n[^1]: **Bold** العربية\n\n    > العربية\n    > English\n\n    ## Heading');
  const metrics=await page.evaluate(()=>{const body=rich.querySelector('.community-footnote-body'),style=getComputedStyle(body);return {main:parseFloat(getComputedStyle(rich).fontSize),note:parseFloat(style.fontSize),arabic:parseFloat(getComputedStyle(body.querySelector('.notebook-arabic')).fontSize),bold:getComputedStyle(body.querySelector('strong')).fontWeight,heading:parseFloat(getComputedStyle(body.querySelector('h2')).fontSize),directions:[...body.querySelectorAll('.notebook-quote-section')].map(el=>el.dir)};});
  expect(metrics.note).toBeCloseTo(metrics.main*.85);expect(metrics.arabic).toBeCloseTo(metrics.note*1.2);expect(metrics.bold).toBe('700');expect(metrics.heading).toBeGreaterThan(metrics.note);expect(metrics.directions).toEqual(['rtl','ltr']);
  await page.screenshot({path:'/tmp/footnote-editor-'+kind+'.png'});
 });
});
