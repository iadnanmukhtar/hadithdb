'use strict';
const fs=require('fs');
const {JSDOM}=require('jsdom');
const marked=require('marked');
const helper=fs.readFileSync('public/static/js/community-parallel-text.js','utf8');
const short=fs.readFileSync('public/static/js/community-short-editor.js','utf8');
const article=fs.readFileSync('public/static/js/community-formatting.js','utf8');
function setup(html){const dom=new JSDOM(html,{url:'https://example.test',runScripts:'outside-only'});dom.window.eval(helper);return dom;}
test.each([
 ['',0,'English text here || نص عربي هنا'],
 ['First\nCurrent line\nLast',9,'Current line || نص عربي هنا'],
 ['\nLast',0,'English text here || نص عربي هنا'],
 ['First\n',6,'English text here || نص عربي هنا'],
 ['**Current**',4,'**Current** || نص عربي هنا'],
 ['`a||b`',2,'`a||b` || نص عربي هنا'],
 ['Existing || العربية',2,'Existing || العربية']
])('inserts or selects parallel columns on the current line: %s', (value,position,text)=>{
 const dom=setup('');try{const edit=dom.window.CommunityParallelText.replacement(value,position);expect(edit.text).toBe(text);
 if(!value.includes('Existing'))expect((value.slice(0,edit.start)+edit.text+value.slice(edit.end)).slice(edit.selectStart,edit.selectEnd)).toBe('نص عربي هنا');
 }finally{dom.window.close();}
});
test('article toolbar preserves surrounding lines and selects the Arabic sample',()=>{
 const dom=setup('<div id="community-format-toolbar"><select id="community-format-style"></select><button data-format="parallel"></button></div><textarea id="community-markdown"></textarea>');
 try{const w=dom.window,e=w.document.querySelector('textarea');w.document.execCommand=()=>false;w.eval(article);e.value='Before\nEnglish line\nAfter';e.setSelectionRange(10,10);w.document.querySelector('button').click();expect(e.value).toBe('Before\nEnglish line || نص عربي هنا\nAfter');expect(e.value.slice(e.selectionStart,e.selectionEnd)).toBe('نص عربي هنا');}finally{dom.window.close();}
});
test.each(['','First paragraph\n\nCurrent paragraph'])('contextual control handles empty and nonempty current paragraphs: %s',markdown=>{
 const dom=setup('<form><textarea data-short-editor></textarea></form>');try{
 const w=dom.window;w.marked=marked;const e=w.document.querySelector('textarea');e.value=markdown;w.eval(short);
 const rich=w.document.querySelector('.community-rich-input'),range=w.document.createRange();range.selectNodeContents(rich);range.collapse(false);w.getSelection().removeAllRanges();w.getSelection().addRange(range);rich.focus();w.document.dispatchEvent(new w.Event('selectionchange'));
 const b=w.document.querySelector('[data-command="parallel"]');expect(b.textContent).toBe('a|ج');expect(b.hidden).toBe(false);b.click();
 expect(e.hidden).toBe(true);expect(e.value).toBe(markdown?markdown+' || نص عربي هنا':'English text here || نص عربي هنا');expect(w.getSelection().toString()).toBe('نص عربي هنا');expect(rich.querySelectorAll('.community-edit-parallel-cell')).toHaveLength(2);
 }finally{dom.window.close();}
});
test('source-mode control preserves advanced formatting on other lines',()=>{
 const dom=setup('<textarea data-short-editor></textarea>');try{const w=dom.window;w.marked=marked;const e=w.document.querySelector('textarea');e.value='==Highlight==\nCurrent\n__Underline__';w.eval(short);e.focus();e.setSelectionRange(14,21);e.dispatchEvent(new w.Event('select'));w.document.querySelector('.community-selection-tools [data-command=parallel]').click();expect(e.value).toBe('==Highlight==\nCurrent || نص عربي هنا\n__Underline__');}finally{dom.window.close();}
});
