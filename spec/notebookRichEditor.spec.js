'use strict';
const ejs = require('ejs');
const fs = require('fs');
const { chromium } = require('playwright');
let browser, page;
beforeAll(async () => { browser = await chromium.launch({ channel: 'chrome', headless: true }); });
afterAll(async () => browser?.close());
afterEach(async () => page?.close());
async function setup(width = 900) {
  page = await browser.newPage({ viewport: { width, height: 800 } });
  await page.route('http://notebook.test/**',route=>{const pathname=new URL(route.request().url()).pathname;if(pathname.startsWith('/static/fonts/'))return route.fulfill({body:fs.readFileSync(require('path').join(__dirname,'../public',pathname)),contentType:'font/woff2'});return route.fulfill({body:'<!doctype html>',contentType:'text/html'});});
  await page.goto('http://notebook.test/');
  const markup = (await ejs.renderFile(require.resolve('../views/sub-views/notebook_modal.ejs'), { utils: { scriptAssetVersion: () => 'test' } })).replace(/<script[^]*?<\/script>/g, '');
  await page.setContent('<style>[hidden]{display:none!important} #notebook-surface{height:550px;display:flex;flex-direction:column} .modal-header,.modal-footer{display:none}</style>' + markup);
  await page.locator('#notebook-modal').evaluate(node => node.setAttribute('aria-hidden', 'false'));
  await page.addStyleTag({ path: 'public/static/css/community.css' });
  await page.addStyleTag({ content: await page.locator('style').allTextContents().then(styles => styles.join('\n')) });
  await page.addScriptTag({ content: fs.readFileSync('node_modules/marked/lib/marked.umd.js','utf8') });
  for (const file of ['notebook-shortcuts','notebook-wiki','community-parallel-text','community-short-editor','community-formatting','notebook-sections','notebook-rich-editor']) await page.addScriptTag({ path: 'public/static/js/'+file+'.js' });
  await page.evaluate(() => {
    NotebookRichEditor.setPreviewRenderer(async () => '<p>Rendered advanced block</p>');
    window.source = document.getElementById('notebook-editor');
    window.preview = document.getElementById('notebook-preview');
    source.value = '# Mercy\n\n**Kindness** and رحمة\n\nSecond paragraph';
    preview.innerHTML = CommunityShortEditor.render(source.value).innerHTML;
    window.edit = value => { preview.hidden = value; NotebookRichEditor.setEditing(value); };
  });
}
test.each([390,900])('formatted editing and preview share geometry with a visible top toolbar at %s px', async width => {
  await setup(width);
  await page.evaluate(() => edit(true));
  const rich = page.locator('#notebook-surface .community-rich-input');
  await expectVisible(rich);
  expect(await page.locator('#notebook-format-toolbar').isVisible()).toBe(true);
  const before = await rich.locator('p').first().boundingBox();
  await page.waitForFunction(() => document.querySelectorAll('.notebook-line-numbers span').length >= 3);
  const numbers = await page.locator('.notebook-line-numbers').innerText();
  await page.screenshot({ path: '/tmp/notebook-rich-' + width + '.png' });
  await rich.locator('p').last().fill('Changed paragraph');
  expect(await page.locator('#notebook-editor').inputValue()).toContain('Changed paragraph');
  await page.evaluate(() => { preview.innerHTML = CommunityShortEditor.render(source.value).innerHTML; edit(false); });
  const after = await page.locator('#notebook-preview p').first().boundingBox();
  expect(after.x).toBe(before.x); expect(after.width).toBe(before.width);
  expect(await page.locator('#notebook-format-toolbar').isVisible()).toBe(false);
  expect(numbers).toContain('1');
});
async function expectVisible(locator) { expect(await locator.isVisible()).toBe(true); }
test('advanced Markdown opens formatted and switches to source only on request', async () => {
  await setup();
  const markdown = '- [x] Task\n\n[[My note]]\n\n```js\nconst a = 1;\n```';
  await page.evaluate(text => { source.value = text; preview.innerHTML = '<p>Rendered advanced note</p>'; edit(true); }, markdown);
  expect(await page.locator('#notebook-editor').isVisible()).toBe(false);
  await page.waitForFunction(() => document.querySelector('.notebook-advanced-content')?.textContent === 'Rendered advanced block');
  await page.getByRole('button', { name: 'Switch to Markdown editing', exact: true }).click();
  expect(await page.locator('#notebook-editor').isVisible()).toBe(true);
  expect(await page.locator('#notebook-editor').inputValue()).toBe(markdown);
  await page.evaluate(() => edit(false));
  expect(await page.locator('#notebook-editor').isVisible()).toBe(false);
  expect(await page.locator('#notebook-preview').innerText()).toBe('Rendered advanced note');
  expect(await page.locator('#notebook-editor').inputValue()).toBe(markdown);
});

