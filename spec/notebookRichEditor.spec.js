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
  const markup = (await ejs.renderFile(require.resolve('../views/sub-views/notebook_modal.ejs'), { utils: { scriptAssetVersion: () => 'test' } })).replace(/<script[^]*?<\/script>/g, '');
  await page.setContent('<style>[hidden]{display:none!important} #notebook-surface{height:550px;display:flex;flex-direction:column} .modal-header,.modal-footer{display:none}</style>' + markup);
  await page.locator('#notebook-modal').evaluate(node => node.setAttribute('aria-hidden', 'false'));
  await page.addStyleTag({ path: 'public/static/css/community.css' });
  await page.addStyleTag({ content: await page.locator('style').allTextContents().then(styles => styles.join('\n')) });
  await page.addScriptTag({ content: fs.readFileSync('node_modules/marked/lib/marked.umd.js','utf8') });
  for (const file of ['notebook-shortcuts','notebook-wiki','community-parallel-text','community-short-editor','community-formatting','notebook-rich-editor']) await page.addScriptTag({ path: 'public/static/js/'+file+'.js' });
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
  await page.waitForFunction(() => document.querySelector('.notebook-advanced-block')?.textContent === 'Rendered advanced block');
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
    const r=document.createRange();r.setStart(el.firstChild,5);r.setEnd(el.firstChild,6);const b=r.getBoundingClientRect();
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
    return {direction:getComputedStyle(line).direction,textLeft:rect.left,textTop:rect.top,left:box.left};
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
