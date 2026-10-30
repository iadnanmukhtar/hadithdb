'use strict';
const fs=require('fs');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync('public/static/js/community-short-editor.js','utf8');
const marked=require('marked');
function setup(markdown='') {
 const dom=new JSDOM('<form><textarea data-short-editor required maxlength="10000" aria-label="Post text"></textarea><button type="submit">Post</button></form>',{url:'https://hadith.example',runScripts:'outside-only'});
 const w=dom.window;w.marked=marked;w.eval(fs.readFileSync('public/static/js/notebook-shortcuts.js','utf8'));w.eval(fs.readFileSync('public/static/js/community-parallel-text.js','utf8'));const input=w.document.querySelector('textarea');input.value=markdown;w.eval(source);
 return {dom,w,input,rich:w.document.querySelector('.community-rich-input')};
}
test.each([
 '__underline__ and ==highlight==', 'Term\n: Definition', '- [x] Task',
 '# Heading {#custom}',
 '<span dir="rtl">العربية</span>', '[[bukhari:1]]', '```js\nconst x=1;\n```',
 '| A | B |\n|---|---|\n| 1 | 2 |', ':smile:', '![Image](/community/media/test)',
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
test.each(['rich','source'])('double-click opens formatting after native word selection in %s mode',async mode=>{
 const {w,input,rich}=setup(mode==='source'?'Reflection\n\n__underline__':'A reflection');try{
  const surface=mode==='source'?input:rich;surface.focus();
  surface.dispatchEvent(new w.MouseEvent('dblclick',{bubbles:true}));
  if(mode==='source')input.setSelectionRange(0,10);
  else {const range=w.document.createRange();range.selectNodeContents(rich.firstChild);w.getSelection().removeAllRanges();w.getSelection().addRange(range);}
  await new Promise(resolve=>w.setTimeout(resolve,5));
  expect(w.document.querySelector('.community-selection-tools').hidden).toBe(false);
 }finally{w.close();}
});
test('posts containing extended Markdown still offer selection formatting without rewriting other content',()=>{
 const original='Reflection\n\nEnglish || العربية\n\n__underline__';
 const {dom,w,input}=setup(original);try{
  input.focus();input.setSelectionRange(0,10);input.dispatchEvent(new w.Event('select'));
  const toolbar=w.document.querySelector('.community-selection-tools');expect(toolbar.hidden).toBe(false);
  toolbar.querySelector('[data-command="bold"]').click();
  expect(input.value).toBe('**Reflection**'+original.slice(10));
  input.setSelectionRange(0,0);input.dispatchEvent(new w.Event('select'));expect(toolbar.hidden).toBe(true);
 }finally{w.close();}
});
test('parallel text opens in formatted mode and untouched submission preserves exact source',()=>{
 const original='Introduction\n\n**دعاء**\nTranslation\n\n"Peace" ||أَلَا بِذِكْرِ ٱللَّهِ\n\nhttps://example.test/reference\n';
 const {w,input,rich}=setup(original);try{
  expect(input.hidden).toBe(true);expect(rich.querySelectorAll('.community-edit-parallel-cell')).toHaveLength(2);
  expect(rich.querySelectorAll('.community-edit-parallel-cell')[1].textContent).toBe('أَلَا بِذِكْرِ ٱللَّهِ');
  input.form.dispatchEvent(new w.Event('submit',{cancelable:true}));expect(input.value).toBe(original);
 }finally{w.close();}
});
test('editing one column survives serialization and reopening with inline formatting and other rows',()=>{
 const {w,input,rich}=setup('Before\n\n**Mercy** || الرحمة\n\nSecond || ثان\n\nAfter');try{
  rich.querySelector('.community-edit-parallel-cell').innerHTML='<p><strong>Kindness</strong> and <em>mercy</em></p>';
  rich.dispatchEvent(new w.Event('input'));
  expect(input.value).toBe('Before\n\n**Kindness** and *mercy* || الرحمة\n\nSecond || ثان\n\nAfter');
  const reopened=w.CommunityShortEditor.render(input.value);
  expect(reopened.querySelectorAll('.community-edit-parallel')).toHaveLength(2);
  expect(reopened.querySelector('strong').textContent).toBe('Kindness');
 }finally{w.close();}
});
test('escaped pipes and code-span pipes remain literal rather than creating columns',()=>{
 const {w,rich}=setup('Literal \\|\\| text and `a||b`');try{expect(rich.querySelector('.community-edit-parallel')).toBeNull();}finally{w.close();}
});
test('parallel rows coexist with the source fallback for unsupported extended syntax',()=>{
 const original='English || العربية\n\n__underline__';const {w,input}=setup(original);try{expect(input.hidden).toBe(false);expect(input.value).toBe(original);}finally{w.close();}
});
test('Enter moves between columns and exits the row without corrupting parallel syntax',()=>{
 const {w,input,rich}=setup('English || العربية');try{
  rich.focus();const range=w.document.createRange();range.selectNodeContents(rich.querySelector('.community-edit-parallel-cell'));range.collapse(false);w.getSelection().removeAllRanges();w.getSelection().addRange(range);
  rich.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
  expect(w.getSelection().anchorNode.closest?.('.community-edit-parallel-cell') || w.getSelection().anchorNode.parentElement.closest('.community-edit-parallel-cell')).toBe(rich.querySelector('.community-edit-parallel').lastElementChild);
  rich.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
  expect(rich.lastElementChild.tagName).toBe('P');expect(input.value).toBe('English || العربية');
 }finally{w.close();}
});
test.each(['English || العربية','Before\n\nEnglish || العربية\n\nAfter'])('remove column layout preserves both columns in order: %s',text=>{
 const {w,input,rich}=setup(text);try{
  rich.focus();const range=w.document.createRange();range.selectNodeContents(rich.querySelector('.community-edit-parallel-cell'));range.collapse(true);w.getSelection().removeAllRanges();w.getSelection().addRange(range);w.document.dispatchEvent(new w.Event('selectionchange'));
  const remove=w.document.querySelector('.community-remove-columns');expect(remove.hidden).toBe(false);remove.click();
  expect(rich.querySelector('.community-edit-parallel')).toBeNull();expect(input.hidden).toBe(true);
  expect(input.value).toBe(text.replace(' || ','\n\n'));expect(remove.hidden).toBe(true);
  w.document.querySelectorAll('.community-remove-columns')[1].click();expect(input.value).toBe(text);expect(rich.querySelectorAll('.community-edit-parallel')).toHaveLength(1);
 }finally{w.close();}
});
test.each([['- Item','- Item\n- '],['3. Item','3. Item\n4. '],['> Quote','> Quote\n> '],['- [x] Task','- [x] Task\n- [ ] ']])('Markdown Enter continues and then exits an empty item: %s',(text,continued)=>{
 const {w,input}=setup(text);try{
  if(input.hidden)w.document.querySelector('[aria-label="Switch to Markdown editing"]').click();input.focus();input.setSelectionRange(text.length,text.length);
  input.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));expect(input.value).toBe(continued);
  input.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));expect(input.value).toBe(text+'\n');
 }finally{w.close();}
});
test('empty formatted quote paragraph exits the quote and retains subsequent paragraphs',()=>{
 const {w,input,rich}=setup('> First');try{
  rich.innerHTML='<blockquote><p>First</p><p><br></p><p>Later quote</p></blockquote><p>After</p>';
  const empty=rich.querySelectorAll('blockquote p')[1],range=w.document.createRange();range.selectNodeContents(empty);range.collapse(true);rich.focus();w.getSelection().removeAllRanges();w.getSelection().addRange(range);
  rich.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
  expect(Array.from(rich.children,el=>el.tagName)).toEqual(['BLOCKQUOTE','P','BLOCKQUOTE','P']);
  expect(w.getSelection().anchorNode.closest('blockquote')).toBeNull();expect(input.value).toContain('Later quote');expect(input.value).toContain('After');
 }finally{w.close();}
});
test('Enter continues a formatted quote as the next line without a blank quote line',()=>{
 const {w,input,rich}=setup('> First');try{
  rich.focus();const range=w.document.createRange();range.selectNodeContents(rich.querySelector('blockquote p'));range.collapse(false);w.getSelection().removeAllRanges();w.getSelection().addRange(range);
  rich.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
  const next=rich.querySelector('blockquote').lastElementChild;next.textContent='Second';rich.dispatchEvent(new w.Event('input'));
  expect(rich.querySelectorAll('blockquote')).toHaveLength(1);expect(input.value).toBe('> First\n> Second');
 }finally{w.close();}
});
test('center and highlight reopen formatted and preserve their Markdown storage',()=>{
 const original='<center>\n==English== and العربية\n</center>';
 const {w,input,rich}=setup(original);try{
  expect(input.hidden).toBe(true);expect(rich.querySelector('center mark').textContent).toBe('English');
  rich.querySelector('mark').textContent='Updated';rich.dispatchEvent(new w.Event('input'));
  expect(input.value).toBe('<center>\n==Updated== and العربية\n</center>');
 }finally{w.close();}
});
test('center control puts opening and closing tags on their own lines',()=>{
 const {w,input,rich}=setup('Before\n\nCenter this\n\nAfter');try{
  rich.focus();const range=w.document.createRange();range.selectNodeContents(rich.children[1]);w.getSelection().removeAllRanges();w.getSelection().addRange(range);w.document.dispatchEvent(new w.Event('selectionchange'));
  w.document.querySelector('[data-command=center]').click();
  expect(input.hidden).toBe(true);expect(input.value).toBe('Before\n\n<center>\nCenter this\n</center>\n\nAfter');
 }finally{w.close();}
});

 test.each(['2','subtext','0'])('shared text style %s replaces the previous block style',style=>{
 const {w,input,rich}=setup('# A reflection');try{
 rich.focus();const range=w.document.createRange();range.selectNodeContents(rich.firstChild);w.getSelection().removeAllRanges();w.getSelection().addRange(range);w.document.dispatchEvent(new w.Event('selectionchange'));
 const menu=w.document.querySelector('.community-selection-tools select');menu.value=style;menu.dispatchEvent(new w.Event('change'));
 expect(input.value).toBe((style==='subtext'?'-# ':style==='0'?'':'## ')+'A reflection');expect(input.hidden).toBe(true);
 if(style==='subtext')expect(rich.querySelector('.notebook-subtext').textContent).toBe('A reflection');
 }finally{w.close();}
 });

