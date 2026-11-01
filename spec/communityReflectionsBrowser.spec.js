'use strict';
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const { JSDOM } = require('jsdom');
const source=fs.readFileSync(path.join(__dirname,'../public/static/js/community.js'),'utf8');
const settle=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};
const author={handle:'writer',name:'Writer',photo:'https://example.test/avatar.png'};
const comments=[{id:2,parentId:1,author:{...author,name:'قارئ'},html:'<p dir="rtl">تأمل عربي</p>',createdAt:'2026-10-26T12:01:00Z',likeCount:2,liked:true},
 {id:1,parentId:null,author,html:'<p>First reflection</p>',createdAt:'2026-10-26T12:00:00Z',canDelete:true}];

test.each(['note','article'])('%s detail actions and reflections retain permissions and interactions',async kind=>{
  const html=await ejs.renderFile(path.join(__dirname,'../views/sub-views/community_reflections.ejs'),{post:{kind}});
  const postActions=await ejs.renderFile(path.join(__dirname,'../views/sub-views/community_post_actions.ejs'),{post:{id:1945,kind,url:'/community/p/test',author}});
  const rail=kind==='article'?await ejs.renderFile(path.join(__dirname,'../views/sub-views/community_rail.ejs')):'';
  const dom=new JSDOM(`<a id="community-moderation-link" hidden></a><main id="community" data-view="post" data-post="1945" data-author="writer"><p id="community-status"></p><div id="community-follow-controls"><button id="community-follow"></button></div><div id="community-blog-control"><input id="community-blog-toggle" data-kind="note"></div>${postActions}${html}${kind==='article'?'<div data-article-body><h2>Article heading</h2></div>':''}${rail}</main>`,{url:'http://localhost:3004/community/@writer/1945#comment-2',runScripts:'outside-only',pretendToBeVisual:true});
  try {
    const w=dom.window;w.HTMLElement.prototype.scrollIntoView=jest.fn();w.quranApiPath=url=>'/api'+url;
    w.hadithAuth={getToken:jest.fn(async()=> 'alice')};
    w.fetch=jest.fn(async(url,opts)=>({ok:true,json:async()=>url.endsWith('/me')?{author,admin:false}:url.endsWith('/comments')?{comments}:url.endsWith('/posts/1945')?{post:{id:1945,kind,likeId:1945,likeSource:'post',likeCount:3,liked:true}}:url.includes('/votes/post/1945')?{likeCount:2,liked:false}: {}}));
    if(kind==='article'){
      w.eval(fs.readFileSync(path.join(__dirname,'../public/static/js/community-article-toc.js'),'utf8'));
      expect(w.document.querySelector('#community-user-search-open')).toBeNull();
      expect(w.document.querySelector('#community-user-search-dialog')).not.toBeNull();
    }
    w.eval(source);await settle();
    const d=w.document;
    const actions=d.querySelector('#community-post-actions');
    expect([...actions.querySelectorAll('i')].map(el=>el.className)).toEqual(['bi bi-heart-fill','bi bi-hand-thumbs-down','bi bi-chat-right-text','bi bi-repeat','bi bi-share','bi bi-three-dots','bi bi-printer','bi bi-pencil','bi bi-flag']);
    expect(actions.querySelector('.community-reply').title).toBe('Reply');
    expect(actions.querySelector('[data-community-share-url]').getAttribute('aria-label')).toBe('Share');
    expect(actions.lastElementChild.matches('.community-post-menu')).toBe(true);
    expect(actions.querySelector('#community-edit-post').hidden).toBe(false);
    actions.querySelector('.community-like').click();await settle();
    expect(w.fetch.mock.calls.some(([url,options])=>url.endsWith('/votes/post/1945') && JSON.parse(options.body).direction===null)).toBe(true);
    expect(actions.querySelector('.community-like').getAttribute('aria-pressed')).toBe('false');
    d.querySelector('.reflection-disclosure').open=false;
    actions.querySelector('.community-reply').click();await settle();
    expect(d.activeElement.id).toBe('community-comment-text');
    expect(d.querySelector('.reflection-disclosure').open).toBe(true);
    expect(d.querySelector('#community-comments-count').textContent).toBe('2');
    expect(d.querySelector('#community-comment-form [type=submit]').textContent.trim()).toBe('Post');
    expect(d.querySelector('#comment-2 .comment-vote').textContent.trim()).toBe('2');
    expect(d.querySelector('#comment-2 .comment-reply .bi').className).toBe('bi bi-chat-right-text');
    expect(d.querySelector('#comment-2 .comment-vote').getAttribute('aria-label')).toBe('Undo like');
    expect([...d.querySelectorAll('.comment-thread-item')].map(el=>el.id)).toEqual(['comment-1','comment-2']);
    expect(d.querySelector('#comment-2').style.getPropertyValue('--comment-depth')).toBe('1');
    expect(d.querySelector('#comment-2 .comment-text').dir).toBe('auto');
    expect(d.querySelector('#comment-2 .comment-text [dir="rtl"]').textContent).toBe('تأمل عربي');
    expect(d.querySelectorAll('.comment-delete')).toHaveLength(1);
    expect(d.querySelector('#community-comment-text').disabled).toBe(false);
    d.querySelector('#comment-2 .comment-reply').click();await settle();
    expect(d.querySelector('#community-reply-target').textContent).toBe('Replying to قارئ');
    d.querySelector('#community-comment-text').value='My test reply';
    d.querySelector('#community-comment-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await settle();
    const posted=w.fetch.mock.calls.find(([,options])=>options.method==='POST');
    expect(JSON.parse(posted[1].body)).toEqual({markdown:'My test reply',parentId:2});
    w.hadithAuth.getToken.mockResolvedValue(null);d.dispatchEvent(new w.CustomEvent('hadithAuthChanged'));await settle();
    expect(d.querySelector('#community-edit-post').hidden).toBe(true);
    expect(d.querySelectorAll('#community-post-actions .community-post-menu')).toHaveLength(1);
    expect(d.querySelector('#community-comment-text').disabled).toBe(true);
    expect(d.querySelector('#community-comment-hint').hidden).toBe(false);
    expect(d.querySelector('#community-comment-user').hidden).toBe(true);
    expect(d.querySelectorAll('#community-post-actions .community-reply')).toHaveLength(1);
    expect(d.querySelectorAll('#community-post-actions [data-community-share-url]')).toHaveLength(1);
  } finally {dom.window.close();}
});
