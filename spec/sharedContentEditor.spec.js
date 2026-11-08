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
for(const kind of ['post','article','note'])test.each(['English line','العربية هنا'])('Delete at the start unwraps only the current quote line in '+kind+': %s',async text=>{
 const markdown='Before\n\n> First line\n> **'+text+'**\n> Last line\n\nAfter';
 await setup(kind,markdown);
 await page.evaluate(()=>{const line=rich.querySelectorAll('.notebook-rich-line')[1],walk=document.createTreeWalker(line,NodeFilter.SHOW_TEXT),text=walk.nextNode();rich.focus();getSelection().setBaseAndExtent(text,0,text,0);surface.selection();});
 await page.keyboard.press('Delete');
 expect(await page.evaluate(()=>source.value)).toBe('Before\n\n> First line\n\n**'+text+'**\n\n> Last line\n\nAfter');
 await page.keyboard.type('Inserted ');
 expect(await page.evaluate(()=>source.value)).toContain('Inserted ');
});
test('quote-line removal supports Undo and does not intercept Delete inside text',async()=>{
 await setup('article','Before\n\n> First\n> Second\n\nAfter');
 await page.evaluate(()=>{const line=rich.querySelectorAll('.notebook-rich-line')[1];rich.focus();getSelection().setBaseAndExtent(line.firstChild,0,line.firstChild,0);});
 await page.keyboard.press('Delete');
 expect(await page.evaluate(()=>source.value)).toContain('\n\nSecond\n\nAfter');
 await page.keyboard.press('Meta+z');
 expect(await page.evaluate(()=>source.value)).toBe('Before\n\n> First\n> Second\n\nAfter');
 await page.evaluate(()=>{const line=rich.querySelectorAll('.notebook-rich-line')[1];getSelection().setBaseAndExtent(line.firstChild,1,line.firstChild,1);});
 await page.keyboard.press('Delete');
 expect(await page.evaluate(()=>source.value)).toContain('> Scond');
});
test('advanced blocks expose code editing without changing their contents',async()=>{
 const original='Before\n\n```js\nconst value = 1;\n```\n\nAfter';
 await setup('article',original);
 await page.getByRole('button',{name:'Edit block Markdown',exact:true}).click();
 expect(await page.evaluate(()=>source.hidden)).toBe(false);
 expect(await page.evaluate(()=>source.value)).toBe(original);
 expect(await page.evaluate(()=>source.value.slice(source.selectionStart,source.selectionEnd))).toBe('```js\nconst value = 1;\n```');
 await page.getByRole('button',{name:'Switch to formatted editing',exact:true}).click();
 expect(await page.getByRole('button',{name:'Edit block Markdown',exact:true}).isVisible()).toBe(true);
});
test('Delete unwraps a nested quote line inside a list without changing neighboring text',async()=>{
 await setup('article','Before\n\n- Item\n\n  > > First\n  > > Second\n\nAfter');
 await page.evaluate(()=>{const line=rich.querySelectorAll('.notebook-rich-line')[0];rich.focus();getSelection().setBaseAndExtent(line.firstChild,0,line.firstChild,0);});
 await page.keyboard.press('Delete');
 expect(await page.locator('li').innerText()).toContain('First');
 expect(await page.locator('blockquote blockquote').innerText()).toBe('Second');
 expect(await page.evaluate(()=>source.value)).toContain('After');
});
for(const kind of ['post','article','note'])test.each([
 ['heading','## **Target**','h2','**Target**'],
 ['subtext','-# **Target**','.notebook-subtext','**Target**'],
 ['center','<center>\nFirst\nTarget\nLast\n</center>','.notebook-rich-line:nth-child(2)','<center>\nFirst\n</center>\n\nTarget\n\n<center>\nLast\n</center>'],
 ['bullet','- First\n- **Target**\n- Last','li:nth-child(2)','- First\n\n**Target**\n\n- Last'],
 ['numbered','3. First\n4. **Target**\n5. Last','li:nth-child(2)','3. First\n\n**Target**\n\n5. Last'],
 ['list continuation','- First\n  Target\n  Last','.notebook-rich-line:nth-child(2)','- First\n\nTarget\n\n- Last'],
 ['inline','**Target** and *rest*','p:last-child','Target and rest'],
])('Delete clears current %s line in '+kind,async(_name,input,selector,expected)=>{
 input='Before\n\n'+input;expected='Before\n\n'+expected;
 await setup(kind,input);
 await page.evaluate(selector=>{const line=rich.querySelector(selector),text=document.createTreeWalker(line,NodeFilter.SHOW_TEXT).nextNode();rich.focus();getSelection().setBaseAndExtent(text,0,text,0);},selector);
 await page.keyboard.press('Delete');
 expect(await page.evaluate(()=>source.value)).toBe(expected);
 await page.keyboard.press('Meta+z');
 expect(await page.evaluate(()=>source.value)).toBe(input);
 await page.keyboard.press('Meta+Shift+z');
 expect(await page.evaluate(()=>source.value)).toBe(expected);
});

