'use strict';
const fs = require('fs'), path = require('path'), ejs = require('ejs');
const { JSDOM } = require('jsdom');
const base = path.join(__dirname,'..');
const settle = async () => { for(let i=0;i<8;i++) await new Promise(resolve=>setImmediate(resolve)); };

async function actions(key='sharh:42') {
  return ejs.renderFile(path.join(base,'views/sub-views/content_item_actions.ejs'),{item:{id:9,source_key:key,title:'Explanation',url:'https://hadithunlocked.com/sharh/test/bukhari:1'},widgetId:'content-comments-9-test'});
}
test.each(['sharh:42','heading-sharh:42','tafsir:ibn-kathir:2:255','intro:42'])('renders independent item actions and preserves notebook identity for %s',async key=>{
  const dom=new JSDOM(await actions(key));
  try {
    const d=dom.window.document;
    expect(d.querySelector('[data-note-key]').dataset.noteKey).toBe(key);
    expect(d.querySelector('[data-like-type]').dataset.likeType).toBe('content');
    expect(d.querySelector('.comment-feed').dataset.targetType).toBe('content');
    expect(d.querySelector('.comment-feed').dataset.targetId).toBe('9');
    expect(d.querySelector('details').open).toBe(false);
    expect(d.querySelector('.hadith-share-action-link').textContent).toContain('Share');
    if(key.startsWith('tafsir:'))expect(d.querySelector('.tafsir-bookmark-btn').dataset.tafsirBookmarkKey).toBe('ibn-kathir:2:255');
    else expect(d.querySelector('[data-content-bookmark-id]').dataset.contentBookmarkId).toBe('9');
  }finally{dom.window.close();}
});

test('installs actions once below dynamic commentary text, shares without Image, and persists bookmarks',async()=>{
  const html=await actions();
  const dom=new JSDOM('<article class="hadith-sharh-entry"><header><span class="notebook-anchor" data-note-key="sharh:42"></span></header><div class="body">Explanation body</div></article>',{url:'https://hadithunlocked.com/test',runScripts:'outside-only'});
  try{
    const w=dom.window;w.quranApiPath=p=>'/api'+p;w.hadithUrl=p=>p;w.quranUrl=p=>p;
    w.hadithAuth={getToken:async()=> 'user'};w.refreshHadithActions=jest.fn();w.openContentSharePane=jest.fn();
    w.jQuery=host=>({append:markup=>host.insertAdjacentHTML('beforeend',markup)});
    w.fetch=jest.fn(async(url,options)=>({ok:true,json:async()=>url.includes('/actions?')?{html,item:{id:9}}:url.endsWith('/bookmarks')?{items:[]}: {saved:true}}));
    w.eval(fs.readFileSync(path.join(base,'public/static/js/content-item-actions.js'),'utf8'));await settle();
    const d=w.document,footer=d.querySelector('.content-item-footer');
    expect(footer.previousElementSibling.className).toBe('body');
    expect(d.querySelector('header .notebook-anchor')).toBeNull();
    expect(d.querySelector('[data-note-key]').dataset.noteKey).toBe('sharh:42');
    expect(d.querySelectorAll('.content-item-actions')).toHaveLength(1);
    d.querySelector('.content-item-share').click();
    const [modal,card]=w.openContentSharePane.mock.calls[0];
    expect(modal).toBeNull();expect(card.dataset.shareImageAllowed).toBe('false');
    expect(card.dataset.shareUrl).toContain('/sharh/test/bukhari:1');
    d.querySelector('.content-item-bookmark').click();await settle();
    const write=w.fetch.mock.calls.find(([url,options])=>options.method==='PUT');
    expect(write[0]).toBe('/api/content-items/9/bookmark');
    expect(JSON.parse(write[1].body)).toEqual({enabled:true});
    expect(w.fetch.mock.calls.filter(([url])=>url.includes('/actions?'))).toHaveLength(1);
  }finally{dom.window.close();}
});

test('content reference validation rejects arbitrary URLs and malformed keys',()=>{
  const Items=require('../lib/ContentItems');
  for(const key of ['sharh:1','heading-sharh:2','intro:3','tafsir:ibn-kathir:2:255'])expect(Items.validKey(key)).toBe(true);
  for(const key of ['https://example.com','sharh:0','tafsir:x:2:0',"sharh:1' OR 1=1",null])expect(Items.validKey(key)).toBe(false);
});

test('content references link back to their own interaction target',()=>{
  const {sourceUrl}=require('../lib/CommunityReflections');
  expect(sourceUrl({type:'content',hadithId:9,ref_num:'items/9'},'hadiths_comments')).toBe('/items/9#content-item-9');
});

