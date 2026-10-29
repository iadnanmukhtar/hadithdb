'use strict';
const fs=require('fs');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync('public/static/js/community-short-editor.js','utf8');
const marked=require('marked');
function setup(markdown='') {
 const dom=new JSDOM('<form><textarea data-short-editor required maxlength="10000" aria-label="Post text"></textarea><button type="submit">Post</button></form>',{url:'https://hadith.example',runScripts:'outside-only'});
 const w=dom.window;w.marked=marked;const input=w.document.querySelector('textarea');input.value=markdown;w.eval(source);
 return {dom,w,input,rich:w.document.querySelector('.community-rich-input')};
}
test.each([
 '__underline__ and ==highlight==', 'Arabic || English', 'Term\n: Definition', '- [x] Task',
 'H~2~O and x^2^', '[^note]\n\n[^note]: Footnote', '# Heading {#custom}',
 '<span dir="rtl">العربية</span>', '[[bukhari:1]]', '```js\nconst x=1;\n```',
 '| A | B |\n|---|---|\n| 1 | 2 |', '-# Subtext', ':smile:', '![Image](/community/media/test)',
 '[Reference][id]\n\n[id]: https://example.org', '---\ntitle: Metadata\n---\nBody'
])('retains extended Markdown byte-for-byte through input, mode toggle and submission: %s',markdown=>{
 const {dom,w,input,rich}=setup(markdown);
 try {
  expect(input.hidden).toBe(false);expect(rich.hidden).toBe(true);
  w.document.querySelector('.community-editor-mode').click();expect(input.hidden).toBe(false);
  input.form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));expect(input.value).toBe(markdown);
 }finally{dom.window.close();}
});
test('does not rewrite untouched ordinary Markdown when opening or submitting',()=>{
 const markdown='**Bold**  \n\nعربي & English\n';const {dom,w,input}=setup(markdown);
 try {input.form.dispatchEvent(new w.Event('submit',{cancelable:true}));expect(input.value).toBe(markdown);}finally{dom.window.close();}
});
test('formats new input, emits one input event and preserves the live rich DOM',()=>{
 const {dom,w,input,rich}=setup();try{
  const changed=jest.fn();input.addEventListener('input',changed);
  rich.innerHTML='<p><strong>Mercy</strong> and <em>رحمة</em></p><blockquote><p>A quote</p></blockquote>';
  const strong=rich.querySelector('strong');rich.dispatchEvent(new w.Event('input'));
  expect(input.value).toBe('**Mercy** and *رحمة*\n\n> A quote');expect(changed).toHaveBeenCalledTimes(1);
  expect(rich.querySelector('strong')).toBe(strong);
 }finally{dom.window.close();}
});
test('programmatic source updates preserve unsupported content and reset clears the editor',async()=>{
 const {dom,w,input,rich}=setup();try{
  input.value='__Existing underline__';expect(input.hidden).toBe(false);expect(input.value).toBe('__Existing underline__');
  input.form.reset();await Promise.resolve();expect(input.hidden).toBe(true);expect(rich.textContent).toBe('');
 }finally{dom.window.close();}
});
test('untrusted HTML and unsafe links never enter the rich DOM',()=>{
 for(const text of ['<img src=x onerror=alert(1)>','[bad](javascript:alert%281%29)']){
  const {dom,input,rich}=setup(text);try{expect(input.hidden).toBe(false);expect(rich.querySelector('img,a')).toBeNull();expect(input.value).toBe(text);}finally{dom.window.close();}
 }
});
test('blank and over-limit rich posts cannot submit',()=>{
 const {dom,w,input,rich}=setup();try{
  expect(input.form.dispatchEvent(new w.Event('submit',{cancelable:true}))).toBe(false);
  input.maxLength=5;rich.textContent='Too many characters';rich.dispatchEvent(new w.Event('input'));
  expect(input.form.dispatchEvent(new w.Event('submit',{cancelable:true}))).toBe(false);
 }finally{dom.window.close();}
});
test('native contenteditable Enter keeps separate paragraphs in stored Markdown',()=>{
 const {dom,w,input,rich}=setup();try{
  rich.innerHTML='English first<div>الحمد لله</div><div>Third line</div>';rich.dispatchEvent(new w.Event('input'));
  expect(input.value).toBe('English first\n\nالحمد لله\n\nThird line');
 }finally{dom.window.close();}
});
test('editing a nested list preserves its child list and ordered start number',()=>{
 const {dom,w,input,rich}=setup('3. Parent\n   - Child');try{
  rich.querySelector('li').prepend(w.document.createTextNode('Edited '));rich.dispatchEvent(new w.Event('input'));
  const rendered=w.CommunityShortEditor.render(input.value);
  expect(rendered.querySelector('ol').start).toBe(3);
  expect(rendered.querySelector('ol > li > ul > li').textContent).toBe('Child');
 }finally{dom.window.close();}
});
test('post toolbar including parallel text appears only for selected rich text',()=>{
 const {dom,w,rich}=setup('A reflection');try{
  rich.focus();const range=w.document.createRange();range.selectNodeContents(rich.firstChild);range.collapse(true);
  w.getSelection().removeAllRanges();w.getSelection().addRange(range);w.document.dispatchEvent(new w.Event('selectionchange'));
  const toolbar=w.document.querySelector('.community-selection-tools');expect(toolbar.hidden).toBe(true);
  expect(w.document.querySelector('.community-short-tools .community-parallel-icon')).toBeNull();
  range.selectNodeContents(rich.firstChild);w.getSelection().removeAllRanges();w.getSelection().addRange(range);w.document.dispatchEvent(new w.Event('selectionchange'));
  expect(toolbar.hidden).toBe(false);expect(toolbar.querySelector('[data-command="parallel"]').hidden).toBe(false);
  w.getSelection().collapseToEnd();w.document.dispatchEvent(new w.Event('selectionchange'));expect(toolbar.hidden).toBe(true);
 }finally{w.close();}
});
test('posts containing extended Markdown still offer selection formatting without rewriting other content',()=>{
 const original='Reflection\n\nEnglish || العربية\n\n[^n]: Note';
 const {dom,w,input}=setup(original);try{
  input.focus();input.setSelectionRange(0,10);input.dispatchEvent(new w.Event('select'));
  const toolbar=w.document.querySelector('.community-selection-tools');expect(toolbar.hidden).toBe(false);
  toolbar.querySelector('[data-command="bold"]').click();
  expect(input.value).toBe('**Reflection**'+original.slice(10));
  input.setSelectionRange(0,0);input.dispatchEvent(new w.Event('select'));expect(toolbar.hidden).toBe(true);
 }finally{w.close();}
});
