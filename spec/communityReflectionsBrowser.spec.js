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

test('post reflections use shared disclosure/composer and retain nested replies, anchors, permissions, and RTL',async()=>{
  const html=await ejs.renderFile(path.join(__dirname,'../views/sub-views/community_reflections.ejs'),{post:{kind:'note'}});
  const dom=new JSDOM(`<a id="community-moderation-link" hidden></a><main id="community" data-view="post" data-post="1945" data-author="writer"><p id="community-status"></p><div id="community-follow-controls"><button id="community-follow"></button></div><div id="community-blog-control"><input id="community-blog-toggle" data-kind="note"></div><div id="community-post-actions"><button data-community-share-url="/community/p/test"><i class="bi bi-share"></i></button><a id="community-edit-post"><i class="bi bi-pencil"></i></a></div>${html}</main>`,{url:'http://localhost:3004/community/@writer/1945#comment-2',runScripts:'outside-only',pretendToBeVisual:true});
  try {
    const w=dom.window;w.HTMLElement.prototype.scrollIntoView=jest.fn();w.quranApiPath=url=>'/api'+url;
    w.hadithAuth={getToken:jest.fn(async()=> 'alice')};
    w.fetch=jest.fn(async(url,opts)=>({ok:true,json:async()=>url.endsWith('/me')?{author,admin:false}:url.endsWith('/comments')?{comments}:url.endsWith('/posts/1945')?{post:{id:1945,likeId:1945,likeSource:'post',likeCount:3,liked:true}}:url.includes('/votes/post/1945')?{likeCount:2,liked:false}: {}}));
    w.eval(source);await settle();
    const d=w.document;
    const actions=d.querySelector('#community-post-actions');
    expect([...actions.querySelectorAll('i')].map(el=>el.className)).toEqual(['bi bi-heart-fill','bi bi-hand-thumbs-down','bi bi-chat-right-text','bi bi-repeat','bi bi-share','bi bi-pencil']);
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
    expect(d.querySelector('#community-comment-text').disabled).toBe(true);
    expect(d.querySelector('#community-comment-hint').hidden).toBe(false);
    expect(d.querySelector('#community-comment-user').hidden).toBe(true);
    expect(d.querySelectorAll('#community-post-actions .community-reply')).toHaveLength(1);
    expect(d.querySelectorAll('#community-post-actions [data-community-share-url]')).toHaveLength(1);
  } finally {dom.window.close();}
});