test('top formatting controls edit the selected rich text and Markdown toggle preserves it', async () => {
  await setup();
  await page.evaluate(() => {
    edit(true);
    const rich = CommunityShortEditor.get(source).rich;
    rich.focus();
    const range = document.createRange(); range.selectNodeContents(rich.querySelector('p:last-child'));
    getSelection().removeAllRanges(); getSelection().addRange(range);
  });
  await page.locator('#notebook-format-toolbar [data-format="bold"]').click();
  expect(await page.locator('#notebook-editor').inputValue()).toContain('**Second paragraph**');
  await page.getByRole('button', { name: 'Switch to Markdown editing', exact: true }).click();
  expect(await page.locator('#notebook-editor').isVisible()).toBe(true);
  expect(await page.locator('#notebook-editor').inputValue()).toContain('**Second paragraph**');
});

test('reentering edit mode resets a previous raw choice and advanced blocks survive nearby edits', async () => {
  await setup();
  const raw = '```js\nconst a = 1;\n\n\nconst b = 2;\n```';
  await page.evaluate(raw => { source.value = 'Editable paragraph\n\n' + raw; edit(true); }, raw);
  const rich = page.locator('#notebook-surface .community-rich-input');
  await rich.locator(':scope > p').first().fill('Changed paragraph');
  expect(await page.locator('#notebook-editor').inputValue()).toContain(raw);
  await page.getByRole('button', { name: 'Switch to Markdown editing', exact: true }).click();
  await page.evaluate(() => { edit(false); edit(true); });
  expect(await rich.isVisible()).toBe(true);
  expect(await page.locator('#notebook-editor').isVisible()).toBe(false);
  await page.evaluate(() => { edit(false); source.value = 'Another ordinary note'; edit(true); });
  expect(await rich.innerText()).toBe('Another ordinary note');
});

test('internal link toolbar inserts and edits a link without raw mode', async () => {
  await setup();
  await page.evaluate(() => {
    edit(true);const rich=CommunityShortEditor.get(source).rich;rich.focus();
    const range=document.createRange();range.selectNodeContents(rich.querySelector('p:last-child'));
    getSelection().removeAllRanges();getSelection().addRange(range);
    const answers=['The Mahdi','Related note'];window.prompt=()=>answers.shift();
  });
  await page.locator('#notebook-format-toolbar [data-format="wiki"]').click();
  expect(await page.locator('#notebook-editor').inputValue()).toContain('[[The Mahdi|Related note]]');
  expect(await page.locator('#notebook-editor').isVisible()).toBe(false);
  await page.evaluate(() => {
    const link=document.querySelector('[data-wiki-target]');const range=document.createRange();range.selectNodeContents(link);range.collapse(true);
    getSelection().removeAllRanges();getSelection().addRange(range);
    const answers=['The Second Fitnah','History'];window.prompt=()=>answers.shift();
  });
  await page.locator('#notebook-format-toolbar [data-format="wiki"]').click();
  expect(await page.locator('#notebook-editor').inputValue()).toContain('[[The Second Fitnah|History]]');
});
test.each(['English repeated words here', 'العربية كلمات متكررة هنا'])('preview click preserves the rich caret and scroll for %s', async text => {
  await setup();
  const notebook = fs.readFileSync('public/static/js/notebook.js','utf8');
  const handlers = notebook.slice(notebook.indexOf('  function revealPreviewCaret('),notebook.indexOf('  async function openWiki('));
  await page.evaluate(({text,handlers}) => {
    source.value=Array.from({length:40},()=>text).join('\n\n');
    preview.innerHTML=CommunityShortEditor.render(source.value).innerHTML;
    window.editor=source;window.current={};window.busy=false;window.locked=false;window.editing=false;
    window.mode=value=>{window.editing=value;edit(value);};
    (0,eval)(handlers);
    const paragraph=preview.querySelectorAll('p')[25];preview.scrollTop=paragraph.offsetTop-preview.offsetTop-100;
  },{text,handlers});
  const point = await page.locator('#notebook-preview p').nth(25).evaluate(el=>{
    const r=document.createRange();const walk=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let text;while((text=walk.nextNode()) && text.length<6){}r.setStart(text,5);r.setEnd(text,6);const b=r.getBoundingClientRect();
    return {x:b.x+b.width/2,y:b.y+b.height/2};
  });
  const expected = await page.evaluate(point => previewCaretOffset({clientX:point.x,clientY:point.y}),point);
  await page.mouse.click(point.x,point.y);
  const actual=await page.evaluate(()=>{
    const rich=CommunityShortEditor.get(source).rich;
    const range=getSelection().getRangeAt(0),rect=range.getBoundingClientRect();
    return {offset:previewCaretOffset(null,undefined,rich),top:rect.top-rich.getBoundingClientRect().top,visible:!rich.hidden};
  });
  expect(actual.visible).toBe(true);expect(actual.offset).toBe(expected);
  expect(actual.top).toBeGreaterThanOrEqual(0);expect(actual.top).toBeLessThan(250);
});

