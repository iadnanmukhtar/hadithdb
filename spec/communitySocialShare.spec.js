'use strict';
const fs = require('fs');
const { JSDOM } = require('jsdom');
const ejs = require('ejs');
const source = fs.readFileSync('public/static/js/community-social-share.js', 'utf8');
function setup(path = '/blog/author/an-article') {
  const dom = new JSDOM('<button data-community-share-title="Arabic العربية & reflection"><i></i></button>', {url:'https://hadithunlocked.com/community',runScripts:'outside-only'});
  const w = dom.window;
  w.document.querySelector('button').dataset.communityShareUrl = path;
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; };
  const client = fs.readFileSync('public/static/js/script.js', 'utf8');
  w.eval(client.slice(client.indexOf('function contentSocialShareOptions('), client.indexOf('function openContentSharePane(')));
  w.eval(source);
  return {dom,w,open:()=>w.document.querySelector('button i').click()};
}
test.each(['/blog/author/an-article','/community/@author/123','/community/p/483bb19c-9951-46fd-8f61-e07a1196e6ee'])('shares the item canonical URL on every platform: %s', path=>{
  const {dom,w,open}=setup(path);
  try {
    open();
    const links = [...w.document.querySelectorAll('.content-share-options a')];
    expect(links.map(a=>a.querySelector('span').textContent)).toEqual(['Facebook','WhatsApp','Telegram','Threads','X','Reddit']);
    for(const a of links) {
      expect(decodeURIComponent(a.href)).toContain('https://hadithunlocked.com'+path);
      expect(a.rel).toBe('noopener noreferrer');
    }
    expect(w.document.querySelector('.content-share-source').textContent).toContain('العربية &');
    expect(w.document.querySelector('.content-share-options').textContent).not.toContain('More');
  } finally {dom.window.close();}
});
test('copy, native cancellation, and reopening work without duplicated dialogs',async()=>{
  const {dom,w,open}=setup();
  try {
    w.navigator.clipboard={writeText:jest.fn(async()=>{})};
    w.navigator.share=jest.fn(async()=>{throw Object.assign(new Error(),{name:'AbortError'});});
    open();
    const buttons=[...w.document.querySelectorAll('.content-share-options button')];
    buttons[0].click(); await new Promise(setImmediate);
    expect(w.navigator.clipboard.writeText).toHaveBeenCalledWith('https://hadithunlocked.com/blog/author/an-article');
    expect(w.document.querySelector('[role=status]').textContent).toBe('Link copied');
    w.document.querySelector('.content-share-close').click();open();
    [...w.document.querySelectorAll('.content-share-options button')][1].click();await new Promise(setImmediate);
    expect(w.navigator.share).toHaveBeenCalled();
    expect(w.document.querySelector('[role=status]').textContent).toBe('');
    expect(w.document.querySelectorAll('dialog')).toHaveLength(1);
  } finally {dom.window.close();}
});
test('clipboard failure offers a selectable URL',async()=>{
  const {dom,w,open}=setup();
  try {open();w.document.querySelector('.content-share-options button').click();await new Promise(setImmediate);
    expect(w.document.querySelector('input').value).toBe('https://hadithunlocked.com/blog/author/an-article');
  } finally {dom.window.close();}
});
test.each(['draft','pending','published'])('server cards only share published content: %s', status=>{
  const html=ejs.render(fs.readFileSync('views/sub-views/community_card.ejs','utf8'),{item:{id:1,kind:'article',status,url:'/community/@author/1',title:'Title',author:{name:'Author',handle:'author'}},include:()=>''});
  expect(html.includes('data-community-share-url')).toBe(status==='published');
});