for(const kind of ['post','article','note'])describe(kind+' natural editing audit',()=>{
 test('repeated highlight toggles formatting off and preserves selection',async()=>{
  await setup(kind,'Before\n\nTarget words');
  await page.evaluate(()=>{const p=rich.querySelector('p:last-child'),r=document.createRange();r.selectNodeContents(p);getSelection().removeAllRanges();getSelection().addRange(r);surface.selection();surface.format('highlight');surface.format('highlight');});
  expect(await page.evaluate(()=>source.value)).toBe('Before\n\nTarget words');
 });
 test('Markdown list and quote controls toggle instead of nesting prefixes',async()=>{
  await setup(kind,'Before\n\nFirst\nSecond');
  for(const command of ['insertUnorderedList','insertOrderedList','formatBlock']){
   await page.evaluate(command=>{surface.toSource();source.setSelectionRange(8,source.value.length);surface.format(command,'blockquote');surface.format(command,'blockquote');},command);
   expect(await page.evaluate(()=>source.value)).toBe('Before\n\nFirst\nSecond');
  }
 });
 test('sequential line-format removals undo and redo independently',async()=>{
  await setup(kind,'Before\n\n## First\n\n## Second');
  for(const selector of ['h2:first-of-type','h2']){
   await page.evaluate(selector=>selectBlock(selector,false),selector);
   await page.keyboard.press('Delete');
  }
  expect(await page.evaluate(()=>source.value)).toBe('Before\n\nFirst\n\nSecond');
  await page.keyboard.press('Meta+z');await page.keyboard.press('Meta+z');
  expect(await page.evaluate(()=>source.value)).toBe('Before\n\n## First\n\n## Second');
  await page.keyboard.press('Meta+Shift+z');await page.keyboard.press('Meta+Shift+z');
  expect(await page.evaluate(()=>source.value)).toBe('Before\n\nFirst\n\nSecond');
 });
 test('centering an already centered selection removes alignment',async()=>{
  await setup(kind,'Before\n\nTarget words');
  await page.evaluate(()=>{selectBlock('p:last-child');surface.format('center');surface.format('center');});
  expect(await page.evaluate(()=>source.value)).toBe('Before\n\nTarget words');
  expect(await page.evaluate(()=>surface.mode)).toBe('rich');
 });
});

for(const kind of ['post','article','note'])test.each(['center','subtext'])('%s preserves the typing position in '+kind,async style=>{
 await setup(kind,'Before\n\nTarget العربية');
 await page.evaluate(style=>{selectBlock('p:last-child');surface.format(style==='center'?'center':'style',style==='subtext'?'subtext':undefined);},style);
 await page.keyboard.type(' appended');
 const expected=style==='center'?'Before\n\n<center>\nTarget العربية appended\n</center>':'Before\n\n-# Target العربية appended';
 expect(await page.evaluate(()=>source.value)).toBe(expected);
});
test('highlight removal affects only selected text and can be undone',async()=>{
 await setup('article','Before\n\n==First middle last==');
 await page.evaluate(()=>{const text=rich.querySelector('mark').firstChild;rich.focus();getSelection().setBaseAndExtent(text,6,text,12);surface.selection();surface.format('highlight');});
 expect(await page.evaluate(()=>source.value)).toBe('Before\n\n==First== middle ==last==');
 expect(await page.evaluate(()=>getSelection().toString())).toBe('middle');
 await page.keyboard.press('Meta+z');
 expect(await page.evaluate(()=>source.value)).toBe('Before\n\n==First middle last==');
});

