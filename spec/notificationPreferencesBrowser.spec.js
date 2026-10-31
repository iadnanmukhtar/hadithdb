'use strict';
const fs=require('fs'),path=require('path'),ejs=require('ejs'),{JSDOM}=require('jsdom');
const settle=async()=>{for(let i=0;i<20;i++)await new Promise(resolve=>setImmediate(resolve));};
test('preferences page loads, saves, unsubscribes and manages author subscriptions',async()=>{
  const previous=global.settings;global.settings={site:{}};
  let html;
  try {html=ejs.render(fs.readFileSync('views/community.ejs','utf8'),{view:'email-preferences',author:null,post:null,initial:null,unsubscribed:false,page:{title_en:'Email preferences',context:{}},utils:{scriptAssetVersion:()=>''}},{filename:path.resolve('views/community.ejs'),includer:()=>({template:' '})});}finally{global.settings=previous;}
  const dom=new JSDOM(html,{url:'https://example.test/community/email-preferences',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,d=w.document;
  w.quranApiPath=p=>'/api'+p;w.hadithAuth={getToken:async()=>'token'};
  let preferences={enabled:true,likes:true,reflections:true,replies:true,reactions:true,articles:true};
  w.fetch=jest.fn(async(url,options)=>{
    let data;
    if(url.endsWith('/me'))data={author:{name:'Reader',handle:'reader'},subscriptions:[{handle:'writer',name:'Writer',email:false}]};
    else if(url.endsWith('/email-preferences')) {if(options.method==='PUT')preferences=JSON.parse(options.body).preferences;data={preferences};}
    else if(url.endsWith('/follow'))data={following:true,email:true};
    else throw new Error(url);
    return {ok:true,json:async()=>data};
  });
  try {
    w.eval(fs.readFileSync('public/static/js/community.js','utf8'));await settle();
    const form=d.getElementById('community-email-form');expect(form.hidden).toBe(false);
    form.elements.replies.checked=false;form.dispatchEvent(new w.Event('submit',{cancelable:true}));await settle();expect(preferences.replies).toBe(false);
    d.querySelector('#community-email-authors button').click();await settle();expect(d.querySelector('#community-email-authors button').textContent).toBe('Unsubscribe');
    d.getElementById('community-email-stop').click();await settle();expect(preferences.enabled).toBe(false);expect(d.getElementById('community-email-categories').disabled).toBe(true);
    form.elements.enabled.checked=true;form.elements.enabled.dispatchEvent(new w.Event('change'));form.dispatchEvent(new w.Event('submit',{cancelable:true}));await settle();expect(preferences.enabled).toBe(true);
    expect(d.querySelector('a[href="/settings#settings-email-section"]')).not.toBeNull();
  }finally{dom.window.close();}
});
