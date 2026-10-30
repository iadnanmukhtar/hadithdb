'use strict';
const fs=require('fs'),{JSDOM}=require('jsdom'),marked=require('marked');
function setup(markdown='') {
 const dom=new JSDOM('<form><div id="community-format-toolbar"><select id="community-format-style"><option value="0">Normal</option><option value="2">H2</option><option value="subtext">Subtext</option></select><button type="button" data-format="bold"></button><button type="button" data-format="highlight"></button><button type="button" data-format="underline"></button><button type="button" data-format="center"></button><button type="button" data-format="divider"></button><button type="button" data-format="footnote"></button><button type="button" data-format="parallel"></button></div><textarea id="community-markdown" data-short-editor data-article-editor required></textarea></form>',{url:'https://example.test',runScripts:'outside-only'});
 const w=dom.window;w.marked=marked;w.document.querySelector('textarea').value=markdown;
 for(const script of ['notebook-shortcuts','community-parallel-text','community-short-editor','community-formatting'])w.eval(fs.readFileSync('public/static/js/'+script+'.js','utf8'));
 const source=w.document.querySelector('textarea'),rich=w.document.querySelector('.community-rich-input');
 function select(text){const walk=w.document.createTreeWalker(rich,w.NodeFilter.SHOW_TEXT);let node;while((node=walk.nextNode()))if(node.textContent.includes(text)){const range=w.document.createRange(),index=node.textContent.indexOf(text);range.setStart(node,index);range.setEnd(node,index+text.length);rich.focus();w.getSelection().removeAllRanges();w.getSelection().addRange(range);w.document.dispatchEvent(new w.Event('selectionchange'));return;}}
 return {dom,w,source,rich,select};
}
test('article toolbar formats the live rich selection and remains present',()=>{
 const {dom,w,select}=setup('First paragraph\n\nSecond paragraph');try{select('Second');w.document.execCommand=jest.fn(()=>true);w.document.querySelector('[data-format=bold]').click();expect(w.document.execCommand).toHaveBeenCalledWith('bold',false,undefined);expect(w.getSelection().toString()).toBe('Second');expect(w.document.querySelector('#community-format-toolbar').hidden).toBe(false);}finally{dom.window.close();}
});
test('extended article toolbar formatting preserves selection, surrounding text and Markdown',()=>{
 const {dom,w,source,select}=setup('First paragraph\n\nSecond paragraph');try{select('Second');w.document.execCommand=()=>false;w.document.querySelector('[data-format=underline]').click();expect(source.hidden).toBe(false);expect(source.value).toBe('First paragraph\n\n__Second__ paragraph');expect(source.value.slice(source.selectionStart,source.selectionEnd)).toBe('Second');}finally{dom.window.close();}
});
test('article rich input updates the same source consumed by autosave without replacing its live nodes',()=>{
 const {dom,w,source,rich}=setup();try{const listener=jest.fn();source.addEventListener('input',listener);rich.innerHTML='<p>Hello <strong>العربية</strong></p>';const p=rich.firstChild;rich.dispatchEvent(new w.Event('input'));expect(source.value).toBe('Hello **العربية**');expect(listener).toHaveBeenCalledTimes(1);expect(rich.firstChild).toBe(p);}finally{dom.window.close();}
});
test('article advanced syntax opens unchanged and retains the formatting bar',()=>{
 const original='English || العربية\n\n__underline__ [^n]\n\n[^n]: Note';const {dom,w,source}=setup(original);try{expect(source.hidden).toBe(false);expect(source.value).toBe(original);expect(w.document.querySelector('#community-format-toolbar')).not.toBeNull();}finally{dom.window.close();}
});
test('bare source reference Enter reaches the existing reference-expansion listener',()=>{
 const {dom,w,source,rich,select}=setup('quran:2:255');try{
 select('quran:2:255');w.getSelection().collapseToEnd();w.document.dispatchEvent(new w.Event('selectionchange'));
 const input=jest.fn();source.addEventListener('input',input);
 rich.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
 expect(source.value).toBe('quran:2:255\n');expect(input.mock.calls[0][0].inputType).toBe('insertParagraph');expect(source.selectionStart).toBe(source.value.length);
 }finally{dom.window.close();}
});
test('article toolbar uses shared formatted columns, deletion and undo with the autosave source',()=>{
 const {dom,w,source,rich,select}=setup('Before\n\nEnglish\n\nAfter');try{
  const changed=jest.fn();source.addEventListener('input',changed);
  select('English');w.document.querySelector('[data-format=parallel]').click();
  expect(source.hidden).toBe(true);expect(source.value).toBe('Before\n\nEnglish || نص عربي هنا\n\nAfter');
  expect(rich.querySelectorAll('.community-edit-parallel-cell')).toHaveLength(2);
  expect(w.getSelection().toString()).toBe('نص عربي هنا');
  const remove=w.document.querySelector('.community-remove-columns');expect(remove.hidden).toBe(false);remove.click();
  expect(source.value).toBe('Before\n\nEnglish\n\nنص عربي هنا\n\nAfter');expect(source.hidden).toBe(true);
  w.document.querySelectorAll('.community-remove-columns')[1].click();
  expect(source.value).toBe('Before\n\nEnglish || نص عربي هنا\n\nAfter');
  expect(w.document.querySelector('#community-format-toolbar').hidden).toBe(false);expect(changed).toHaveBeenCalled();
 }finally{dom.window.close();}
});
test('existing article columns reopen formatted without changing their original Markdown',()=>{
 const original='Before\n\n**English** ||العربية\n\nAfter\n';const {dom,w,source,rich}=setup(original);try{
  expect(source.hidden).toBe(true);expect(rich.querySelectorAll('.community-edit-parallel-cell')).toHaveLength(2);
  source.form.dispatchEvent(new w.Event('submit',{cancelable:true}));expect(source.value).toBe(original);
 }finally{dom.window.close();}
});

