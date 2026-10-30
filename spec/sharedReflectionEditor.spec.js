'use strict';
const fs = require('fs');
const ejs = require('ejs');
const {JSDOM} = require('jsdom');
const marked = require('marked');
async function setup() {
 const html = await ejs.renderFile('views/sub-views/comment_widget.ejs', {widgetId:'test-comments',targetId:42,lazyLoad:false});
 const dom = new JSDOM(html,{url:'https://hadith.example',runScripts:'outside-only'}), w=dom.window;
 w.marked=marked; w.HTMLElement.prototype.scrollIntoView=()=>{};
 w.hadithAuth={getUser:async()=>({displayName:'Amina',providerData:[{providerId:'fixture'}],getIdToken:async()=> 'fixture'}),getToken:async()=> 'fixture'};
 const markdown='__Keep underline__\n\nEnglish || العربية';
 const comment={id:7,text:markdown,html:'<p>Parent reflection</p>',user:{name:'Yusuf'},ts:new Date().toISOString(),canEdit:true,upVote:2,downVote:1};
 w.fetch=jest.fn(async(url,opts)=>({ok:true,json:async()=>opts?.method==='POST'?{...comment,id:8}: [comment]}));
 for(const file of ['community-reply-context','community-parallel-text','community-short-editor']) w.eval(fs.readFileSync('public/static/js/'+file+'.js','utf8'));
 w.eval(w.document.querySelector('script').textContent);
 for(let i=0;i<30 && !w.document.querySelector('#test-comments').dataset.commentWidgetLoaded;i++) await new Promise(resolve=>setImmediate(resolve));
 return {dom,w,markdown,input:w.document.querySelector('textarea')};
}
test('shared reflection reply carries parent context and cancel preserves the draft',async()=>{
 const {dom,w,input}=await setup();try {
 input.value='Draft reply';w.document.querySelector('.comment-reply').click();
 expect(w.document.querySelector('#test-comments-parent').value).toBe('7');
 expect(w.document.querySelector('#test-comments-reply-context').textContent).toContain('YusufParent reflection');
 expect(w.document.querySelector('.community-rich-input')).not.toBeNull();
 w.document.querySelector('#test-comments-cancel-reply').click();
 expect(input.value).toBe('Draft reply');expect(w.document.querySelector('#test-comments-parent').value).toBe('');
 expect(w.document.querySelector('#test-comments-reply-context').hidden).toBe(true);
 }finally{dom.window.close();}
});
test('editing a reflection retains extended Markdown and uses a plain Save control',async()=>{
 const {dom,w,input,markdown}=await setup();try {
 w.document.querySelector('.comment-edit').click();
 expect(input.value).toBe(markdown);expect(input.hidden).toBe(false);
 expect(w.document.querySelector('[type=submit]').textContent).toBe('Save');
 expect(w.document.querySelector('.comment-vote .bi').className).toContain('bi-heart');
 }finally{dom.window.close();}
});
test('reply context treats author and excerpt as text and rejects unsafe photo URLs',async()=>{
 const {dom,w}=await setup();try {
 const context=w.document.querySelector('#test-comments-reply-context');
 w.CommunityReplyContext.show(context,{name:'<b>Name</b>',photo:'javascript:alert(1)'},'<p>Safe <strong>excerpt</strong></p>');
 expect(context.querySelector('img')).toBeNull();expect(context.querySelector('b')).toBeNull();
 expect(context.textContent).toContain('<b>Name</b>Safe excerpt');
 }finally{dom.window.close();}
});

test('reader reflections use inline reaction counts and the common quiet composer',async()=>{
 const {dom,w,input}=await setup();try {
 expect(w.document.querySelector('.comment-reactions-badge')).toBeNull();
 expect(w.document.querySelector('.comment-reply .bi').className).toBe('bi bi-chat-right-text');
 expect(w.document.querySelector('[data-direction="down"]').getAttribute('aria-label')).toBe('Dislike');
 expect(w.document.querySelector('[data-direction="up"]').textContent.trim()).toBe('2');
 expect(w.document.querySelector('[data-direction="down"]').textContent.trim()).toBe('1');
 expect(w.document.querySelector('#test-comments-user').textContent).toBe('Posting as Amina');
 expect(w.document.querySelector('.comment-provider-chip')).toBeNull();
 expect(input.placeholder).toBe('Write a reflection…');
 expect(w.document.querySelector('[type="submit"]').textContent).toBe('Post');
 }finally{dom.window.close();}
});
