const fs = require('fs');
const path = require('path');

function source(relativePath) {
	return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

describe('Hadith and Quran share modals', () => {
	test('both server-rendered modals expose text, image, and native share actions', () => {
		for (const template of ['views/sub-views/hadith_modal.ejs', 'views/sub-views/quran_modal.ejs']) {
			const markup = source(template);
			expect(markup).toContain('hadith-share-copy-text');
			expect(markup).toContain('hadith-share-copy');
			expect(markup).toContain('hadith-share-native');
		}
	});

	test('dynamic Quran share modals expose text copy and use the shared handler', () => {
		const client = source('public/static/js/script.js');
		const dynamicModal = client.slice(client.indexOf('function quranShareModalHtml'), client.indexOf('function quranShareRefParts'));
		expect(dynamicModal).toContain("title: 'Copy text'");
		expect(dynamicModal).toContain('hadith-share-copy-text');
		expect(client).toContain("copyTextButton.addEventListener('click'");
		expect(client).toContain('copyHadithShareCardText(card, copyTextButton)');
	});

	test('share cards avoid color and gradient forms unsupported by html2canvas', () => {
		const css = source('public/static/css/style.css');
		const cardRule = css.slice(css.indexOf('.hadith-share-card {'), css.indexOf('.hadith-share-card-inner {'));
		expect(cardRule).toContain('--c-footnote-muted: #76787a;');
		expect(cardRule).toContain('background-color: #fbfbfb;');
		expect(cardRule).toContain('background-image: repeating-linear-gradient');
		expect(cardRule).not.toContain('linear-gradient(180deg');
	});
});

 describe('Community note sharing', () => {
  const vm = require('vm');
  test.each(['bukhari:1', 'quran:2:255', 'quran:2:255-257'])('opens the same-page composer for %s', ref => {
    const client = source('public/static/js/script.js');
    const fn = client.slice(client.indexOf('function shareCardToCommunity('), client.indexOf('async function copyHadithShareCardText('));
    const open = jest.fn();
    const card = {querySelector:()=>({textContent:'Source title'}),querySelectorAll:()=>[],getAttribute:()=>ref};
    vm.runInNewContext(fn + ';shareCardToCommunity(card);', {card,window:{CommunityPostShare:{open}},contentShareUrl:()=>`https://hadithunlocked.com/${ref}`,plainTextFromShareSection:()=> 'Selected text'});
    expect(open).toHaveBeenCalledWith({url:`https://hadithunlocked.com/${ref}`,title:'Source title',description:'Selected text',text:''});
  });
  test('waits for sign-in, opens an editable note, then consumes the handoff', () => {
    const { JSDOM } = require('jsdom');
    const dom = new JSDOM('<dialog id="quick-dialog"></dialog><textarea id="quick-text"></textarea><button id="quick-open"></button><button id="quick-preview-button"></button>', { url: 'https://quranunlocked.com/community?shareNote=community-share-123-abc', runScripts: 'outside-only' });
    try {
      const w = dom.window;
      w.sessionStorage.setItem('community-share-123-abc', 'عربي\n\nEnglish\n\nquran:2:255-257');
      w.eval("var me = null; var messages = []; var status = text => messages.push(text); var $ = id => document.getElementById(id);");
      const client = source('public/static/js/community.js');
      w.eval(client.slice(client.indexOf('  function openSharedNote()'), client.indexOf('  function closeQuick()')));
      const open = jest.fn();
      w.document.getElementById('quick-open').addEventListener('click', open);
      w.openSharedNote();
      expect(open).not.toHaveBeenCalled();
      expect(w.sessionStorage.length).toBe(1);
      w.eval('me = {author: {}}');
      w.openSharedNote();
      expect(open).toHaveBeenCalledTimes(1);
      const editor = w.document.getElementById('quick-text');
      expect(editor.value).toContain('quran:2:255-257');
      expect(editor.disabled).toBe(false);
      editor.value += '\nMy reflection';
      expect(editor.value).toContain('My reflection');
      expect(w.sessionStorage.length).toBe(0);
      expect(w.location.search).toBe('');
      w.openSharedNote();
      expect(open).toHaveBeenCalledTimes(1);
    } finally { dom.window.close(); }
  });
});

describe('Share pane actions', () => {
  const { JSDOM } = require('jsdom');
  test('offers social sharing choices, routes Image to the existing modal, copies text/link and invokes native sharing', async () => {
    const dom = new JSDOM('<div id="image-modal"><article data-share-card data-share-ref="quran:2:255-257" data-share-url="https://quranunlocked.com/quran/2:255-257"><h2 class="hadith-share-title">Baqarah 2:255–257</h2></article></div>', { url: 'https://quranunlocked.com/community', runScripts: 'outside-only' });
    try {
      const w = dom.window;
      w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
      w.HTMLDialogElement.prototype.close = function () { this.open = false; };
      const show = jest.fn(), copy = jest.fn().mockResolvedValue(), native = jest.fn().mockResolvedValue(), post = jest.fn();
      w.bootstrap = { Modal: { getOrCreateInstance: () => ({ show }) } };
      w.copyTextToClipboard = copy; w.navigator.share = native;
      w.hadithShareCardText = () => 'Arabic and English text';
      w.quranUrl = path => path;
      const client = source('public/static/js/script.js');
      w.eval(client.slice(client.indexOf('function contentShareUrl('), client.indexOf('function shareCardToCommunity(')));
      w.shareCardToCommunity = post;
      const modal = w.document.getElementById('image-modal'), card = modal.querySelector('article');
      w.openContentSharePane(modal, card);
      const pane = w.document.getElementById('content-share-pane'), buttons = pane.querySelectorAll('.content-share-options button');
      expect([...buttons].map(b => b.textContent)).toEqual(['Image', 'Post', 'Text', 'Copy link', 'More…']);
      expect([...pane.querySelectorAll('.content-share-options > * span')].map(el => el.textContent)).toEqual(['Image', 'Post', 'Text', 'Copy link', 'More…', 'Facebook', 'WhatsApp', 'Telegram', 'Threads', 'X', 'Reddit']);
      for (const a of pane.querySelectorAll('.content-share-options a')) {
        expect(decodeURIComponent(a.href)).toContain('https://quranunlocked.com/quran/2:255-257');
        expect(a.rel).toBe('noopener noreferrer');
      }
      buttons[0].click(); expect(show).toHaveBeenCalledTimes(1); expect(modal.dataset.shareImageRequested).toBe('true'); expect(pane.open).toBe(false);
      w.openContentSharePane(modal, card);
      const actions = pane.querySelectorAll('.content-share-options button');
      actions[1].click(); expect(post).toHaveBeenCalledWith(card);
      actions[2].click(); actions[3].click(); actions[4].click();
      await new Promise(resolve => setImmediate(resolve));
      expect(copy.mock.calls).toEqual([['Arabic and English text'], ['https://quranunlocked.com/quran/2:255-257']]);
      expect(native).toHaveBeenCalledWith({ title: 'Baqarah 2:255–257', url: 'https://quranunlocked.com/quran/2:255-257' });
      expect(w.document.querySelectorAll('#content-share-pane')).toHaveLength(1);
      card.dataset.shareImageAllowed = 'false';
      w.openContentSharePane(modal, card);
      expect([...pane.querySelectorAll('.content-share-options button')].map(b=>b.textContent)).toEqual(['Post', 'Text', 'Copy link', 'More…']);
      delete card.dataset.shareImageAllowed;
      w.openContentSharePane(modal, card);
      w.navigator.share = undefined;
      actions[4].click(); await new Promise(resolve => setImmediate(resolve));
      expect(pane.querySelector('[role=status]').textContent).toContain('unavailable');
    } finally { dom.window.close(); }
  });
});

test('Community post composer shows the source preview while the user edits', async () => {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<main id="community"><textarea id="community-quick-text">https://quranunlocked.com/quran/2:255-257</textarea><div id="community-quick-attachments"></div></main>', { url: 'https://quranunlocked.com/community', runScripts: 'outside-only' });
  try {
    const w = dom.window;
    w.quranApiPath = path => '/api' + path;
    w.hadithAuth = { getToken: async () => 'token' };
    w.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ url: 'https://quranunlocked.com/quran/2:255-257', title: 'Baqarah 2:255–257', description: 'Source ayahs', image: null }) }));
    w.eval(source('public/static/js/community-media.js'));
    const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
    await settle();
    expect(w.document.querySelector('.community-link-card strong').textContent).toBe('Baqarah 2:255–257');
    expect(JSON.parse(w.fetch.mock.calls[0][1].body)).toEqual({ url: 'https://quranunlocked.com/quran/2:255-257' });
    const editor = w.document.getElementById('community-quick-text');
    editor.value = 'My reflection\n\n' + editor.value;
    editor.dispatchEvent(new w.Event('input')); await settle();
    expect(w.document.querySelector('.community-link-card')).not.toBeNull();
    expect(w.fetch).toHaveBeenCalledTimes(1);
    w.document.querySelector('.community-attachment-row button').click(); await settle();
    expect(w.document.querySelector('.community-link-card')).toBeNull();
    expect(editor.value).toContain('Link: https://');
  } finally { dom.window.close(); }
});