test.each(['---','***','___'])('ordinary %s dividers stay in formatted mode and survive editing',divider=>{
 const {w,input,rich}=setup('Introduction\n\n'+divider+'\n\n# Key Takeaways\n\n- First point');try{
 expect(input.hidden).toBe(true);expect(rich.querySelectorAll('hr')).toHaveLength(1);
 rich.querySelector('h1').textContent='Takeaways';rich.dispatchEvent(new w.Event('input'));
 expect(input.value).toContain('Introduction\n\n***\n\n# Takeaways');expect(input.value).toContain('- First point');
 }finally{w.close();}
});

test('footnotes reopen as editable text, preserving multiline definitions and repeated markers',()=>{
 const original='First[^note] and again[^note].\n\n[^note]: A **bold** note\n\n    Second paragraph.';
 const {w,input,rich}=setup(original);try{
 expect(input.hidden).toBe(true);expect(input.value).toBe(original);expect(rich.querySelectorAll('[data-footnote-ref]')).toHaveLength(2);
 const body=rich.querySelector('.community-footnote-body');expect(body.querySelector('strong').textContent).toBe('bold');expect(body.querySelectorAll('p')).toHaveLength(2);
 body.querySelector('strong').textContent='changed';rich.dispatchEvent(new w.Event('input'));
 expect(input.value).toContain('[^note]: A **changed** note\n    \n    Second paragraph.');
 }finally{w.close();}
});
test('removing the last marker preserves its text as an orphan paragraph; restoring a marker reconnects it',()=>{
 const {w,input,rich}=setup('First[^1] and again[^1].\n\n[^1]: Keep this **note**.');try{
 const markers=[...rich.querySelectorAll('[data-footnote-ref]')];markers[0].remove();rich.dispatchEvent(new w.Event('input'));expect(input.value).toContain('[^1]:');
 markers[1].remove();rich.dispatchEvent(new w.Event('input'));expect(input.value).toContain('Orphaned footnote (1): Keep this **note**.');expect(input.value).not.toContain('[^1]:');expect(rich.querySelector('.community-orphan-footnote')).not.toBeNull();
 rich.firstChild.append(markers[0]);rich.dispatchEvent(new w.Event('input'));expect(input.value).toContain('[^1]: Keep this **note**.');expect(rich.querySelector('.community-orphan-footnote')).toBeNull();
 }finally{w.close();}
});
test('inserting a footnote creates a unique marker and selects editable placeholder text',()=>{
 const {w,input,rich}=setup('First[^1].\n\n[^1]: Existing note');try{
 rich.focus();const range=w.document.createRange();range.setStart(rich.firstChild.firstChild,5);range.collapse(true);w.getSelection().removeAllRanges();w.getSelection().addRange(range);w.document.dispatchEvent(new w.Event('selectionchange'));
 w.CommunityShortEditor.get(input).format('footnote');expect(input.hidden).toBe(true);expect(input.value).toContain('[^2]');expect(input.value).toContain('[^2]: Footnote text');expect(w.getSelection().toString()).toBe('Footnote text');
 }finally{w.close();}
});
test('missing definitions get editable placeholders and divider insertion stays formatted',()=>{
 const {w,input,rich}=setup('First[^missing]');try{
 expect(input.hidden).toBe(true);expect(rich.querySelector('.community-footnote-body').textContent).toBe('Footnote text');
 rich.focus();const range=w.document.createRange();range.selectNodeContents(rich.firstChild);range.collapse(false);w.getSelection().removeAllRanges();w.getSelection().addRange(range);w.document.dispatchEvent(new w.Event('selectionchange'));
 w.CommunityShortEditor.get(input).format('divider');expect(input.hidden).toBe(true);expect(rich.querySelector('hr')).not.toBeNull();
 }finally{w.close();}
});