test('article heading menu applies subtext through the shared formatted editor',()=>{
 const {dom,w,source,rich,select}=setup('A reflection');try{
 select('A reflection');const menu=w.document.querySelector('#community-format-style');menu.value='subtext';menu.dispatchEvent(new w.Event('change'));
 expect(source.value).toBe('-# A reflection');expect(source.hidden).toBe(true);expect(rich.querySelector('.notebook-subtext').textContent).toBe('A reflection');
 }finally{dom.window.close();}
});

test('article selections keep contextual controls hidden and preserve permanent toolbar formatting',()=>{
 const {dom,w,source,select}=setup('A reflection');try{
 select('reflection');expect(w.document.querySelector('.community-selection-tools').hidden).toBe(true);
 w.document.execCommand=jest.fn(()=>true);w.document.querySelector('[data-format=bold]').click();expect(w.document.execCommand).toHaveBeenCalledWith('bold',false,undefined);
 w.CommunityShortEditor.get(source).toSource();source.focus();source.setSelectionRange(0,3);source.dispatchEvent(new w.Event('select'));
 expect(w.document.querySelector('.community-selection-tools').hidden).toBe(true);expect(w.document.querySelector('#community-format-toolbar').hidden).toBe(false);
 }finally{dom.window.close();}
});

test('article toolbar inserts a divider and an editable footnote without leaving formatted mode',()=>{
 const {dom,w,source,rich,select}=setup('A reflection');try{
 select('A reflection');w.document.querySelector('[data-format=divider]').click();expect(source.hidden).toBe(true);expect(rich.querySelector('hr')).not.toBeNull();
 select('reflection');w.document.querySelector('[data-format=footnote]').click();expect(source.hidden).toBe(true);expect(source.value).toContain('reflection[^1]');expect(rich.querySelector('.community-footnote-body').textContent).toBe('Footnote text');
 }finally{dom.window.close();}
});
test('article source-mode footnote insertion preserves unsupported Markdown',()=>{
 const {dom,w,source}=setup('__Underline__ and a note');try{
 source.focus();source.setSelectionRange(23,23);w.document.querySelector('[data-format=footnote]').click();
 expect(source.hidden).toBe(false);expect(source.value).toContain('__Underline__');expect(source.value).toContain('[^1]: Footnote text');expect(source.value.slice(source.selectionStart,source.selectionEnd)).toBe('Footnote text');
 }finally{dom.window.close();}
});

test('permanent article text-style menu follows rich and Markdown caret positions',()=>{
 const {dom,w,source,select}=setup('## Heading\n\nNormal');try{
 const menu=w.document.querySelector('#community-format-style');select('Heading');expect(menu.value).toBe('2');select('Normal');expect(menu.value).toBe('0');
 w.CommunityShortEditor.get(source).toSource();source.focus();source.setSelectionRange(4,4);source.dispatchEvent(new w.Event('keyup'));expect(menu.value).toBe('2');
 source.setSelectionRange(source.value.length,source.value.length);source.dispatchEvent(new w.Event('keyup'));expect(menu.value).toBe('0');
 }finally{dom.window.close();}
});
