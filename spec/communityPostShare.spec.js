'use strict';
const fs=require('fs'),path=require('path'),ejs=require('ejs'),{JSDOM}=require('jsdom');
const settle=async()=>{for(let i=0;i<6;i++)await new Promise(resolve=>setImmediate(resolve));};
async function fixture(fetch){
  const html=await ejs.renderFile(path.join(__dirname,'../views/sub-views/community_share_composer.ejs'));
  const dom=new JSDOM('<dialog id="content-share-pane" open></dialog>'+html,{url:'https://hadithunlocked.com/bukhari:1',runScripts:'outside-only'}),w=dom.window;
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
  w.quranApiPath=p=>'/api'+p;w.fetch=fetch;w.hadithAuth={getToken:jest.fn(async()=> 'token'),requireToken:jest.fn(async()=>null)};
  w.eval(fs.readFileSync(path.join(__dirname,'../public/static/js/community-post-share.js'),'utf8'));
  return {dom,w,d:w.document,open:(title='Bukhari 1',url='https://hadithunlocked.com/bukhari:1')=>w.CommunityPostShare.open({title,url,description:'Selected source text'})};
}
test('opens immediately on the current page with a source card while profile and preview requests are still pending',async()=>{
 const fetch=jest.fn(()=>new Promise(()=>{}));const {dom,w,d,open}=await fixture(fetch);
 try{
  const before=w.location.href;open();
  expect(d.getElementById('community-share-dialog').open).toBe(true);
  expect(d.getElementById('content-share-pane').open).toBe(false);
  expect(d.querySelector('.community-link-card strong').textContent).toBe('Bukhari 1');
  expect(d.querySelector('.community-link-copy > span').textContent).toBe('Selected source text');
  expect(d.getElementById('community-share-text').disabled).toBe(false);
  expect(d.querySelector('.community-link-card img').getAttribute('src')).toBe('/static/img/apple-touch-icon.png');
  expect(d.querySelector('.community-link-card img').loading).toBe('eager');
  expect(w.location.href).toBe(before);
  expect(fetch.mock.calls.some(([url])=>url.includes('/link-preview?'))).toBe(true);
  d.getElementById('community-share-text').value='My reflection';
  await settle();expect(d.getElementById('community-share-text').value).toBe('My reflection');
 }finally{dom.window.close();}
});
test('publishes edited text and the source URL once, without navigating or waiting for preview metadata',async()=>{
 let resolvePost;
 const fetch=jest.fn((url,options)=> url.endsWith('/posts') ? new Promise(resolve=>{resolvePost=()=>resolve({ok:true,json:async()=>({post:{id:42,status:'published',url:'/community/@reader/42'}})});}) : new Promise(()=>{}));
 const {dom,w,d,open}=await fixture(fetch);
 try{
  const before=w.location.href;open();await settle();
  d.getElementById('community-share-text').value='My edited reflection';
  const submit=()=>d.getElementById('community-share-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  submit();submit();await settle();
  const writes=fetch.mock.calls.filter(([url])=>url.endsWith('/posts'));
  expect(writes).toHaveLength(1);
  expect(JSON.parse(writes[0][1].body)).toMatchObject({kind:'note',action:'publish',notifyEmail:false,markdown:'My edited reflection\n\nhttps://hadithunlocked.com/bukhari:1'});
  resolvePost();await settle();
  expect(d.getElementById('community-share-status').textContent).toContain('published');
  expect(d.getElementById('community-share-post').disabled).toBe(true);
  expect(w.location.href).toBe(before);
 }finally{dom.window.close();}
});
test('keeps edited text and source preview after a posting error',async()=>{
 const fetch=jest.fn(async(url)=>({ok:!url.endsWith('/posts'),json:async()=>url.endsWith('/posts')?{error:'Please try again'}:{title:'Bukhari 1',author:{name:'Reader',handle:'reader'}}}));
 const {dom,w,d,open}=await fixture(fetch);
 try{
  open();await settle();d.getElementById('community-share-text').value='Keep this text';
  d.getElementById('community-share-form').dispatchEvent(new w.Event('submit',{cancelable:true}));await settle();
  expect(d.getElementById('community-share-text').value).toBe('Keep this text');
  expect(d.querySelector('.community-link-card')).not.toBeNull();
  expect(d.getElementById('community-share-status').textContent).toBe('Please try again');
  expect(d.getElementById('community-share-post').disabled).toBe(false);
 }finally{dom.window.close();}
});
test('ignores an old preview response after a different source is selected',async()=>{
 const resolvers=[];
 const fetch=jest.fn(url=>url.includes('/link-preview?')?new Promise(resolve=>resolvers.push(resolve)):new Promise(()=>{}));
 const {dom,d,open}=await fixture(fetch);
 try{
  open();open('Baqarah 2:255','https://quranunlocked.com/quran/2:255');
  resolvers[1]({ok:true,json:async()=>({title:'Current ayah',description:'Current text'})});await settle();
  resolvers[0]({ok:true,json:async()=>({title:'Old hadith',description:'Old text'})});await settle();
  expect(d.querySelector('.community-link-card strong').textContent).toBe('Current ayah');
  expect(d.querySelector('.community-link-card').href).toBe('https://quranunlocked.com/quran/2:255');
 }finally{dom.window.close();}
});

test('first-party source links retain useful metadata when Open Graph fetching fails',async()=>{
 const cache=jest.spyOn(require('../lib/Community'),'ensure').mockRejectedValue(Error('Offline'));
 const fetchSource=jest.spyOn(require('../lib/CommunityMedia'),'fetchHtml').mockRejectedValue(Error('Offline'));
 const previous={settings:global.settings,books:global.books,surahs:global.surahs};
 global.settings={site:{url:'https://hadithunlocked.com',quranUrl:'https://quranunlocked.com'}};
 global.books=[{alias:'bukhari',shortName_en:'Sahih al-Bukhari'}];global.surahs=[{num:2,name_en:'Baqarah'}];
 try{
  const Media=require('../lib/CommunityMedia');
  expect(await Media.preview('http://localhost:3004/bukhari:1',true)).toMatchObject({title:'Sahih al-Bukhari 1'});
  expect(await Media.preview('https://quranunlocked.com/quran/2:255-257')).toMatchObject({title:'Baqarah 2:255-257'});
  const $=require('cheerio').load('<p><a href="http://localhost:3004/bukhari:1">Source</a></p>',null,false);
  Media.placeholders($);expect($('.community-link-preview')).toHaveLength(1);
  expect(require('../lib/CommunitySourcePreview').preview('https://evil.example/bukhari:1')).toBeNull();
  expect(require('../lib/CommunitySourcePreview').preview('http://localhost:3004/admin')).toBeNull();
 }finally{cache.mockRestore();fetchSource.mockRestore();Object.assign(global,previous);}
});

test('keeps an unsigned draft through sign-in and requires another explicit Post click',async()=>{
 const fetch=jest.fn(()=>new Promise(()=>{}));const {dom,w,d,open}=await fixture(fetch);
 try{
  w.hadithAuth.getToken.mockResolvedValue(null);open();await settle();
  d.getElementById('community-share-text').value='My unsigned draft';
  d.getElementById('community-share-form').dispatchEvent(new w.Event('submit',{cancelable:true}));await settle();
  expect(w.hadithAuth.requireToken).toHaveBeenCalled();
  expect(fetch.mock.calls.some(([url])=>url.endsWith('/posts'))).toBe(false);
  w.hadithAuth.getToken.mockResolvedValue('token');
  d.dispatchEvent(new w.CustomEvent('hadithAuthChanged',{detail:{user:{uid:'reader'}}}));await settle();
  expect(d.getElementById('community-share-dialog').open).toBe(true);
  expect(d.getElementById('community-share-text').value).toBe('My unsigned draft');
  expect(fetch.mock.calls.some(([url])=>url.endsWith('/posts'))).toBe(false);
 }finally{dom.window.close();}
});

test('Quran icon starts before metadata and the same image stays mounted after enrichment',async()=>{
 let resolvePreview;
 const fetch=jest.fn(url=>url.includes('/link-preview?')?new Promise(resolve=>{resolvePreview=resolve;}):new Promise(()=>{}));
 const {dom,d,open}=await fixture(fetch);
 try{
  open('Al-Qasas 28:24','https://quran.islamunlocked.com/quran:28:24');
  const icon=d.querySelector('.community-link-card img');
  expect(icon.getAttribute('src')).toBe('/static/img/quran-apple-touch-icon.png');
  resolvePreview({ok:true,json:async()=>({title:'Al-Qasas 28:24',description:'Translation',image:'/static/img/quran-apple-touch-icon.png',imageKind:'icon',source:true})});
  await settle();
  expect(d.querySelector('.community-link-card img')).toBe(icon);
  expect(d.querySelector('.community-link-copy > span').textContent).toBe('Translation');
 }finally{dom.window.close();}
});

test('prefills bilingual text and preserves edits when reopening the same item',async()=>{
 const {dom,w,d}=await fixture(jest.fn(()=>new Promise(()=>{})));
 try{
  const source={url:'/bukhari:2',title:'Bukhari 2',text:'نَصٌّ عربي\n\nEnglish text'};
  w.CommunityPostShare.open(source);
  const editor=d.getElementById('community-share-text');
  expect(editor.value).toBe(source.text);
  editor.value='Edited Arabic and English';
  d.getElementById('community-share-dialog').close();
  w.CommunityPostShare.open(source);
  expect(editor.value).toBe('Edited Arabic and English');
  w.CommunityPostShare.open({...source,url:'/bukhari:3',text:'النص التالي\n\nNext text'});
  expect(editor.value).toBe('النص التالي\n\nNext text');
 }finally{dom.window.close();}
});

test('late metadata cannot replace the small brand thumbnail or expand the composer card',async()=>{
 let resolvePreview;
 const fetch=jest.fn(url=>url.includes('/link-preview?')?new Promise(resolve=>{resolvePreview=resolve;}):new Promise(()=>{}));
 const {dom,d,open}=await fixture(fetch);
 try{
  open('Advice to Abu Hurayrah','https://hadithunlocked.com/bukhari:1178');
  const icon=d.querySelector('.community-link-card img');
  resolvePreview({ok:true,json:async()=>({title:'Bukhari 1178',description:'Updated excerpt',image:'https://hadithunlocked.com/large-logo.png',imageKind:'image',source:true})});
  await settle();
  expect(d.querySelector('.community-link-card img')).toBe(icon);
  expect(icon.getAttribute('src')).toBe('/static/img/apple-touch-icon.png');
  expect(d.querySelector('.community-source-preview')).toBeNull();
  expect(d.querySelector('.community-link-card strong').textContent).toBe('Bukhari 1178');
 }finally{dom.window.close();}
});