test('a divider inserted into an empty article does not become frontmatter on reopen',()=>{
 const {w,input,rich}=setup('');try{
 w.CommunityShortEditor.get(input).format('divider');expect(input.hidden).toBe(true);rich.dispatchEvent(new w.Event('input'));
 expect(w.CommunityShortEditor.render(input.value).querySelector('hr')).not.toBeNull();
 }finally{w.close();}
});
test('orphan definitions are visible and remain ordinary paragraphs after saving and reopening',()=>{
 const {w,input,rich}=setup('A reflection\n\n[^old]: Preserve **this** note.');try{
 expect(input.hidden).toBe(true);expect(rich.querySelector('.community-orphan-footnote')).not.toBeNull();
 rich.firstChild.textContent='An edited reflection';rich.dispatchEvent(new w.Event('input'));
 expect(input.value).toContain('Orphaned footnote (old): Preserve **this** note.');
 const reopened=w.CommunityShortEditor.render(input.value);expect(reopened.querySelector('[data-footnote]')).toBeNull();expect(reopened.textContent).toContain('Orphaned footnote (old)');
 }finally{w.close();}
});

test('subscript and superscript render and serialize alongside strike and footnotes',()=>{
 const {w,input,rich}=setup('H~2~O x^2^ ~~old~~ note[^1]\n\n[^1]: A reference');try{
 expect(input.hidden).toBe(true);expect(rich.querySelector('sub').textContent).toBe('2');expect(rich.querySelector('sup:not([data-footnote-ref])').textContent).toBe('2');expect(rich.querySelector('s').textContent).toBe('old');
 rich.querySelector('sub').textContent='3';rich.dispatchEvent(new w.Event('input'));expect(input.value).toContain('H~3~O x^2^ ~~old~~ note[^1]');
 }finally{w.close();}
});
test.each(['subscript','superscript'])('%s control uses native formatted editing and preserves escaped spaces in Markdown',command=>{
 const {w,input,rich}=setup('A reflection');try{
 rich.focus();const range=w.document.createRange();range.selectNodeContents(rich.firstChild);w.getSelection().removeAllRanges();w.getSelection().addRange(range);w.document.dispatchEvent(new w.Event('selectionchange'));w.document.execCommand=jest.fn(()=>true);
 w.CommunityShortEditor.get(input).format(command);expect(w.document.execCommand).toHaveBeenCalledWith(command,false,undefined);
 w.CommunityShortEditor.get(input).toSource();input.focus();input.setSelectionRange(0,input.value.length);w.CommunityShortEditor.get(input).format(command);
 const marker=command==='subscript'?'~':'^';expect(input.value).toBe(marker+'A\\ reflection'+marker);expect(w.CommunityShortEditor.render(input.value).textContent).toBe('A reflection');
 }finally{w.close();}
});