test('typing after a line-format change undoes before the formatting change',async()=>{
 await setup('article','Before\n\n## Target');
 await page.evaluate(()=>selectBlock('h2',false));
 await page.keyboard.press('Delete');await page.keyboard.insertText('New ');
 await page.keyboard.press('Meta+z');
 expect(await page.evaluate(()=>source.value)).toBe('Before\n\nTarget');
 await page.keyboard.press('Meta+z');
 expect(await page.evaluate(()=>source.value)).toBe('Before\n\n## Target');
});
test('clear formatting removes highlight and code while retaining selected words',async()=>{
 await setup('article','Before\n\n==Marked== and `code`');
 await page.evaluate(()=>{const r=document.createRange();r.selectNodeContents(rich.querySelector('p:last-child'));getSelection().removeAllRanges();getSelection().addRange(r);surface.selection();surface.format('removeFormat');});
 expect(await page.evaluate(()=>source.value)).toBe('Before\n\nMarked and code');
});
test('clear formatting preserves unselected emphasis across paragraphs and supports Undo',async()=>{
 const original='Before\n\n**First middle**\n\n==Last words==';
 await setup('article',original);
 await page.evaluate(()=>{const first=rich.querySelector('strong').firstChild,last=rich.querySelector('mark').firstChild;getSelection().setBaseAndExtent(first,6,last,4);surface.selection();surface.format('removeFormat');});
 expect(await page.evaluate(()=>source.value)).toBe('Before\n\n**First** middle\n\nLast ==words==');
 await page.keyboard.press('Meta+z');
 expect(await page.evaluate(()=>source.value)).toBe(original);
});
for(const command of ['center','subtext','divider','footnote'])test(command+' insertion supports Undo and Redo in formatted mode',async()=>{
 await setup('article','Before\n\nTarget words');
 await page.evaluate(command=>{selectBlock('p:last-child');surface.format(command==='subtext'?'style':command,command==='subtext'?'subtext':undefined);},command);
 const changed=await page.evaluate(()=>source.value);
 expect(changed).not.toBe('Before\n\nTarget words');
 await page.keyboard.press('Meta+z');
 expect(await page.evaluate(()=>source.value)).toBe('Before\n\nTarget words');
 await page.keyboard.press('Meta+Shift+z');
 expect(await page.evaluate(()=>source.value)).toBe(changed);
});
test('Markdown center control toggles its selected block without nesting tags',async()=>{
 await setup('article','Before\n\nTarget');
 await page.evaluate(()=>{surface.toSource();source.setSelectionRange(8,source.value.length);surface.format('center');surface.format('center');});
 expect(await page.evaluate(()=>source.value)).toBe('Before\n\nTarget');
});

