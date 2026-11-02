'use strict';
const fs = require('fs');
const { JSDOM } = require('jsdom');
const Tafsir = require('../lib/Tafsir');
const source = fs.readFileSync('views/sub-views/scripts.ejs', 'utf8');
const functions = source.slice(source.indexOf('const renderMarkdown ='), source.indexOf('const applyHadithRevision ='));
function setup(markdown, prop = 'toc.intro_en') {
  const dom = new JSDOM('<div class="_e content-markdown" contenteditable="true"></div><button id="outside">Outside</button>', { url: 'https://example.test', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.eval(fs.readFileSync('node_modules/jquery/dist/jquery.js', 'utf8'));
  w.marked = require('marked');
  w.renderClientMarkdown = text => w.marked.parse(text);
  w.editHadithApiPath = path => '/api' + path;
  w.fetch = jest.fn(async (_url, options) => {
    const body = JSON.parse(options.body);
    return { ok: true, json: async () => ({ html: Tafsir.renderCommentaryText(body.markdown, '', 'md', body) }) };
  });
  for (const file of ['notebook-shortcuts', 'community-parallel-text', 'community-short-editor']) w.eval(fs.readFileSync(`public/static/js/${file}.js`, 'utf8'));
  w.eval(functions + '; window.contentEditor = { enterMarkdownEditMode, setMarkdownPreview, contentPreview };');
  const el = w.document.querySelector('._e');
  el.dataset.markdownSource = markdown; el.dataset.prop = prop; el.dataset.id = '7';
  w.contentEditor.enterMarkdownEditMode(el);
  return { dom, w, el, active: w.$(el).data('contentMarkdownEditor') };
}

test.each(['toc.intro_en', 'hdith_sharh.text', 'hdith_toc_sharh.text_en', 'commentary.text_en', 'hadith_virtual.note_en', 'hadith_virtual.footnote_en'])('opens %s formatted and retains untouched Markdown exactly', prop => {
  const markdown = '**Text**  \n\nالعربية\n';
  const { dom, active } = setup(markdown, prop);
  try {
    expect(active.surface.mode).toBe('rich');
    active.surface.sync();
    expect(active.source.value).toBe(markdown);
  } finally { dom.window.close(); }
});

test('formatted edits and explicit Markdown switching use the shared serializer', () => {
  const { dom, active } = setup('**Original**');
  try {
    active.surface.rich.querySelector('strong').textContent = 'Changed';
    active.surface.sync();
    expect(active.source.value).toBe('**Changed**');
    active.surface.toSource();
    expect(active.source.hidden).toBe(false);
    active.surface.toFormatted();
    expect(active.surface.rich.textContent).toContain('Changed');
  } finally { dom.window.close(); }
});

test('standalone footnote definitions stay formatted and retain their source', () => {
  const markdown = '[^١]: Arabic العربية\n\n[^two]: **Second** footnote';
  const { dom, active } = setup(markdown, 'commentary.footnotes');
  try {
    expect(active.surface.mode).toBe('rich');
    active.surface.sync();
    expect(active.source.value).toBe(markdown);
  } finally { dom.window.close(); }
});

test('late preview responses cannot replace an active edit', async () => {
  const { dom, w, el } = setup('First');
  try {
    let resolve;
    w.fetch = () => new Promise(done => { resolve = done; });
    w.contentEditor.setMarkdownPreview(el, 'Saved');
    await Promise.resolve();
    w.contentEditor.enterMarkdownEditMode(el);
    resolve({ ok: true, json: async () => ({ html: '<p>Late response</p>' }) });
    await new Promise(done => setTimeout(done, 0));
    expect(el.querySelector('.community-rich-input')).not.toBeNull();
    expect(el.textContent).not.toContain('Late response');
  } finally { dom.window.close(); }
});