test('text-style menu follows the caret in headings, subtext, and normal rich paragraphs',()=>{
 const {w,rich}=setup('# Title\n\n### Section\n\n-# Small text\n\nNormal text');try{
 const menu=w.document.querySelector('.community-selection-tools select');rich.focus();
 for(const [selector,value] of [['h1','1'],['h3','3'],['.notebook-subtext','subtext'],['p:last-child','0']]){
 const range=w.document.createRange();range.selectNodeContents(rich.querySelector(selector));range.collapse(true);w.getSelection().removeAllRanges();w.getSelection().addRange(range);w.document.dispatchEvent(new w.Event('selectionchange'));expect(menu.value).toBe(value);
 }
 }finally{w.close();}
});
test('Markdown style follows the caret, including headings, subtext and fenced-code exclusions',()=>{
 const text='# Title\n\n-# Small\n\nPlain __underline__\n\n```\n## code\n```';const {w,input}=setup(text);try{
 const menu=w.document.querySelector('.community-selection-tools select');input.focus();
 for(const [needle,value] of [['Title','1'],['Small','subtext'],['Plain','0'],['code','0']]){
 const at=text.indexOf(needle);input.setSelectionRange(at,at);input.dispatchEvent(new w.Event('keyup'));expect(menu.value).toBe(value);
 }
 }finally{w.close();}
});
