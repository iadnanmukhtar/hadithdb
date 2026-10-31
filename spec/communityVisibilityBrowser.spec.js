'use strict';
const fs=require('fs'),path=require('path'),ejs=require('ejs'),{JSDOM}=require('jsdom');
const settle=async()=>{for(let i=0;i<15;i++)await new Promise(resolve=>setImmediate(resolve));};
test('owner menus hide and restore posts, articles and microactivity, including keyboard dismissal',async()=>{
 const oldSettings=global.settings;global.settings={site:{}};
 let html;
 try {html=ejs.render(fs.readFileSync('views/community.ejs','utf8'),{view:'mine',author:null,post:null,initial:null,unsubscribed:false,page:{title_en:'My wall',context:{}},utils:{scriptAssetVersion:()=>''}},{filename:path.resolve('views/community.ejs'),includer:()=>({template:' '})});}
 finally {global.settings=oldSettings;}
 const dom=new JSDOM(html,{url:'https://example.test/community/mine',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,d=w.document;
 w.HTMLDialogElement.prototype.close=function(){this.open=false;};w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 w.quranApiPath=p=>'/api'+p;w.hadithAuth={getToken:async()=>'token'};
 const author={handle:'writer',name:'Writer',bio:''};
 const items=[{id:1,activity:'post',kind:'note'},{id:2,activity:'post',kind:'article'},{id:3,activity:'hadith_like',kind:'like',url:'/muslim:25b'},{id:4,activity:'post',kind:'note',microinteraction:'title',hadithUrl:'/muslim:25b',hadithTitle:'Source title'},{id:5,activity:'post',kind:'note',microinteraction:'revision',hadithUrl:'/muslim:25b',hadithTitle:'Source title'}].map(item=>({...item,author,status:'published',title:'Example',excerpt:'Text',url:item.url || '/community/p/example',activityAt:'2026-10-31',canHide:true,canEdit:item.id<=2}));
 w.fetch=jest.fn(async(url,options)=>{
  if(url.includes('/visibility/')){const id=Number(url.split('/').pop()),hidden=JSON.parse(options.body).hidden;items.find(i=>i.id===id).hiddenFromOthers=hidden;return {ok:true,json:async()=>({hidden})};}
  const data=url.endsWith('/me')?{author,subscriptions:[]}:url.includes('/feed?')?{items:url.includes('kind=hidden')?items.filter(i=>i.hiddenFromOthers):items,hasMore:false,offset:20}:url.endsWith('/contributors')?{contributors:[]}:{items:[],notes:[]};
  return {ok:true,json:async()=>data};
 });
 try {
  w.eval(fs.readFileSync('public/static/js/community.js','utf8'));await settle();
  expect(d.querySelectorAll('#community-feed .community-secondary-menu')).toHaveLength(5);
  for(let index=0;index<5;index++){
   let card=d.querySelectorAll('#community-feed .community-entry')[index],menu=card.querySelector('.community-secondary-menu');
   const open=card.querySelector('.community-secondary-panel a');
   expect([...menu.querySelector('.community-secondary-panel').children].map(el=>el.textContent)).toEqual(index<2?['Open','Hide','Edit']:['Open','Hide']);
   expect(open.textContent).toBe('Open');expect(open.title).toBe('Open');expect(open.querySelector('.bi-arrow-right')).not.toBeNull();
   expect(index>=2?menu.parentElement===card:menu.parentElement.classList.contains('community-entry-meta')).toBe(true);
   if(index>=2) expect(card.querySelector('.community-secondary-panel a').getAttribute('href')).toBe('/muslim:25b');
   menu.open=true;menu.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));expect(menu.open).toBe(false);
   card.querySelector('.community-visibility').click();await settle();
   card=d.querySelectorAll('#community-feed .community-entry')[index];expect(card.querySelector('.community-visibility').textContent).toContain('Unhide');
   card.querySelector('.community-visibility').click();await settle();
   expect(d.querySelectorAll('#community-feed .community-entry')[index].querySelector('.community-visibility').textContent).toContain('Hide');
  }
  expect(w.fetch.mock.calls.filter(([url])=>url.includes('/visibility/'))).toHaveLength(10);
  const filter=d.getElementById('community-filter');
  expect(filter.querySelector('option[value="hidden"]').textContent).toBe('Hidden');
  items[0].hiddenFromOthers=true;items[2].hiddenFromOthers=true;
  filter.value='hidden';filter.dispatchEvent(new w.Event('change'));await settle();
  expect(d.querySelectorAll('#community-feed .community-entry')).toHaveLength(2);
  expect(w.fetch.mock.calls.some(([url])=>url.includes('scope=mine&kind=hidden'))).toBe(true);
  d.querySelector('#community-feed .community-visibility').click();await settle();
  expect(d.querySelectorAll('#community-feed .community-entry')).toHaveLength(1);
  expect(filter.value).toBe('hidden');
 }finally{dom.window.close();}
});