test('an unchanged save response preserves the active rich caret', async () => {
  await setup();
  const result=await page.evaluate(()=>{
    edit(true);const rich=CommunityShortEditor.get(source).rich;
    const node=rich.querySelector('p:last-child').firstChild,range=document.createRange();range.setStart(node,6);range.collapse(true);
    rich.focus();getSelection().removeAllRanges();getSelection().addRange(range);
    source.value=source.value;
    return {sameNode:getSelection().anchorNode===node,offset:getSelection().anchorOffset};
  });
  expect(result).toEqual({sameNode:true,offset:6});
});

test.each([
  ['English repeated paragraph', 'none'],
  ['العربية كلمات متكررة هنا', 'none'],
  ['English repeated paragraph', 'forward'],
  ['العربية كلمات متكررة هنا', 'backward']
])('Markdown to formatted retains caret/selection and scroll: %s %s', async (text, direction) => {
  await setup();
  const notebook=fs.readFileSync('public/static/js/notebook.js','utf8');
  const handlers=notebook.slice(notebook.indexOf('  function revealPreviewCaret('),notebook.indexOf('  async function openWiki('));
  const expected=await page.evaluate(({text,direction,handlers})=>{
    window.editor=source;(0,eval)(handlers);
    source.value=Array.from({length:40},()=>text).join('\n\n');edit(true);
    CommunityShortEditor.get(source).toSource();
    const start=(text.length+2)*25+3,end=direction==='none'?start:start+5;
    source.focus();source.setSelectionRange(start,end,direction);
    const active=direction==='backward'?start:end;
    const rect=NotebookWiki.caretRect(source,active);
    source.scrollTop+=rect.top-source.getBoundingClientRect().top-100;
    return {start,end,direction,markdown:source.value};
  },{text,direction,handlers});
  await page.getByRole('button',{name:'Switch to formatted editing',exact:true}).click();
  const actual=await page.evaluate(()=>{
    const rich=CommunityShortEditor.get(source).rich,s=getSelection(),range=s.getRangeAt(0);
    const active=document.createRange();active.setStart(s.focusNode,s.focusOffset);active.collapse(true);
    const offset=previewCaretOffset(null,undefined,rich);
    return {offset,text:s.toString(),backward:s.anchorNode===s.focusNode && s.anchorOffset>s.focusOffset,top:active.getBoundingClientRect().top-rich.getBoundingClientRect().top,markdown:source.value};
  });
  expect(actual.offset).toBe(expected.start);
  expect(actual.text).toBe(direction==='none'?'':expected.markdown.slice(expected.start,expected.end));
  if(direction!=='none')expect(actual.backward).toBe(direction==='backward');
  expect(Math.abs(actual.top-100)).toBeLessThan(4);
  expect(actual.markdown).toBe(expected.markdown);
});

test('English starts on a separate left-aligned line after Arabic in the same quotation', async () => {
  await setup();
  const markdown='> «إِذَا أَنْزَلَ اللَّهُ بِقَوْمٍ عَذَابًا، **أَصَابَ الْعَذَابُ مَنْ كَانَ فِيهِمْ**».\n> When Allah sends a punishment upon a people, **the punishment strikes everyone among them**.';
  await page.evaluate(text=>{source.value=text;edit(true);},markdown);
  const lines=page.locator('#notebook-surface .community-rich-input .notebook-rich-line');
  expect(await lines.count()).toBe(2);
  const positions=await lines.evaluateAll(lines=>lines.map(line=>{
    const range=document.createRange();range.selectNodeContents(line);
    const rect=range.getBoundingClientRect(),box=line.getBoundingClientRect();
    return {direction:getComputedStyle(line).direction,textLeft:rect.left,textTop:rect.top,left:box.left+parseFloat(getComputedStyle(line).paddingLeft)+parseFloat(getComputedStyle(line).borderLeftWidth)};
  }));
  expect(positions[0].direction).toBe('rtl');expect(positions[1].direction).toBe('ltr');
  expect(positions[1].textTop).toBeGreaterThan(positions[0].textTop);
  expect(Math.abs(positions[1].textLeft-positions[1].left)).toBeLessThan(2);
  expect(await page.locator('#notebook-editor').inputValue()).toBe(markdown);
  await lines.nth(1).evaluate(line=>{const range=document.createRange();range.selectNodeContents(line);range.collapse(false);line.closest('[contenteditable]').focus();getSelection().removeAllRanges();getSelection().addRange(range);});
  await page.keyboard.type('!');
  const saved=await page.locator('#notebook-editor').inputValue();
  expect(saved).toContain('\n> When Allah');
  expect(saved).toContain('!');
  expect(saved).not.toContain('\n> \n> When Allah');
});

