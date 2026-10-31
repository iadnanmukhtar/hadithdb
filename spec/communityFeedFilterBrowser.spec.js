'use strict';
const fs=require('fs'),path=require('path'),ejs=require('ejs'),{JSDOM}=require('jsdom');
const settle=async()=>{for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));};
async function setup(query='') {
 const previous=global.settings;global.settings={site:{}};let html;
 try {html=ejs.render(fs.readFileSync('views/community.ejs','utf8'),{view:'everyone',author:null,post:null,initial:null,page:{title_en:'Community',context:{}},utils:{scriptAssetVersion:()=>''}},{filename:path.resolve('views/community.ejs'),includer:()=>({template:' '})});}finally{global.settings=previous;}
 const dom=new JSDOM(html,{url:'https://example.test/community'+query,runScripts:'outside-only'}),w=dom.window;
 w.quranApiPath=p=>'/api'+p;w.hadithAuth={getToken:async()=>null};
 w.fetch=jest.fn(async url=>({ok:true,json:async()=>url.includes('/feed?')?{items:[],hasMore:false,offset:20}:{contributors:[]}}));
 w.eval(fs.readFileSync('public/static/js/community.js','utf8'));await settle();return dom;
}
const lastKind=w=>new URL(w.fetch.mock.calls.filter(([url])=>url.includes('/feed?')).at(-1)[0],'https://example.test').searchParams.get('kind');
test('filter restores from URL and follows Back/Forward while preserving other URL state',async()=>{
 const dom=await setup('?filter=note&keep=yes#feed'),w=dom.window,select=w.document.getElementById('community-filter');
 try {
  expect(select.value).toBe('note');expect(lastKind(w)).toBe('note');
  select.value='article';select.dispatchEvent(new w.Event('change'));await settle();
  expect(w.location.search).toBe('?filter=article&keep=yes');expect(w.location.hash).toBe('#feed');expect(lastKind(w)).toBe('article');
  w.history.back();await new Promise(resolve=>setTimeout(resolve,30));await settle();
  expect(select.value).toBe('note');expect(lastKind(w)).toBe('note');
  w.history.forward();await new Promise(resolve=>setTimeout(resolve,30));await settle();
  expect(select.value).toBe('article');expect(lastKind(w)).toBe('article');
  select.value='all';select.dispatchEvent(new w.Event('change'));await settle();
  expect(w.location.search).toBe('?keep=yes');expect(lastKind(w)).toBe('all');
 }finally{w.close();}
});
test.each(['?filter=all','?filter=invalid','?filter=draft'])('default or unsupported filter removes its parameter: %s',async query=>{
 const dom=await setup(query);try{expect(dom.window.location.search).toBe('');expect(lastKind(dom.window)).toBe('all');}finally{dom.window.close();}
});