for(const kind of ['post','article','note'])test('quote and subtext compose without exposing markers in '+kind,async()=>{
 await setup(kind,'Before\n\n> Target العربية\n\nAfter');
 await page.evaluate(()=>{selectBlock('blockquote p');surface.format('style','subtext');});
 expect(await page.evaluate(()=>source.value)).toBe('Before\n\n> -# Target العربية\n\nAfter');
 expect(await page.locator('blockquote .notebook-subtext').innerText()).toBe('Target العربية');
 await page.evaluate(()=>surface.format('formatBlock','blockquote'));
 expect(await page.evaluate(()=>source.value)).toBe('Before\n\n-# Target العربية\n\nAfter');
 await page.evaluate(()=>surface.format('formatBlock','blockquote'));
 expect(await page.evaluate(()=>source.value)).toBe('Before\n\n> -# Target العربية\n\nAfter');
 await page.keyboard.type(' appended');
 expect(await page.evaluate(()=>source.value)).toContain('> -# Target العربية appended');
});
test('article subtext preserves the viewport and Markdown switch is above the body',async()=>{
 await setup('article',Array.from({length:80},(_,i)=>'Paragraph '+i+' العربية').join('\n\n'));
 const toggle=page.getByRole('button',{name:'Switch to Markdown editing',exact:true});
 expect((await toggle.boundingBox()).y).toBeLessThan((await page.locator('.community-rich-input').boundingBox()).y);
 await page.evaluate(()=>{selectBlock('p:nth-child(50)');rich.querySelector('p:nth-child(50)').scrollIntoView({block:'center'});});
 const before=await page.evaluate(()=>({scroll:scrollY,y:rich.querySelector('p:nth-child(50)').getBoundingClientRect().top}));
 await page.evaluate(()=>surface.format('style','subtext'));
 const after=await page.evaluate(()=>({scroll:scrollY,y:rich.querySelector('.notebook-subtext').getBoundingClientRect().top}));
 expect(Math.abs(after.scroll-before.scroll)).toBeLessThan(2);
 expect(Math.abs(after.y-before.y)).toBeLessThan(2);
 await page.screenshot({path:'/tmp/article-subtext-viewport.png'});
});
test('switching quoted subtext back to normal retains the quote',async()=>{
 await setup('article','Before\n\n> -# Target\n\nAfter');
 await page.evaluate(()=>{selectBlock('.notebook-subtext');surface.format('style','0');});
 expect(await page.evaluate(()=>source.value)).toBe('Before\n\n> Target\n\nAfter');
});
for(const kind of ['post','article','note'])describe(kind+' editable colored blocks',()=>{
 test('callout title and bilingual body support typing, Enter, Undo and mode switching',async()=>{
  await setup(kind,'Before\n\n> [!tip] **A title**\n> Body العربية\n\nAfter');
  expect(await page.locator('.markdown-callout [contenteditable=false]').count()).toBe(0);
  expect(await page.locator('[data-notebook-raw]').count()).toBe(0);
  await page.evaluate(()=>selectBlock('.markdown-callout-title'));
  await page.keyboard.type(' changed');
  await page.evaluate(()=>selectBlock('.markdown-callout p:last-child'));
  await page.keyboard.press('Enter');await page.keyboard.insertText('New paragraph');
  expect(await page.evaluate(()=>source.value)).toContain('> New paragraph');
  expect(await page.locator('.markdown-callout').innerText()).toContain('A title changed');
  await page.keyboard.press('Meta+z');
  expect(await page.locator('.markdown-callout').innerText()).not.toContain('New paragraph');
  await page.keyboard.press('Meta+Shift+z');
  const edited=await page.evaluate(()=>source.value);
  await page.getByRole('button',{name:'Switch to Markdown editing',exact:true}).click();
  await page.getByRole('button',{name:'Switch to formatted editing',exact:true}).click();
  expect(await page.evaluate(()=>source.value)).toBe(edited);
  expect(await page.locator('.markdown-callout-tip').innerText()).toContain('New paragraph');
  await page.screenshot({path:'/tmp/editable-callout-'+kind+'.png'});
 });
 test('unrelated edits preserve exact callout Markdown and body formatting stays inside it',async()=>{
  const callout='> [!WARNING] Title {.callout}\n> Body **bold** العربية\n>\n> - One\n> - Two';
  await setup(kind,'Before\n\n'+callout+'\n\nAfter');
  await page.keyboard.type(' changed');
  expect(await page.evaluate(()=>source.value)).toContain(callout);
  await page.evaluate(()=>{selectBlock('.markdown-callout p:nth-child(2)');surface.format('style','subtext');});
  expect(await page.locator('.markdown-callout-warning .notebook-subtext').innerText()).toBe('Body bold العربية');
 });
});
test('Arabic list markers stay RTL in formatted, rendered and print views',async()=>{
 const md='Paragraph\n\n- ﴿التَّائِبُونَ الْعَابِدُونَ﴾ [سُورَةُ التَّوْبَةِ ٩:١١٢](/quran/9:112)\n\n  > English translation\n\n- English item\n\n  - العربية';
 await setup('article',md);
 await page.evaluate(()=>rich.dataset.listAudit='true');
 const directions=()=>page.locator('[data-list-audit] li').evaluateAll(items=>items.map(item=>({dir:getComputedStyle(item).direction,left:parseFloat(getComputedStyle(item).marginLeft),right:parseFloat(getComputedStyle(item).marginRight)})));
 let metrics=await directions();expect(metrics.map(item=>item.dir)).toEqual(['rtl','ltr','rtl']);expect(metrics[0].right).toBeGreaterThan(metrics[0].left);
 await page.screenshot({path:'/tmp/arabic-list-editor.png'});
 await page.evaluate(html=>{rich.innerHTML=html;rich.contentEditable='false';rich.classList.remove('community-rich-input');},Notebook.render(md));
 metrics=await directions();expect(metrics.map(item=>item.dir)).toEqual(['rtl','ltr','rtl']);expect(metrics[0].right).toBeGreaterThan(metrics[0].left);
 await page.screenshot({path:'/tmp/arabic-list-direction.png'});
 await page.emulateMedia({media:'print'});
 expect((await directions()).map(item=>item.dir)).toEqual(['rtl','ltr','rtl']);
});

