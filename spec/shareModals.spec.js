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
    expect(open).toHaveBeenCalledWith({url:`https://hadithunlocked.com/${ref}`,title:'Source title',description:'Selected text'});
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
  test('offers five choices, routes Image to the existing modal, copies text/link and invokes native sharing', async () => {
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
      expect([...buttons].map(b => b.textContent)).toEqual(['Image', 'Post', 'Text', 'Link', 'More…']);
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
      expect([...pane.querySelectorAll('.content-share-options button')].map(b=>b.textContent)).toEqual(['Post', 'Text', 'Link', 'More…']);
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
