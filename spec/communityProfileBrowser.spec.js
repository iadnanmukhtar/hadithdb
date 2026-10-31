'use strict';
const fs=require('fs'),path=require('path'),ejs=require('ejs'),{JSDOM}=require('jsdom');
const settle=async()=>{for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));};
test('profile shell reveals data only after authorized fetch and clears it on sign-out',async()=>{
 const oldSettings=global.settings;global.settings={site:{}};
 let html;
 try {html=ejs.render(fs.readFileSync('views/community.ejs','utf8'),{
  view:'author',author:{handle:'writer',name:'Profile'},post:null,initial:null,unsubscribed:false,
  page:{title_en:'Profile',context:{}},utils:{scriptAssetVersion:()=>''}
 },{filename:path.resolve('views/community.ejs'),includer:()=>({template:' '})});}
 finally{global.settings=oldSettings;}
 const dom=new JSDOM(html,{url:'https://example.test/community/@writer',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window,d=w.document;
 w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 const moderation=d.createElement('a');moderation.id='community-moderation-link';d.body.append(moderation);
 const coverFollow=d.createElement('button');coverFollow.dataset.coverFollow='writer';coverFollow.textContent='Follow';d.getElementById('community').append(coverFollow);
 let token=null,privateProfile=false;
 w.quranApiPath=p=>'/api'+p;w.hadithAuth={getToken:async()=>token};
 w.fetch=jest.fn(async (url,options)=>{
  const data=url.endsWith('/authors/writer/follow')?{following:JSON.parse(options.body).following}:url.endsWith('/me')?{author:{handle:'reader',name:'Reader'},subscriptions:[]}:
   url.endsWith('/authors/writer')?(privateProfile?{error:'This profile is unavailable.'}:{author:{handle:'writer',name:'Chosen Name',bio:'Members-only bio',followers:1,following:2,posts:3,comments:4}}):
   url.includes('/feed')?{items:[],hasMore:false,offset:20}:url.endsWith('/contributors')?{contributors:[]}:{};
  return {ok:!(privateProfile&&url.endsWith('/authors/writer')),json:async()=>data};
 });
 try {
  w.eval(fs.readFileSync('public/static/js/community.js','utf8'));await settle();
  expect(d.getElementById('community-author-profile').hidden).toBe(true);
  expect(w.fetch).not.toHaveBeenCalled();
  token='reader-token';privateProfile=true;d.dispatchEvent(new w.Event('hadithAuthChanged'));await settle();
  expect(d.getElementById('community-author-profile').hidden).toBe(true);
  expect(d.getElementById('community-status').textContent).toBe('This profile is unavailable.');
  privateProfile=false;d.dispatchEvent(new w.Event('hadithAuthChanged'));await settle();
  expect(d.getElementById('community-author-profile').hidden).toBe(false);
  expect(d.getElementById('community-author-bio').textContent).toBe('Members-only bio');
  expect(w.fetch.mock.calls.some(([url])=>url.includes('/feed?scope=everyone'))).toBe(true);
  coverFollow.click();await settle();expect(coverFollow.textContent).toBe('Unfollow');
  expect(d.getElementById('community-follow').textContent).toBe('Unfollow');
  coverFollow.click();await settle();expect(coverFollow.textContent).toBe('Follow');
  token=null;d.dispatchEvent(new w.Event('hadithAuthChanged'));await settle();
  expect(d.getElementById('community-author-profile').hidden).toBe(true);
  expect(d.getElementById('community-author-content').hidden).toBe(true);
  expect(d.body.textContent).not.toContain('Members-only bio');
 }finally{w.close();}
});

test('profile editor checks availability, rejects taken handles and ignores stale responses', async () => {
 const oldSettings=global.settings;global.settings={site:{}};
 let html;
 try {html=ejs.render(fs.readFileSync('views/community.ejs','utf8'),{
  view:'mine',author:null,post:null,initial:null,unsubscribed:false,
  page:{title_en:'My wall',context:{}},utils:{scriptAssetVersion:()=>''}
 },{filename:path.resolve('views/community.ejs'),includer:()=>({template:' '})});}
 finally {global.settings=oldSettings;}
 const dom=new JSDOM(html,{url:'https://example.test/community/mine',runScripts:'outside-only'}), w=dom.window,d=w.document;
 w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 w.quranApiPath=p=>'/api'+p;w.hadithAuth={getToken:async()=>'token'};
 let resolveOld;
 const author={handle:'author-0123456789abcdef',name:'Writer',bio:''};
 w.fetch=jest.fn(async(url,options)=>{
  if(url.includes('handle-availability')) {
   const handle=new URL(url,'https://example.test').searchParams.get('handle');
   if(handle==='older') return new Promise(resolve=>{resolveOld=()=>resolve({ok:true,json:async()=>({available:false,error:'This handle is taken.'})});});
   return {ok:true,json:async()=>({handle,available:handle!=='taken',error:'This handle is taken.'})};
  }
  const data=url.endsWith('/me')?{author,subscriptions:[]}:url.includes('/feed')?{items:[],hasMore:false}:url.endsWith('/contributors')?{contributors:[]}:{};
  return {ok:true,json:async()=>data};
 });
 try {
  w.eval(fs.readFileSync('public/static/js/community.js','utf8'));await settle();
  d.getElementById('community-edit-profile').click();await settle();
  const input=d.getElementById('community-handle'),form=d.getElementById('community-profile-form'),icon=d.getElementById('community-handle-icon');
  expect(icon.classList.contains('bi-check-circle-fill')).toBe(true);
  input.value='taken';form.dispatchEvent(new w.Event('submit',{cancelable:true}));await settle();
  expect(icon.classList.contains('bi-x-circle-fill')).toBe(true);
  expect(w.fetch.mock.calls.some(([url,opts])=>url.endsWith('/profile')&&opts?.method==='PUT')).toBe(false);
  input.value='older';input.dispatchEvent(new w.Event('input'));await new Promise(resolve=>setTimeout(resolve,350));
  input.value='newer';input.dispatchEvent(new w.Event('input'));await new Promise(resolve=>setTimeout(resolve,350));await settle();
  expect(icon.classList.contains('bi-check-circle-fill')).toBe(true);
  resolveOld();await settle();
  expect(icon.classList.contains('bi-check-circle-fill')).toBe(true);
 } finally {w.close();}
});
