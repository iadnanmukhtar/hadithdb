'use strict';
const fs=require('fs'),{JSDOM}=require('jsdom'),marked=require('marked');
function setup(markdown='') {
 const dom=new JSDOM('<form><div id="community-format-toolbar"><select id="community-format-style"><option value="0">Normal</option><option value="2">H2</option></select><button type="button" data-format="bold"></button><button type="button" data-format="highlight"></button><button type="button" data-format="parallel"></button></div><textarea id="community-markdown" data-short-editor data-article-editor required></textarea></form>',{url:'https://example.test',runScripts:'outside-only'});
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
 const {dom,w,source,select}=setup('First paragraph\n\nSecond paragraph');try{select('Second');w.document.execCommand=()=>false;w.document.querySelector('[data-format=highlight]').click();expect(source.hidden).toBe(false);expect(source.value).toBe('First paragraph\n\n==Second== paragraph');expect(source.value.slice(source.selectionStart,source.selectionEnd)).toBe('Second');}finally{dom.window.close();}
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