for(const kind of ['post','article','note'])describe(`${kind} list keyboard indentation`,()=>{
 test('Tab nests a selected bullet, Shift+Tab restores it, and undo preserves editing',async()=>{
  await setup(kind,'Intro\n\n- First\n- العربية\n- Third');
  await page.evaluate(()=>selectBlock('li:nth-child(2)'));
  await page.keyboard.press('Tab');
  expect(await page.evaluate(()=>source.value)).toBe('Intro\n\n- First\n  - العربية\n- Third');
  expect(await page.evaluate(()=>rich.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Shift+Tab');
  expect(await page.evaluate(()=>source.value)).toBe('Intro\n\n- First\n- العربية\n- Third');
  await page.keyboard.press('Meta+z');
  expect(await page.evaluate(()=>source.value)).toBe('Intro\n\n- First\n  - العربية\n- Third');
 });
 test('raw Markdown Tab and Shift+Tab work without relying on the toolbar',async()=>{
  await setup(kind,'Intro\n\n- First\n- Second');
  await page.evaluate(()=>{surface.toSource();source.focus();const start=source.value.indexOf('- Second');source.setSelectionRange(start,source.value.length);});
  await page.keyboard.press('Tab');
  expect(await page.evaluate(()=>source.value)).toBe('Intro\n\n- First\n  - Second');
  await page.keyboard.press('Shift+Tab');
  expect(await page.evaluate(()=>source.value)).toBe('Intro\n\n- First\n- Second');
 });
});

for(const kind of ['post','article','note'])test(`${kind} formatted links open without changing the draft`,async()=>{
 await setup(kind,'Intro\n\n[Read source](https://example.com/source)');
 await page.evaluate(()=>{window.opened=[];window.open=(...args)=>opened.push(args);});
 await page.locator('.community-rich-input a').click();
 expect(await page.evaluate(()=>opened)).toEqual([['https://example.com/source','_blank','noopener,noreferrer']]);
 expect(await page.evaluate(()=>source.value)).toBe('Intro\n\n[Read source](https://example.com/source)');
});

test.each(['-','1.'])('formatted Tab indents a selected group and survives mode switching: %s',async marker=>{
 const original=marker==='-'?'Intro\n\n- Parent\n- Second\n- Third':'Intro\n\n1. Parent\n2. Second\n3. Third';
 await setup('article',original);
 await page.evaluate(()=>{
  rich.focus();const items=rich.querySelectorAll('li'),range=document.createRange();range.setStart(items[1].firstChild,0);range.setEnd(items[2].firstChild,items[2].firstChild.textContent.length);getSelection().removeAllRanges();getSelection().addRange(range);surface.selection();
 });
 await page.keyboard.press('Tab');
 const nested=await page.evaluate(()=>source.value);
 expect(require('../lib/ContentMarkdown').render(nested)).toMatch(/<li[^>]*>Parent\s*<(?:ul|ol)>/);
 await page.evaluate(()=>{surface.toSource();surface.toFormatted();surface.sync();});
 expect(await page.evaluate(()=>source.value)).toBe(nested);
 expect(await page.locator('.community-rich-input li > :is(ul,ol) > li').count()).toBe(2);
});

test.each(['en','ar'])('formatted Tab visibly moves bullet text inward and link hover uses pointer: %s',async lang=>{
 const parent=lang==='ar'?'العنصر الأول':'First item',child=lang==='ar'?'العنصر الثاني':'Second item';
 await setup('article',`Intro\n\n- ${parent}\n- ${child}\n\n[Read source](https://example.com)`);
 const edge=()=>page.evaluate(()=>{const li=[...rich.querySelectorAll('li')].find(n=>!n.querySelector('li') && (n.textContent.includes('Second item')||n.textContent.includes('العنصر الثاني')));const r=document.createRange();r.selectNodeContents(li);const rect=r.getBoundingClientRect();return getComputedStyle(li).direction==='rtl'?-rect.right:rect.left;});
 await page.evaluate(()=>selectBlock('li:nth-child(2)'));
 const before=await edge();
 await page.keyboard.press('Tab');
 const after=await edge();
 await page.screenshot({path:`/tmp/list-indent-${lang}.png`});
 expect(after-before).toBeGreaterThan(20);
 await page.keyboard.press('Shift+Tab');
 expect(await edge()).toBeCloseTo(before,0);
 await page.locator('.community-rich-input a').hover();
 expect(await page.locator('.community-rich-input a').evaluate(n=>getComputedStyle(n).cursor)).toBe('pointer');
});

test.each(['post','article','note'])('%s Tab nests loose bullets with bold text instead of creating blockquotes',async kind=>{
 await setup(kind,'Intro\n\n- Truthful foretelling\n\n- **Nubuwwah** means prophethood\n\n- Foretelling is one aspect');
 await page.evaluate(()=>{rich.focus();const text=rich.querySelector('li:nth-child(2) strong').firstChild;getSelection().setBaseAndExtent(text,0,text,0);surface.selection();});
 await page.keyboard.press('Tab');
 expect(await page.locator('.community-rich-input blockquote').count()).toBe(0);
 expect(await page.locator('.community-rich-input li > ul > li strong').textContent()).toBe('Nubuwwah');
 expect(await page.evaluate(()=>source.value)).not.toContain('>');
 await page.screenshot({path:`/tmp/loose-bullet-indent-${kind}.png`});
 await page.keyboard.press('Shift+Tab');
 expect(await page.locator('.community-rich-input > ul > li').count()).toBe(3);
 expect(await page.locator('.community-rich-input blockquote').count()).toBe(0);
 await page.keyboard.press('Meta+z');
 expect(await page.locator('.community-rich-input li > ul > li strong').textContent()).toBe('Nubuwwah');
});

test.each(['note','article'])('%s formatted heading outline stays visible and updates while editing',async kind=>{
 await setup(kind,'Intro\n\n# First heading\n\nBody\n\n## العنوان الثاني',1200);
 if(kind==='note'){
  const sourceText=fs.readFileSync('public/static/js/notebook.js','utf8');
  const outlineCode=sourceText.slice(sourceText.indexOf('  // The outline stays outside'),sourceText.indexOf('  async function openRequestedWiki'));
  await page.addScriptTag({content:`(()=>{const modal=document.getElementById('notebook-modal'),editor=document.getElementById('notebook-editor'),preview=document.getElementById('notebook-preview');modal.querySelector('.modal-dialog').classList.add('modal-fullscreen');${outlineCode}})();`});
 }
 const panel=page.locator(kind==='note'?'#notebook-outline':'.community-editing-outline');
 await expectVisible();
 async function expectVisible(){await page.waitForFunction(selector=>{const n=document.querySelector(selector);return n && !n.hidden && n.querySelectorAll('button').length>=2;},kind==='note'?'#notebook-outline':'.community-editing-outline');}
 const buttons=panel.locator(kind==='note'?'#notebook-outline-items button':'ol button');
 expect(await buttons.allTextContents()).toEqual(kind==='note'?['H1First heading','H2العنوان الثاني']:['First heading','العنوان الثاني']);
 await page.evaluate(()=>{rich.querySelector('h1').textContent='Renamed heading';const h=document.createElement('h3');h.textContent='Added heading';rich.append(h);rich.dispatchEvent(new InputEvent('input',{bubbles:true}));});
 await page.waitForFunction(()=>document.querySelector('#notebook-outline-items,.community-editing-outline ol')?.textContent.includes('Added heading'));
 expect(await buttons.first().textContent()).toContain('Renamed heading');
 await buttons.last().click();
 expect(await page.evaluate(()=>rich.contains(getSelection().anchorNode))).toBe(true);
 await page.keyboard.type('Edited ');
 await page.waitForFunction(()=>document.querySelector('#notebook-outline-items,.community-editing-outline ol')?.textContent.includes('Edited Added heading'));
 await page.evaluate(()=>{rich.querySelector('h2').remove();rich.dispatchEvent(new InputEvent('input',{bubbles:true}));});
 await page.waitForFunction(()=>!document.querySelector('#notebook-outline-items,.community-editing-outline ol')?.textContent.includes('العنوان الثاني'));
 const positions=await page.evaluate(selector=>{const panel=document.querySelector(selector).getBoundingClientRect(),editor=rich.getBoundingClientRect();return {panelLeft:panel.left,editorRight:editor.right};},kind==='note'?'#notebook-outline':'.community-editing-outline');
 expect(positions.panelLeft).toBeGreaterThanOrEqual(positions.editorRight);
 await page.screenshot({path:`/tmp/live-heading-outline-${kind}.png`});
});

for(const kind of ['post','article','note'])describe('Markdown typing in '+kind,()=>{
 test.each([['**bold**','strong'],['*italic*','em'],['_italic_','em'],['~~removed~~','s'],['==marked==','mark'],['`code`','code'],['[[My note]]','a'],['[Example](https://example.org)','a']])('converts %s at the caret and supports undo',async(text,tag)=>{
  await setup(kind,'Before\n\nUnchanged');
  await page.keyboard.type(' '+text);
  expect(await page.locator('.community-rich-input > p').first().locator(tag).count()).toBe(1);
  await page.keyboard.press('Meta+z');
  expect(await page.locator('.community-rich-input > p').first().textContent()).toBe('Before '+text);
  await page.keyboard.press('Meta+Shift+z');
  await page.keyboard.type(' after');
  expect((await page.locator('.community-rich-input > p').first().textContent()).replace(/\u00a0/g,' ')).toMatch(/ after$/);
  expect(await page.locator('.community-rich-input > p').first().locator(tag).textContent()).not.toContain('after');
  expect(await page.locator('.community-rich-input > p').last().textContent()).toBe('Unchanged');
 });
 test.each([['# ','h1'],['### ','h3'],['- ','ul > li'],['3. ','ol > li'],['> ','blockquote > p']])('converts a line prefix %s',async(text,selector)=>{
  await setup(kind,'Start');await page.evaluate(()=>{rich.focus();getSelection().selectAllChildren(rich);});await page.keyboard.press('Backspace');
  await page.keyboard.type(text+'Mercy');
  expect(await page.locator('.community-rich-input '+selector).textContent()).toBe('Mercy');
 });
 test('does not convert escaped syntax, intraword underscores or code contents',async()=>{
  await setup(kind,'Start');await page.keyboard.type(' \\*literal* word_inside_word `**literal**`');
  expect(await page.locator('.community-rich-input strong,.community-rich-input em').count()).toBe(0);
  expect(await page.locator('.community-rich-input code').textContent()).toBe('**literal**');
 });
 test('formatting deep in the editor preserves scroll position',async()=>{
  await setup(kind,Array.from({length:80},(_,i)=>'Paragraph '+i+' with words').join('\n\n'));
  await page.evaluate(()=>{selectBlock('p:nth-child(50)');rich.querySelector('p:nth-child(50)').scrollIntoView({block:'center'});});
  const before=await page.evaluate(()=>({top:rich.scrollTop,y:scrollY}));
  await page.evaluate(()=>surface.format('center'));
  const after=await page.evaluate(()=>({top:rich.scrollTop,y:scrollY}));
  expect(Math.abs(after.top-before.top)).toBeLessThan(2);expect(Math.abs(after.y-before.y)).toBeLessThan(2);
 });
});

test('a horizontal rule converts on Enter and undo restores the typed marker',async()=>{
 await setup('note','Start');await page.evaluate(()=>{rich.focus();getSelection().selectAllChildren(rich);});await page.keyboard.press('Backspace');
 await page.keyboard.type('---');await page.keyboard.press('Enter');
 expect(await page.locator('.community-rich-input hr').count()).toBe(1);
 await page.keyboard.press('Meta+z');expect(await page.locator('.community-rich-input').innerText()).toBe('---');
});

for(const kind of ['post','article','note'])describe('reported Markdown examples in '+kind,()=>{
 test.each(['Enter','Shift+Enter'].flatMap(key=>[['- ','ul > li'],['* ','ul > li'],['> ','blockquote > p'],['-# ','.notebook-subtext']].map(pair=>[...pair,key])))('converts %s after %s (%s)',async(text,selector,key)=>{
  await setup(kind,'Previous paragraph');await page.keyboard.press(key);await page.keyboard.type(text+'New line');
  expect(await page.locator('.community-rich-input '+selector).textContent()).toBe('New line');
  expect(await page.locator('.community-rich-input').innerText()).toContain('Previous paragraph');
 });
 test.each([['__double underline__','u'],['~subscript~','sub'],['word^1^','sup']])('converts custom inline %s',async(text,tag)=>{
  await setup(kind,'Before');await page.keyboard.type(' '+text);
  expect(await page.locator('.community-rich-input '+tag).count()).toBe(1);
  expect(await page.evaluate(()=>source.value)).toContain(text);
  await page.keyboard.press('Meta+z');expect(await page.locator('.community-rich-input').innerText()).toContain(text);
 });
 test('converts columns when the completed row is followed by Enter',async()=>{
  await setup(kind,'Previous');await page.keyboard.press('Enter');await page.keyboard.type('col 1 || col 2');await page.keyboard.press('Enter');
  expect(await page.locator('.community-edit-parallel-cell').allTextContents()).toEqual(['col 1','col 2']);
  expect(await page.evaluate(()=>source.value)).toContain('col 1 || col 2');
  await page.keyboard.type('Next paragraph');expect(await page.evaluate(()=>source.value)).toContain('Next paragraph');
 });
 test.each(['___','***'])('converts standalone %s after normal Enter',async(marker)=>{
  await setup(kind,'Previous');await page.keyboard.press('Enter');await page.keyboard.type(marker);await page.keyboard.press('Enter');
  expect(await page.locator('.community-rich-input hr').count()).toBe(1);
 });
});

for(const kind of ['post','article','note'])test('spaced subscript and Arabic underline in '+kind,async()=>{
 await setup(kind,'Before');await page.keyboard.type(' ~not working~');
 expect(await page.locator('.community-rich-input sub').textContent()).toBe('not working');
 expect(await page.evaluate(()=>source.value)).toContain('~not\\ working~');
 await page.keyboard.type(' __');await page.keyboard.insertText('العربية');await page.keyboard.type('__');
 expect(await page.locator('.community-rich-input u').textContent()).toBe('العربية');
 expect(await page.locator('.community-rich-input u [data-underline-run]').evaluate(el=>getComputedStyle(el).textDecorationLine)).toBe('overline');
 expect(await page.evaluate(()=>source.value)).toContain('__العربية__');
});

for(const kind of ['post','article','note'])describe('divider input paths in '+kind,()=>{
 test.each(['___','***'].flatMap(marker=>['Enter','Shift+Enter','insertParagraph','insertLineBreak'].map(action=>[marker,action])))('%s converts with %s at an element caret',async(marker,action)=>{
  await setup(kind,'Before\n\nMarker\n\nAfter');
  await page.evaluate(marker=>{
   const p=rich.querySelectorAll('p')[1];p.innerHTML='<strong></strong>';p.firstChild.textContent=marker;rich.focus();
   const range=document.createRange();range.selectNodeContents(p);range.collapse(false);getSelection().removeAllRanges();getSelection().addRange(range);surface.sync();
  },marker);
  if(action.startsWith('insert')){
   expect(await page.evaluate(inputType=>rich.dispatchEvent(new InputEvent('beforeinput',{inputType,bubbles:true,cancelable:true})),action)).toBe(false);
  }else await page.keyboard.press(action);
  expect(await page.locator('.community-rich-input hr').count()).toBe(1);
  expect(await page.evaluate(()=>source.value)).toContain('Before');expect(await page.evaluate(()=>source.value)).toContain('After');
  await page.keyboard.type('New paragraph');expect(await page.evaluate(()=>source.value)).toContain('New paragraph');
 });
});