test('line numbers count authored lines rather than wrapped visual rows in every mode', async () => {
  await setup(390);
  const markdown='A long **formatted** line '+ 'with many words '.repeat(35)+'\nSecond authored line\n\nThird paragraph';
  await page.evaluate(text=>{
    source.value=text;preview.innerHTML=CommunityShortEditor.render(text).innerHTML;edit(true);
  },markdown);
  await page.waitForFunction(()=>document.querySelectorAll('.notebook-line-numbers span').length===3);
  const numbers=page.locator('.notebook-line-numbers span');
  expect(await numbers.allTextContents()).toEqual(['1','2','3']);
  await page.setViewportSize({width:900,height:800});
  expect(await numbers.allTextContents()).toEqual(['1','2','3']);
  await page.evaluate(()=>edit(false));
  await page.waitForFunction(()=>document.querySelectorAll('.notebook-line-numbers span').length===3);
  expect(await numbers.allTextContents()).toEqual(['1','2','3']);
  await page.evaluate(()=>edit(true));
  await page.getByRole('button',{name:'Switch to Markdown editing',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.notebook-line-numbers span').length===4);
  expect(await numbers.allTextContents()).toEqual(['1','2','3','4']);
});

test('formatted editing and Markdown preview use identical Arabic spans and language-specific quote edges',async()=>{
 await setup(1280);
 const markdown='> **إِنَّمَا الْأَعْمَالُ بِالنِّيَّاتِ**\n> العربية\n> Actions are judged by intentions.\n\n> English first.\n> نص عربي';
 const html=require('../lib/UserNotebook').render(markdown);
 await page.evaluate(({markdown,html})=>{source.value=markdown;preview.innerHTML=html;edit(true);},{markdown,html});
 await page.evaluate(()=>document.fonts.ready);
 const metrics=async selector=>page.locator(selector).evaluateAll(es=>es.map(e=>{const s=getComputedStyle(e);return {dir:s.direction,left:s.borderLeftWidth,right:s.borderRightWidth,color:s.borderInlineStartColor,padding:s.paddingInlineStart};}));
 const rich=await metrics('.community-rich-input .notebook-quote-section');
 expect(rich.map(m=>m.dir)).toEqual(['rtl','rtl','ltr','ltr','rtl']);
 const font=await page.locator('.community-rich-input .notebook-arabic').first().evaluate(e=>{const s=getComputedStyle(e);return [s.fontFamily,s.fontSize,s.lineHeight]});
 expect(font[0]).toContain('Hafs');
 await page.screenshot({path:'/tmp/note-formatted-mode.png',fullPage:true});
 await page.evaluate(()=>edit(false));
 const rendered=await metrics('#notebook-preview blockquote');
 expect([rich[0],rich[2],rich[3],rich[4]]).toEqual(rendered);
 expect(await page.locator('#notebook-preview .notebook-arabic').first().evaluate(e=>{const s=getComputedStyle(e);return [s.fontFamily,s.fontSize,s.lineHeight]})).toEqual(font);
 await page.screenshot({path:'/tmp/note-markdown-preview-mode.png',fullPage:true});
 await page.evaluate(()=>edit(true));
 await page.getByRole('button',{name:'Switch to Markdown editing',exact:true}).click();
 expect(await page.locator('#notebook-editor').inputValue()).toBe(markdown);
 expect(await page.locator('#notebook-editor').evaluate(e=>getComputedStyle(e).fontFamily)).toContain('NotebookEditableArabic');
 await page.getByRole('button',{name:'Switch to formatted editing',exact:true}).click();
 expect(await page.locator('#notebook-editor').inputValue()).toBe(markdown);
});

test('typing across Arabic and English keeps the caret, Markdown, and toolbar-created quote edge',async()=>{
 await setup();
 await page.evaluate(()=>{source.value='> العربية';edit(true);const rich=CommunityShortEditor.get(source).rich;rich.innerHTML='<blockquote>العربية</blockquote>';rich.focus();const range=document.createRange();range.selectNodeContents(rich.querySelector('blockquote'));range.collapse(false);getSelection().removeAllRanges();getSelection().addRange(range);});
 await page.keyboard.type(' English');
 expect(await page.locator('#notebook-editor').inputValue()).toBe('> العربية English');
 expect(await page.locator('.community-rich-input .notebook-quote-section').count()).toBe(1);
 expect(await page.locator('.community-rich-input').evaluate(el=>getComputedStyle(el).fontFamily)).toContain('NotebookEditableArabic');
 await page.keyboard.type('!');
 expect(await page.locator('#notebook-editor').inputValue()).toBe('> العربية English!');
});

async function startEditingAtEnd(markdown, selector='p') {
  await setup();
  await page.evaluate(({markdown,selector})=>{
    source.value=markdown;edit(true);const rich=CommunityShortEditor.get(source).rich;
    rich.focus();const range=document.createRange();range.selectNodeContents(rich.querySelector(selector));range.collapse(false);
    getSelection().removeAllRanges();getSelection().addRange(range);
  },{markdown,selector});
}
test.each(['English paragraph','العربية كلمات هنا','English العربية','**Bold paragraph**'])('Enter moves the caret into the new paragraph: %s',async markdown=>{
  await startEditingAtEnd(markdown);
  await page.keyboard.press('Enter');
  await page.keyboard.type('Next paragraph');
  expect(await page.locator('#notebook-editor').inputValue()).toMatch(/\n\n(?:\*\*)?Next paragraph/);
  await page.keyboard.press('Enter');await page.keyboard.press('Enter');
  await page.keyboard.type('After blank');
  expect(await page.locator('.community-rich-input').innerText()).toMatch(/Next paragraph\n+After blank/);
});
test.each(['English paragraph','العربية كلمات هنا'])('soft break and deletion preserve the insertion position: %s',async markdown=>{
  await startEditingAtEnd(markdown);
  await page.keyboard.press('Shift+Enter');await page.keyboard.type('Next');
  expect(await page.locator('.community-rich-input').innerText()).toContain(markdown+'\nNext');
  for(let i=0;i<4;i++)await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');await page.keyboard.type(' joined');
  expect((await page.locator('.community-rich-input').innerText()).replace(/\u00a0/g,' ')).toContain(markdown+' joined');
});
test.each(['> English quote','> العربية هنا'])('Enter continues and then exits a quote at the new caret position: %s',async markdown=>{
  await startEditingAtEnd(markdown);
  await page.keyboard.press('Enter');await page.keyboard.type('Translation');
  expect(await page.locator('#notebook-editor').inputValue()).toContain('\n> Translation');
  await page.keyboard.press('Enter');await page.keyboard.press('Enter');
  await page.keyboard.press('Meta+z');
  expect(await page.evaluate(()=>Boolean(getSelection().anchorNode.parentElement.closest('blockquote')))).toBe(true);
  await page.keyboard.press('Meta+Shift+z');await page.keyboard.type('Outside');
  expect(await page.locator('#notebook-editor').inputValue()).toContain('\n\nOutside');
  expect(await page.locator('#notebook-editor').inputValue()).toMatch(/\n\nOutside$/);
  expect(await page.locator('#notebook-editor').inputValue()).toContain(markdown);
  expect(await page.evaluate(()=>getSelection().anchorNode.parentElement.closest('blockquote'))).toBeNull();
});
test.each(['- English item','- العربية هنا','3. Ordered item'])('list Enter continues and exits without losing the caret: %s',async markdown=>{
  await startEditingAtEnd(markdown,'li');
  await page.keyboard.press('Enter');await page.keyboard.type('Next item');
  expect(await page.locator('.community-rich-input li').nth(1).innerText()).toBe('Next item');
  await page.keyboard.press('Enter');await page.keyboard.press('Enter');await page.keyboard.type('Outside');
  expect(await page.locator('#notebook-editor').inputValue()).toContain('\n\nOutside');
});
test.each(['English','العربية'])('native undo and redo preserve typed content: %s',async markdown=>{
  await startEditingAtEnd(markdown);
  await page.keyboard.type(' appended');
  await page.keyboard.press('Meta+z');
  expect((await page.locator('.community-rich-input').innerText()).replace(/\u00a0/g,' ')).toBe(markdown+' appende');
  await page.keyboard.press('Meta+Shift+z');
  expect((await page.locator('.community-rich-input').innerText()).replace(/\u00a0/g,' ')).toBe(markdown+' appended');
});
test('backward selection survives Arabic decoration and replacement',async()=>{
  await startEditingAtEnd('Before');
  const selected=await page.evaluate(()=>{
    const rich=CommunityShortEditor.get(source).rich,p=rich.querySelector('p');p.textContent='English العربية end';
    getSelection().setBaseAndExtent(p.firstChild,15,p.firstChild,8);
    const before=getSelection().toString();CommunityShortEditor.styleContent(rich);
    return {before,after:getSelection().toString(),backward:getSelection().anchorOffset>getSelection().focusOffset};
  });
  expect(selected.after).toBe(selected.before);
  await page.keyboard.type('replacement');
  expect(await page.locator('.community-rich-input').innerText()).toBe('English replacement end');
});
test('Arabic insertion supports native undo and redo',async()=>{
  await startEditingAtEnd('Before');
  await page.keyboard.insertText(' العربية');
  expect(await page.locator('#notebook-editor').inputValue()).toBe('Before العربية');
  await page.keyboard.press('Meta+z');
  expect((await page.locator('.community-rich-input').innerText()).trim()).toBe('Before');
  await page.keyboard.press('Meta+Shift+z');
  expect(await page.locator('#notebook-editor').inputValue()).toBe('Before العربية');
});
test('multiline plain-text paste keeps the caret after pasted Arabic',async()=>{
  await startEditingAtEnd('Before');
  await page.evaluate(()=>{
    const data=new DataTransfer();data.setData('text/plain','\nالعربية\nEnglish');data.setData('text/html','<img src=x onerror=alert(1)>');
    CommunityShortEditor.get(source).rich.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
  });
  await page.keyboard.type(' end');
  expect(await page.locator('.community-rich-input').innerText()).toMatch(/Before\n+العربية\n+English end/);
  expect(await page.locator('.community-rich-input img').count()).toBe(0);
});
test('splitting and rejoining a paragraph retains both halves and the caret',async()=>{
  await startEditingAtEnd('First second');
  for(let i=0;i<6;i++)await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Enter');await page.keyboard.type('New ');
  expect(await page.locator('#notebook-editor').inputValue()).toBe('First \n\nNew second');
  for(let i=0;i<4;i++)await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');await page.keyboard.type('joined ');
  expect(await page.locator('#notebook-editor').inputValue()).toBe('First joined second');
});
test('composition defers decoration until committed and preserves the insertion point',async()=>{
  await startEditingAtEnd('Before');
  await page.evaluate(()=>CommunityShortEditor.get(source).rich.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true})));
  await page.keyboard.insertText(' العربية');
  expect(await page.locator('.community-rich-input .notebook-arabic').count()).toBe(0);
  await page.evaluate(()=>CommunityShortEditor.get(source).rich.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'العربية'})));
  await page.keyboard.type(' after');
  expect(await page.locator('#notebook-editor').inputValue()).toBe('Before العربية after');
});
test.each(['Paragraph','> Quote'])('Enter itself can be undone and redone: %s',async markdown=>{
  await startEditingAtEnd(markdown);
  await page.keyboard.press('Enter');
  const beforeUndo=await page.locator('.community-rich-input').innerHTML();
  await page.keyboard.press('Meta+z');
  expect(await page.locator('.community-rich-input').innerHTML()).not.toBe(beforeUndo);
  await page.keyboard.press('Meta+Shift+z');
  await page.keyboard.type('New');
  expect(await page.locator('#notebook-editor').inputValue()).toContain(markdown.startsWith('>')?'\n> New':'\n\nNew');
});
test.each([390,900])('Enter visibly moves to the next line and typing follows at %s px',async width=>{
  await setup(width);
  await page.evaluate(()=>{
    source.value='> العربية كلمات هنا\n\nEnglish paragraph';edit(true);
    const rich=CommunityShortEditor.get(source).rich;rich.focus();const range=document.createRange();range.selectNodeContents(rich.lastElementChild);range.collapse(false);getSelection().removeAllRanges();getSelection().addRange(range);
  });
  const before=await page.evaluate(()=>getSelection().getRangeAt(0).getBoundingClientRect().top);
  await page.keyboard.press('Enter');await page.keyboard.type('The cursor moved here.');
  const after=await page.evaluate(()=>getSelection().getRangeAt(0).getBoundingClientRect().top);
  expect(after).toBeGreaterThan(before);
  await page.screenshot({path:'/tmp/notebook-enter-fixed-'+width+'.png'});
});
test('forward deletion and keyboard formatting preserve the selected text and caret',async()=>{
  await startEditingAtEnd('First second');
  await page.keyboard.press('ArrowLeft');await page.keyboard.press('Delete');await page.keyboard.type('d');
  expect(await page.locator('#notebook-editor').inputValue()).toBe('First second');
  for(let i=0;i<6;i++)await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.press('Meta+b');
  expect(await page.locator('#notebook-editor').inputValue()).toBe('First **second**');
  await page.keyboard.type('replacement');
  expect(await page.locator('#notebook-editor').inputValue()).toBe('First **replacement**');
});