test('persistent targets and bookmarks remain separate from hadith identities and user-owned',async()=>{
  const Items=require('../lib/ContentItems'),Sharh=require('../lib/Sharh');
  const spy=jest.spyOn(Sharh,'entryById').mockResolvedValue({entry:{title_en:'Explanation'},book:{alias:'test'},canonical:'/sharh/test/bukhari:1'});
  const previous=global.query,item={id:9,source_key:'sharh:42',title:'Explanation',url:'/sharh/test/bukhari:1'};
  global.query=jest.fn(async query=>query.startsWith('SELECT * FROM content_items')?[item]:query.startsWith('SELECT i.*')?[item]:[]);
  try{
    expect((await Items.resolve('sharh:42')).id).toBe(9);
    await Items.bookmark('alice',9,true);
    await Items.bookmarks('alice');
    await Items.bookmark('alice',9,false);
    const writes=global.query.mock.calls.map(([q])=>q);
    expect(writes).toContain("INSERT IGNORE INTO content_item_bookmarks (item_id,user_uid) VALUES (9,'alice')");
    expect(writes).toContain("DELETE FROM content_item_bookmarks WHERE item_id=9 AND user_uid='alice'");
    expect(writes.some(q=>/UPDATE hadiths|INSERT INTO hadiths/.test(q))).toBe(false);
    spy.mockResolvedValue(null);
    expect(await Items.get(9)).toBeNull();
  }finally{spy.mockRestore();global.query=previous;}
});

test('dedicated tafsir actions reuse the existing passage reflections without adding a second disclosure',async()=>{
  const html=await actions('tafsir:ibn-kathir:2:255');
  const dom=new JSDOM('<main class="tafsir-only-page"><article class="quran-tafsir-entry"><div class="body">Tafsir text</div><span data-note-key="tafsir:ibn-kathir:2:255"></span></article><section class="reflection-section"><details class="reflection-disclosure" id="tafsir-existing-disclosure"><summary>Reflect on this tafsir passage <span class="comment-widget-count">3</span></summary><section class="comment-feed" id="tafsir-existing" data-target-id="42" data-target-type="hadith"><p>Existing reflection</p></section></details></section></main>',{url:'https://quranunlocked.com/quran/tafsir/ibn-kathir/quran:2:255',runScripts:'outside-only'});
  try{
    const w=dom.window;w.quranApiPath=p=>'/api'+p;w.hadithAuth={getToken:async()=>null};w.refreshHadithActions=jest.fn();
    w.jQuery=host=>({append:markup=>host.insertAdjacentHTML('beforeend',markup)});
    w.fetch=jest.fn(async()=>({ok:true,json:async()=>({html,item:{id:9}})}));
    w.eval(fs.readFileSync(path.join(base,'public/static/js/content-item-actions.js'),'utf8'));await settle();
    const d=w.document,link=d.querySelector('.content-item-actions .reflection-count-link'),badge=link.querySelector('.hadith-comment-count');
    expect(d.querySelectorAll('.reflection-disclosure')).toHaveLength(1);
    expect(d.querySelectorAll('.comment-feed')).toHaveLength(1);
    expect(d.querySelector('.comment-feed').textContent).toBe('Existing reflection');
    expect(link.getAttribute('href')).toBe('#tafsir-existing-disclosure');
    expect(link.dataset.reflectionDisclosureTrigger).toBe('tafsir-existing-disclosure');
    expect(badge.dataset.hadithId).toBe('42');expect(badge.dataset.commentType).toBe('hadith');expect(badge.textContent).toBe('3');
    expect(d.querySelector('.content-item-footer').textContent).not.toContain('Reflect on this item');
  }finally{dom.window.close();}
});

test.each([
  [{title_en:'The journey',title:'الرحلة',path:'ibnhisham/19'},'The journey'],
  [{title_en:'',title:'الرحلة',path:'ibnhisham/19'},'الرحلة'],
  [{title_en:'',title:'',path:'ibnhisham/19'},'intro:161496']
])('introduction actions use the stored heading title and preserve their target',async(row,title)=>{
  const previous=global.query;
  global.query=jest.fn(async query=>{
    // Reject the invalid view projection that caused ER_BAD_FIELD_ERROR.
    expect(query).toContain('SELECT t.title_en,t.title,v.path');
    expect(query).toContain('JOIN toc t ON t.id=v.id');
    expect(query).toContain("WHERE v.id='161496'");
    return [row];
  });
  try {
    expect(await require('../lib/ContentItems').source('intro:161496')).toEqual({title,url:'/ibnhisham/19#note-intro-161496'});
    global.query.mockResolvedValue([]);
    await expect(require('../lib/ContentItems').source('intro:161496')).rejects.toMatchObject({status:404});
  }finally{global.query=previous;}
});
