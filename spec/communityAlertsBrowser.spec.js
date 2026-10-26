'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '../public/static/js/community-alerts.js'), 'utf8');
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
const alert = { id:'comment:1',kind:'reply',author:{name:'Reader'},title:'My post',url:'/community/@writer/1#comment-1',createdAt:'2026-10-26T10:00:00Z' };
function setup(following = false) {
  const dom = new JSDOM(`<a href="/community/following">Following<span data-community-alert-badge hidden></span></a>${following ? '<section id="community-alerts" hidden><div data-community-alert-list></div><button data-community-alert-more hidden></button><p data-community-alert-status></p></section>' : ''}`, { url:'http://localhost:3004/community', runScripts:'outside-only', pretendToBeVisual:true });
  const w = dom.window; w.quranApiPath = url => '/api' + url;
  w.hadithAuth = {getToken:jest.fn(async ()=>'alice')};
  w.setInterval = jest.fn(); w.fetch = jest.fn(async (_url, options) => ({ok:true,json:async()=>options.method === 'PUT' ? {read:true} : {count:2,items:[alert],through:'2026-10-26T12:00:00.000Z'}}));
  return {dom,w,start:()=>w.eval(source)};
}

test('badge starts hidden, shows unread count on the bar, and never marks alerts read there',async()=>{
  const {dom,w,start}=setup();
  try {
    expect(w.document.querySelector('[data-community-alert-badge]').hidden).toBe(true);
    start();await settle();
    expect(w.document.querySelector('a').getAttribute('aria-label')).toBe('Following, 2 unread alerts');
    expect(w.document.querySelector('[data-community-alert-badge]').textContent).toBe('2');
    expect(w.fetch.mock.calls.every(([,options])=>!options.method)).toBe(true);
  } finally {dom.window.close();}
});
test('Following displays incoming alerts before acknowledging its snapshot and keeps the displayed list',async()=>{
  const {dom,w,start}=setup(true);
  try {
    const fetch=w.fetch;
    w.fetch=jest.fn(async(url,options)=>{
      if(options.method==='PUT') expect(w.document.querySelector('.community-alert-row').textContent).toContain('Reader replied on My post');
      return fetch(url,options);
    });
    start();await settle();
    expect(w.document.querySelector('[data-community-alert-badge]').hidden).toBe(true);
    expect(w.document.querySelector('.community-alert-row').getAttribute('href')).toBe(alert.url);
    expect(JSON.parse(w.fetch.mock.calls.find(([,o])=>o.method==='PUT')[1].body)).toEqual({through:'2026-10-26T12:00:00.000Z'});
  } finally {dom.window.close();}
});
test('account switch clears the old badge and rejects an in-flight old-account response',async()=>{
  const {dom,w,start}=setup(true);let resolve;
  try {
    w.fetch=jest.fn(()=>new Promise(done=>{resolve=done;}));
    start();await settle();
    w.hadithAuth.getToken.mockResolvedValue(null);
    w.document.dispatchEvent(new w.CustomEvent('hadithAuthChanged'));
    resolve({ok:true,json:async()=>({count:1,items:[alert],through:'2026-10-26T12:00:00.000Z'})});
    await settle();
    expect(w.document.querySelector('[data-community-alert-badge]').hidden).toBe(true);
    expect(w.document.querySelector('#community-alerts').hidden).toBe(true);
    expect(w.fetch).toHaveBeenCalledTimes(1);
  } finally {dom.window.close();}
});
test('hidden Following tabs do not acknowledge unseen alerts',async()=>{
  const {dom,w,start}=setup(true);
  try {
    Object.defineProperty(w.document,'visibilityState',{value:'hidden',configurable:true});
    start();await settle();expect(w.fetch).not.toHaveBeenCalled();
  } finally {dom.window.close();}
});