test.each(['quran:2:255','quran:baqarah:255','quran:al-baqarah:255-256','bukhari:100'])('formatted reference Enter retains rich mode for %s',async ref=>{
 await setup();
 await page.evaluate(text=>{source.value=text;edit(true);window.referenceEvents=[];source.addEventListener('input',e=>{if(e.inputType)referenceEvents.push({type:e.inputType,text:source.value,offset:source.selectionStart});});},ref);
 const rich=page.locator('.community-rich-input');await rich.evaluate(el=>{el.focus();const r=document.createRange();r.selectNodeContents(el);r.collapse(false);const s=window.getSelection();s.removeAllRanges();s.addRange(r);});await page.keyboard.press('Enter');
 const events=await page.evaluate(()=>referenceEvents);
 expect(events).toHaveLength(1);expect(events[0].type).toBe('insertParagraph');expect(events[0].text).toBe(ref+'\n');
 expect(await page.locator('#notebook-editor').isVisible()).toBe(false);
 expect(await rich.isVisible()).toBe(true);
 await page.keyboard.type('Next line');
 expect(await page.locator('#notebook-editor').inputValue()).toContain(ref+'\n\nNext line');
});
test('nested heading folds preserve Markdown and work in preview',async()=>{
 await setup();await page.addStyleTag({path:'public/static/css/markdown-content.css'});
 const text='# First\n\nFirst body\n\n## Child\n\nChild body\n\n# Next\n\nNext body';
 await page.evaluate(text=>{source.value=text;edit(true);},text);
 const rich=page.locator('.community-rich-input');
 await rich.getByRole('button',{name:'Collapse Child',exact:true}).click();
 await rich.getByRole('button',{name:'Collapse First',exact:true}).click();
 expect(await rich.getByText('First body',{exact:true}).isVisible()).toBe(false);
 expect(await rich.getByText('Next body',{exact:true}).isVisible()).toBe(true);
 await rich.getByRole('button',{name:'Expand First',exact:true}).click();
 expect(await rich.getByText('First body',{exact:true}).isVisible()).toBe(true);
 expect(await rich.getByText('Child body',{exact:true}).isVisible()).toBe(false);
 expect(await page.evaluate(()=>CommunityShortEditor.serialize(CommunityShortEditor.get(source).rich))).toBe(text);
 await page.evaluate(()=>{preview.innerHTML='<h1>Preview section</h1><p>Preview body</p><h1>Next</h1><p>Visible</p>';edit(false);});
 await page.locator('#notebook-preview').getByRole('button',{name:'Collapse Preview section',exact:true}).click();
 expect(await page.getByText('Preview body',{exact:true}).isVisible()).toBe(false);
 await page.screenshot({path:'/tmp/notebook-fold-preview.png'});
});
test.each([390,900])('private blocks remain grey and round trip at %i px',async width=>{
 await setup(width);await page.addStyleTag({path:'public/static/css/markdown-content.css'});
 const text='# Public heading\n\nPublic text\n\n%%\nPrivate reminder\nAnother private line\n%%\n\nPublic ending';
 await page.evaluate(text=>{source.value=text;edit(true);},text);
 expect(await page.locator('.community-rich-input [data-note-hidden]').innerText()).toBe('Private reminder\nAnother private line');
 expect(await page.evaluate(()=>CommunityShortEditor.serialize(CommunityShortEditor.get(source).rich))).toBe(text);
 await page.screenshot({path:`/tmp/notebook-hidden-edit-${width}.png`});
});
test('Quran alias expansion updates the formatted draft and leaves the caret editable',async()=>{
 await setup();
 const script=fs.readFileSync('public/static/js/notebook.js','utf8');
 const functions=['scheduleReferenceExpansion','autoExpandReferences'].map(name=>script.match(new RegExp(`  (?:async )?function ${name}\\([^]*?\\n  }`))[0]).join('\n');
 await page.evaluate(functions=>{
  source.value='quran:baqarah:255';edit(true);
  const editor=source,current={},busy=false,locked=false,editing=true,generation=1,composingReference=false;
  let referenceEpoch=0,referenceTimer=null;
  const api=async()=>({edits:[{start:0,end:17,text:'\n\n> Arabic verse\n> Translation\n\n'}]}),scheduleSave=()=>{};
  eval(functions+'\n editor.addEventListener("input",scheduleReferenceExpansion);');
 },functions);
 const rich=page.locator('.community-rich-input');
 await rich.evaluate(el=>{el.focus();const r=document.createRange();r.selectNodeContents(el);r.collapse(false);const s=window.getSelection();s.removeAllRanges();s.addRange(r);});
 await page.keyboard.press('Enter');
 await page.waitForFunction(()=>document.querySelector('.community-rich-input').textContent.includes('Translation'));
 expect(await page.locator('#notebook-editor').isVisible()).toBe(false);
 await page.keyboard.type(' More notes');
 expect(await page.locator('#notebook-editor').inputValue()).toContain('More notes');
});
test('one-line hidden comments retain their syntax through formatted editing',async()=>{
 await setup();await page.addStyleTag({path:'public/static/css/markdown-content.css'});
 const text='Before\n\n%% Private quran:baqarah:255 \\{draft\\} %%\n\nAfter';
 await page.evaluate(text=>{source.value=text;edit(true);},text);
 const comment=page.locator('.community-rich-input [data-note-hidden]');
 expect(await comment.textContent()).toBe('Private quran:baqarah:255 {draft}');
 expect(await page.evaluate(()=>CommunityShortEditor.serialize(CommunityShortEditor.get(source).rich))).toBe(text);
 await comment.evaluate(el=>{el.focus();const range=document.createRange();range.selectNodeContents(el);range.collapse(false);const s=window.getSelection();s.removeAllRanges();s.addRange(range);});
 await page.keyboard.type(' edited');
 expect(await page.locator('#notebook-editor').inputValue()).toContain('%% Private quran:baqarah:255 \\{draft\\} edited %%');
 await page.screenshot({path:'/tmp/notebook-single-hidden.png'});
});
test('hidden formatted headings, lists and emphasis survive editing and Markdown round trips',async()=>{
 await setup();await page.addStyleTag({path:'public/static/css/markdown-content.css'});
 const text='Before\n\n%%\n## Private heading\n\n**Bold** and *italic*\n\n- First\n- Second\n\n> Quotation\n%%\n\n%% **One-line bold** %%\n\nAfter';
 await page.evaluate(text=>{source.value=text;edit(true);},text);
 const hidden=page.locator('.community-rich-input [data-note-hidden]').first();
 expect(await hidden.locator('h2').textContent()).toBe('Private heading');
 expect(await hidden.locator('strong').textContent()).toBe('Bold');
 expect(await hidden.locator('li').count()).toBe(2);
 expect(await hidden.locator('blockquote').textContent()).toBe('Quotation');
 expect(await page.evaluate(()=>CommunityShortEditor.serialize(CommunityShortEditor.get(source).rich))).toBe(text);
 await hidden.locator('li').last().evaluate(el=>{const r=document.createRange();r.selectNodeContents(el);r.collapse(false);const s=window.getSelection();s.removeAllRanges();s.addRange(r);el.closest('[contenteditable=true]').focus();});
 await page.keyboard.type(' edited');
 expect(await page.locator('#notebook-editor').inputValue()).toContain('- Second edited');
 await page.screenshot({path:'/tmp/notebook-hidden-formatting.png'});
 await page.evaluate(()=>{const surface=CommunityShortEditor.get(source);surface.toSource();surface.toFormatted();});
 expect(await hidden.locator('li').last().textContent()).toBe('Second edited');
 expect(await page.locator('.community-rich-input [data-note-hidden]').last().locator('strong').textContent()).toBe('One-line bold');
});
test('private footnotes stay within their hidden block after formatted editing',async()=>{
 await setup();
 const text='Public\n\n%%\nPrivate text[^p]\n\n[^p]: Private footnote\n%%\n\nAfter';
 await page.evaluate(text=>{source.value=text;edit(true);},text);
 const rich=page.locator('.community-rich-input');
 expect(await rich.locator('[data-note-hidden] [data-footnote]').count()).toBe(1);
 expect(await rich.locator(':scope > [data-footnote]').count()).toBe(0);
 const markdown=await page.evaluate(()=>CommunityShortEditor.serialize(CommunityShortEditor.get(source).rich));
 expect(markdown).toBe(text);
});
test.each(['First paragraph','# Heading','- List item'])('two blank lines after %s survive formatted editing',async first=>{
 await setup();await page.addStyleTag({path:'public/static/css/markdown-content.css'});
 const text=first+'\n\n\nNext paragraph';
 await page.evaluate(text=>{source.value=text;edit(true);},text);
 const spacer=page.locator('.community-rich-input [data-markdown-spacer]');
 expect(await spacer.count()).toBe(1);
 expect((await spacer.boundingBox()).height).toBeGreaterThan(20);
 expect(await page.evaluate(()=>CommunityShortEditor.serialize(CommunityShortEditor.get(source).rich))).toBe(text);
 await page.evaluate(()=>{const surface=CommunityShortEditor.get(source);surface.toSource();surface.toFormatted();});
 expect(await spacer.count()).toBe(1);
 await page.screenshot({path:'/tmp/notebook-extra-spacing.png'});
});