test('Hadith post receives Arabic then English with a trailing reference even when an image language is hidden',()=>{
 const {JSDOM}=require('jsdom');
 const dom=new JSDOM('<article id="card" data-share-ref="bukhari:2"><section class="hadith-share-section" lang="en"><div class="hadith-share-text"><p>English first paragraph.</p><p>Second paragraph.</p></div></section><section class="hadith-share-section d-none" lang="ar"><div class="hadith-share-text">نَصٌّ عربي<br>سطر آخر</div></section></article>',{runScripts:'outside-only'});
 try{
  const w=dom.window,client=source('public/static/js/script.js'),open=jest.fn();
  w.CommunityPostShare={open};w.contentShareUrl=()=> 'https://hadithunlocked.com/bukhari:2';
  w.eval(client.slice(client.indexOf('function plainTextFromShareSection('),client.indexOf('function updateHadithShareMetadataFromEditable(')));
  w.eval(client.slice(client.indexOf('function shareCardToCommunity('),client.indexOf('async function copyHadithShareCardText(')));
  w.shareCardToCommunity(w.document.getElementById('card'));
  expect(open.mock.calls[0][0].text).toBe('نَصٌّ عربي\nسطر آخر\n\nEnglish first paragraph.\n\nSecond paragraph. — bukhari:2');
 }finally{dom.window.close();}
});

