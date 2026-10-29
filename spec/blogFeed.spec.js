'use strict';
const fs=require('fs'),ejs=require('ejs'),{JSDOM}=require('jsdom');
const BlogFeed=require('../lib/BlogFeed');
const post={postId:7,title:'A </script><script>unsafe()</script> title',subtitle:'Reflection',html:'<p>English and العربية</p><img src="/sample.jpg">',cover:'/cover.jpg',published:new Date('2026-10-29T12:00:00Z'),file:'example',authorName:'Amina',authorHandle:'amina'};
async function render(){
 global.settings={blog:{url:'https://example.test'}};
 return ejs.renderFile('views/blog.ejs',{feedItems:[BlogFeed.item(post)],req:{url:'/blog'},utils:{staticAssetUrl:p=>p}},{includer:(original,parsed)=>/head.ejs|header.ejs|footer.ejs|scripts.ejs|mobile_navigation/.test(original)?{template:' '}:{filename:parsed}});
}
const settle=async()=>{for(let n=0;n<12;n++)await new Promise(setImmediate);};
test('blog items preserve canonical URLs, public author, media and legacy thread identity',()=>{
 const item=BlogFeed.item(post);
 expect(item).toMatchObject({id:7,url:'/blog/example',blogCommentSlug:'example',kind:'article',publicationDate:'2026-10-29',author:{name:'Amina',handle:'amina'}});
 expect(item.mediaHtml).toContain('/sample.jpg');expect(item.excerpt).toContain('English and العربية');
 expect(BlogFeed.item({...post,file:undefined,url:'/community/p/canonical'})).toMatchObject({url:'/community/p/canonical',blogCommentSlug:null});
});
test('server blog cards escape embedded JSON and reuse the contributor rail',async()=>{
 const dom=new JSDOM(await render());try{
 const doc=dom.window.document;
 expect(JSON.parse(doc.querySelector('[data-blog-feed-item]').textContent).title).toBe(post.title);
 expect(doc.querySelectorAll('script:not([src])')).toHaveLength(1);
 expect(doc.querySelector('.community-rail-slot #community-contributors')).not.toBeNull();
 expect(doc.querySelector('.community-entry-title').textContent).toBe(post.title);
 }finally{dom.window.close();}
});
test('blog hydration, appended pages and replies use shared feed behavior and the existing blog thread',async()=>{
 const dom=new JSDOM(await render(),{url:'https://example.test/blog',runScripts:'outside-only'}),w=dom.window,calls=[];
 try{
 w.quranApiPath=p=>'/api'+p;w.hadithAuth={getToken:async()=>null};
 w.fetch=async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>url.includes('contributors')?{contributors:[]}:url.includes('blog-feed-state')?{items:[{id:7,commentCount:1}]}:url.includes('blog-comments')?[{id:22,user:{name:'Yusuf'},html:'<p>Existing reflection</p>'}]:{}};};
 w.eval(fs.readFileSync('public/static/js/community.js','utf8'));await settle();
 expect(w.document.querySelector('#community-status').textContent).toBe('');
 expect(w.document.querySelectorAll('.community-inline-discussion')).toHaveLength(1);
 w.document.querySelector('.community-reply').click();await settle();
 expect(w.document.querySelector('.community-thread-reply').textContent).toContain('Existing reflection');
 expect(calls.some(c=>c.url==='/api/blog-comments/example')).toBe(true);
 expect(calls.some(c=>c.url.includes('/discussion/post/'))).toBe(false);
 w.hadithAuth.getToken=async()=> 'sample-token';
 w.document.querySelector('.community-thread-reply .community-reply').click();
 w.document.querySelector('.community-inline-reply textarea').value='English || العربية';
 w.document.querySelector('.community-inline-reply').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await settle();
 const submitted=calls.find(c=>c.url==='/api/blog-comments/example' && c.options.method==='POST');
 expect(JSON.parse(submitted.options.body)).toEqual({text:'English || العربية',parentId:22});
 const wrapper=w.document.querySelector('[data-blog-feed-entry]').cloneNode(true);delete wrapper.dataset.blogHydrated;
 w.document.querySelector('[data-blog-infinite]').append(wrapper);await settle();
 expect(wrapper.querySelectorAll('.community-inline-discussion')).toHaveLength(1);
 expect(wrapper.dataset.blogHydrated).toBe('1');
 }finally{w.close();}
});
test('state decoration retains blog comment counts after shared reaction decoration',async()=>{
 const C=require('../lib/Community'),Likes=require('../lib/CommunityLikes'),Interactions=require('../lib/CommunityInteractions');
 const spies=[jest.spyOn(C,'ensure').mockResolvedValue(),jest.spyOn(C,'sql').mockResolvedValue([{id:7,commentCount:8}]),jest.spyOn(Likes,'decorate').mockResolvedValue(),jest.spyOn(Interactions,'decorate').mockImplementation(async(q,items)=>{items[0].commentCount=0;})];
 try{expect(await BlogFeed.states([7])).toEqual([expect.objectContaining({id:7,commentCount:8})]);expect(C.sql.mock.calls[0][0]).toContain("p.status='published'");}finally{spies.forEach(s=>s.mockRestore());}
});
test('blog cards without a cover use Pearls of the Deep without changing an explicit cover',()=>{
 for(const cover of [undefined,null,'','   '])expect(BlogFeed.item({...post,cover}).coverUrl).toBe('/static/img/pearls_of_the_deep.jpg');
 expect(BlogFeed.item({...post,cover:'/chosen.jpg'}).coverUrl).toBe('/chosen.jpg');
});
test('imported blog articles receive the same fallback in the Community feed',async()=>{
 const C=require('../lib/Community'),Import=require('../lib/CommunityBlogImport');
 const query=jest.spyOn(C,'sql').mockResolvedValue([{post_id:7,slug:'example',attributes_json:JSON.stringify({title:post.title})}]);
 try{
  const item={id:7,activity:'post',kind:'article',title:post.title,coverUrl:null,mediaHtml:''};
  await Import.decorate([item]);
  expect(item.coverUrl).toBe('/static/img/pearls_of_the_deep.jpg');
  expect(item.mediaHtml).toContain('/static/img/pearls_of_the_deep.jpg');
  expect(item.url).toBe('/blog/example');
 }finally{query.mockRestore();}
});
