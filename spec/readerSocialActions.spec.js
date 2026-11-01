'use strict';
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const { JSDOM } = require('jsdom');
const Utils = require('../lib/Utils');
const render = (name, data) => ejs.renderFile(path.resolve('views/sub-views', `${name}.ejs`), data);

function installNotes(window) {
  const source = fs.readFileSync(require.resolve('../public/static/js/notebook.js'), 'utf8');
  const functions = ['sourceFor', 'installButtons'].map(name => source.match(new RegExp(`  function ${name}\\([^]*?\\n  }`))[0]).join('\n');
  window.eval(`const installed = new WeakSet(), buttons = new Map();
    const sourceSelector = '.hadith-bookmark-btn, .heading-bookmark-btn, .tafsir-bookmark-btn, [data-note-key]';
    function paintButtons() {} function scheduleStatus() {}
    function open(source) { window.openedNote = source; }
    ${functions}
    installButtons(); installButtons();`);
}

test.each([['history', 'sirah', 'History'], ['history', 'sirah', ''], ['bukhari', 'hadith', 'Faith'], ['quran', 'quran', 'al-Baqarah']])('%s chapter headings expose bookmarks and notes (%s, %s)', async (alias, type, title) => {
  const book = { alias, type, shortName_en: title };
  const chapter = { id: 20, h1: 2, title_en: title, title: 'التاريخ', path: `${alias}/2`, sections: [], book };
  const html = await render('chapterTitle', {
    page: { context: { book, chapter }, menu: 'Chapter' }, site: { editMode: false }, req: {},
    utils: Object.assign(Object.create(Utils), { urlFor: (_, url) => url }), arabic: require('../lib/Arabic')
  });
  const dom = new JSDOM(html, { url: 'https://hadithunlocked.com/history/2', runScripts: 'outside-only' });
  try {
    installNotes(dom.window);
    const d = dom.window.document;
    expect(d.querySelectorAll('.reader-heading-more, .reader-heading-actions [data-bs-toggle]')).toHaveLength(0);
    expect(d.querySelectorAll('.reader-heading-actions .heading-bookmark-btn')).toHaveLength(1);
    expect(d.querySelectorAll('.reader-heading-actions .personal-note-btn')).toHaveLength(1);
    d.querySelector('.personal-note-btn').click();
    expect(dom.window.openedNote.source_key).toBe('heading:20');
    expect(dom.window.openedNote.source_url).toBe(`/${alias}/2`);
    expect(d.querySelector('.heading-bookmark-btn').dataset.bookmarkType).toBe(alias === 'quran' ? 'surah' : 'chapter');
  } finally { dom.window.close(); }
});

test('Tafsir retains its independent notebook identity and a single clickable like counter', async () => {
  const html = await render('content_item_actions', {
    item: { id: 9, source_key: 'tafsir:ibn-kathir:2:255', title: 'Tafsir', url: '/quran:2:255' }, widgetId: 'test-comments'
  });
  const dom = new JSDOM(`<main class="tafsir-only-page"><div class="quran-tafsir-text" lang="ar" dir="rtl">${html}</div></main>`, { url: 'https://quranunlocked.com', runScripts: 'outside-only' });
  try {
    installNotes(dom.window);
    const d = dom.window.document;
    expect(d.querySelector('.reader-social-actions').lang).toBe('en');
    expect(d.querySelector('.reader-social-actions').dir).toBe('ltr');
    expect(d.querySelector('.quran-tafsir-text').lang).toBe('ar');
    expect(d.querySelector('.reader-social-actions .hadith-like-btn .hadith-like-count')).not.toBeNull();
    expect(d.querySelectorAll('.reader-social-actions .personal-note-btn')).toHaveLength(1);
    d.querySelector('.personal-note-btn').click();
    expect(dom.window.openedNote.source_key).toBe('tafsir:ibn-kathir:2:255');
    expect(d.querySelector('.reflection-count-link').dataset.reflectionDisclosureTrigger).toBe('test-comments-disclosure');
  } finally { dom.window.close(); }
});

 test('Study and Tafsir Surah controls use the same chapter bookmark and note identity', async () => {
  const html = await render('quran_surah_actions', {
    quranChapter: { id: 20 }, surah: { num: 2 }, quranChapterTitleEn: 'al-Baqarah',
    quranChapterTitleAr: 'البقرة', quranChapterHref: '/quran/2'
  });
  const dom = new JSDOM(html, { url: 'https://quranunlocked.com', runScripts: 'outside-only' });
  try {
    installNotes(dom.window);
    const d = dom.window.document;
    expect(d.querySelector('.heading-bookmark-btn').dataset.bookmarkRef).toBe('quran:2');
    d.querySelector('.personal-note-btn').click();
    expect(dom.window.openedNote.source_key).toBe('heading:20');
    expect(dom.window.openedNote.source_url).toBe('/quran/2');
  } finally { dom.window.close(); }
});