test('Quran post text uses normal Arabic for each ayah without changing the display script',()=>{
 const {JSDOM}=require('jsdom');
 const dom=new JSDOM('<section lang="ar"><div class="hadith-share-text"><span data-quran-post-text="بِسْمِ اللَّهِ">DISPLAY SCRIPT ONE</span> ۝١ <span data-quran-post-text="الْحَمْدُ لِلَّهِ">DISPLAY SCRIPT TWO</span> ۝٢</div></section>',{runScripts:'outside-only'});
 try{
  const w=dom.window,client=source('public/static/js/script.js');
  w.eval(client.slice(client.indexOf('function plainTextFromShareSection('),client.indexOf('function updateHadithShareMetadataFromEditable(')));
  const section=w.document.querySelector('section');
  expect(w.plainTextFromShareSection(section,true)).toBe('بِسْمِ اللَّهِ ۝١ الْحَمْدُ لِلَّهِ ۝٢');
  expect(section.textContent).toContain('DISPLAY SCRIPT ONE');
  expect(source('views/sub-views/quran_modal.ejs')).toContain('data-quran-post-text="<%= utils.quranDisplayText(ayah.ar?.body_alt || ayah.body_ar_alt || ayah.ar?.body) %>"');
  expect(client).toContain("'data-quran-post-text': compactQuranPlainText(ayah && ayah.ar && ayah.ar.body)");
 }finally{dom.window.close();}
});

