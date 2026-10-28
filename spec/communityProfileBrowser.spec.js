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
 let token=null,privateProfile=false;
 w.quranApiPath=p=>'/api'+p;w.hadithAuth={getToken:async()=>token};
 w.fetch=jest.fn(async url=>{
  const data=url.endsWith('/me')?{author:{handle:'reader',name:'Reader'},subscriptions:[]}:
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
  token=null;d.dispatchEvent(new w.Event('hadithAuthChanged'));await settle();
  expect(d.getElementById('community-author-profile').hidden).toBe(true);
  expect(d.getElementById('community-author-content').hidden).toBe(true);
  expect(d.body.textContent).not.toContain('Members-only bio');
 }finally{w.close();}
});