test.each(['nested', 'flat'])('server Quran share uses %s alt Arabic through the actual template and post extraction', field=>{
 const {JSDOM}=require('jsdom'),ejs=require('ejs');
 const normal='فَسَقَى لَهُمَا ثُمَّ تَوَلَّى إِلَى الظِّلِّ';
 const ayah={num:'28:24',ar:{num:'٢٨:٢٤',body:'DISPLAY \uE000 \uE001'},en:{num:'28:24',body:'So he watered for them.'}};
 if(field==='nested')ayah.ar.body_alt=normal;else ayah.body_ar_alt=normal;
 const html=ejs.render(source('views/sub-views/quran_modal.ejs'),{
  selectedAyahs:[ayah],page:{context:{}},quranShareId:'test-share',req:{},
  utils:{quranUrl:(_req,url)=>url,quranDisplayText:s=>s || '',defaultQuranTranslationLabel:()=> 'Translation'},
  arabic:{toLatinDigits:s=>s,toArabicDigits:s=>s}
 });
 const dom=new JSDOM(html,{runScripts:'outside-only'});
 try{
  const w=dom.window,client=source('public/static/js/script.js');
  w.eval(client.slice(client.indexOf('function plainTextFromShareSection('),client.indexOf('function updateHadithShareMetadataFromEditable(')));
  const section=w.document.querySelector('.hadith-share-arabic-section');
  const text=w.plainTextFromShareSection(section,true);
  expect(text).toContain(normal);
  expect(text).not.toMatch(/[\uE000-\uF8FF]/u);
  expect(text).not.toContain('DISPLAY');
  expect(section.textContent).toContain('DISPLAY');
 }finally{dom.window.close();}
});

test('post text collapses template indentation and places translator on the next line',()=>{
 const {JSDOM}=require('jsdom');
 const dom=new JSDOM(`<section lang="en"><div class="hadith-share-text">
       <p>
          <span>28:24 So he watered for them.</span>
                  <span data-quran-share-translation-attribution="1">— Saheeh Int'l</span>
       </p>
       <p>Another paragraph.<br>Another line.</p>
    </div></section>`,{runScripts:'outside-only'});
 try{
  const w=dom.window,client=source('public/static/js/script.js');
  w.eval(client.slice(client.indexOf('function plainTextFromShareSection('),client.indexOf('function updateHadithShareMetadataFromEditable(')));
  expect(w.plainTextFromShareSection(w.document.querySelector('section'),true)).toBe("28:24 So he watered for them.\n— Saheeh Int'l\n\nAnother paragraph.\nAnother line.");
 }finally{dom.window.close();}
});

test('Post waits for the scoped translation and shares its text, attribution and URL',async()=>{
 const {JSDOM}=require('jsdom');
 const dom=new JSDOM('<div class="hadith-share-modal"><article class="quran-share-card" data-share-ref="quran:28:24"><section class="hadith-share-section" lang="en"><div class="hadith-share-text">Old translation — Saheeh</div></section></article></div>',{url:'http://localhost:3004/quran/en-khattab/quran:28:24',runScripts:'outside-only'});
 try{
  const w=dom.window,client=source('public/static/js/script.js'),open=jest.fn();let finish;
  w.CommunityPostShare={open};w.quranSelectedTranslationAliasFromLocation=()=> 'en-khattab';w.quranUrl=p=>p;
  w.contentShareUrl=card=>new URL(card.getAttribute('data-share-url'),w.location.href).href;
  w.applyQuranShareTranslation=jest.fn((modal,card,alias,required)=>new Promise(resolve=>{finish=()=>{modal.querySelector('.hadith-share-text').textContent='Khattab translation\n— Mustafa Khattab';resolve();};}));
  w.eval(client.slice(client.indexOf('function plainTextFromShareSection('),client.indexOf('function updateHadithShareMetadataFromEditable(')));
  w.eval(client.slice(client.indexOf('function shareCardToCommunity('),client.indexOf('async function copyHadithShareCardText(')));
  const pending=w.shareCardToCommunity(w.document.querySelector('article'));
  expect(open).not.toHaveBeenCalled();
  expect(w.applyQuranShareTranslation.mock.calls[0].slice(2)).toEqual(['en-khattab',true]);
  finish();await pending;
  expect(open.mock.calls[0][0]).toMatchObject({url:'http://localhost:3004/quran/en-khattab/quran:28:24',text:'Khattab translation — Mustafa Khattab'});
  w.applyQuranShareTranslation=()=>Promise.reject(Error('Unavailable'));
  await expect(w.shareCardToCommunity(w.document.querySelector('article'))).rejects.toThrow('Unavailable');
  expect(open).toHaveBeenCalledTimes(1);
 }finally{dom.window.close();}
});
