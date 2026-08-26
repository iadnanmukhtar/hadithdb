'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const Index = require('../lib/Index');
const Tafsir = require('../lib/Tafsir');
const proxyRouter = require('../routes/proxy');

describe('Quran Study translation editing', () => {
  let server;
  let baseUrl;
  let originalDocsFromQueryFields;
  let originalSurahs;
  let originalCommentariesByAlias;

  beforeAll(done => {
    originalDocsFromQueryFields = Index.docsFromQueryFields;
    originalSurahs = global.surahs;
    originalCommentariesByAlias = global.commentariesByAlias;
    global.surahs = [{ num: 2, ayahs: 286 }];
    global.commentariesByAlias = new Map([[
      'study-test',
      [{ alias: 'study-test', source: 'local', hidden: 0, format: 'md' }]
    ]]);

    const app = express();
    app.use((req, res, next) => {
      if (req.get('x-edit-mode') === '1') {
        req.admin = true;
        req.editMode = true;
      }
      next();
    });
    app.use('/quran/api/proxy', proxyRouter);
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      done();
    });
  });

  afterAll(done => {
    Index.docsFromQueryFields = originalDocsFromQueryFields;
    global.surahs = originalSurahs;
    global.commentariesByAlias = originalCommentariesByAlias;
    server.close(done);
  });

  test('returns inline text and footnote edit data to the Study reader in edit mode', async () => {
    Index.docsFromQueryFields = jest.fn().mockResolvedValue([{
      commentary_alias: 'study-test',
      ordinal: 1,
      format: 'md',
      id: 8123,
      surah: 2,
      ayahFrom: 1,
      ayahTo: 1,
      text: '',
      text_en: 'Translated text[^1]',
      footnotes: '',
      footnotes_en: '[^1]: Translation note'
    }]);

    const response = await fetch(`${baseUrl}/quran/api/proxy/translations/local?src=study-test&s=2&a=1&lang=en&render=reader`, {
      headers: { 'x-edit-mode': '1' }
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(payload.entries).toHaveLength(1);
    expect(payload.entries[0].html).toContain('Translated text');
    expect(payload.entries[0].edit).toEqual({
      id: 8123,
      lang: 'en',
      format: 'md',
      text: 'Translated text[^1]',
      text_prop: 'commentary.text_en',
      footnotes: '[^1]: Translation note',
      footnotes_prop: 'commentary.footnotes_en'
    });
  });

  test('provides creatable empty editors for a missing translation row', async () => {
    Index.docsFromQueryFields = jest.fn().mockResolvedValue([]);

    const response = await fetch(`${baseUrl}/quran/api/proxy/translations/local?src=study-test&s=2&a=2&lang=en&render=reader`, {
      headers: { 'x-edit-mode': '1' }
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.entries).toHaveLength(1);
    expect(payload.entries[0].edit.id).toBe('new-commentary,study-test,2,2,2');
    expect(payload.entries[0].edit.text_prop).toBe('commentary.text_en');
    expect(payload.entries[0].edit.footnotes_prop).toBe('commentary.footnotes_en');
  });

  test('keeps editor markup private and exposes the default footnote field on Study targets', async () => {
    Index.docsFromQueryFields = jest.fn().mockResolvedValue([{
      commentary_alias: 'study-test',
      ordinal: 1,
      format: 'md',
      id: 8123,
      surah: 2,
      ayahFrom: 1,
      ayahTo: 1,
      text_en: 'Translated text',
      footnotes_en: ''
    }]);

    const response = await fetch(`${baseUrl}/quran/api/proxy/translations/local?src=study-test&s=2&a=1&lang=en&render=reader`);
    const payload = await response.json();
    const itemTemplate = fs.readFileSync(path.join(__dirname, '..', 'views', 'sub-views', 'quran_item.ejs'), 'utf8');
    const heroTemplate = fs.readFileSync(path.join(__dirname, '..', 'views', 'sub-views', 'quran_ayah_hero.ejs'), 'utf8');
    const client = fs.readFileSync(path.join(__dirname, '..', 'public', 'static', 'js', 'script.js'), 'utf8');
    const inlineEditor = fs.readFileSync(path.join(__dirname, '..', 'views', 'sub-views', 'scripts.ejs'), 'utf8');

    expect(payload.entries[0].edit).toBeUndefined();
    expect(itemTemplate).toContain('data-quran-default-translation-footnote-source');
    expect(heroTemplate).toContain('data-quran-default-translation-footnote-source');
    expect(heroTemplate).toContain('data-quran-selected-translation-footnotes="1"');
    expect(client).toContain("editor.className = '_e footnote l2 quran-study-translation-footnote-editor'");
    expect(client).toContain("target.classList.add('_e', 'quran-study-translation-editor')");
    expect(client).toContain('link.textContent = `[${number}]`;');
    expect(inlineEditor).toContain("const propStr = (($el.attr('data-prop')) || '').toString();");
    expect(inlineEditor).toContain("var id = $(this).attr('data-id');");
    expect(inlineEditor).toContain('var prop = propStr;');
    expect(inlineEditor).not.toContain("var prop = $(this).data('prop');");
    expect(client).toContain("link.setAttribute('aria-label', `Footnote ${number}`)");
    expect(client).not.toContain("editor_html");
    expect(inlineEditor).toContain("!$el.hasClass('quran-study-translation-editor')");
  });

  test('mirrors the preferred Study translation for a server-side redirect before rendering', () => {
    const client = fs.readFileSync(path.join(__dirname, '..', 'public', 'static', 'js', 'script.js'), 'utf8');
    const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'search.js'), 'utf8');

    expect(client).toContain("var QURAN_PREFERRED_TRANSLATION_COOKIE = 'quranPreferredTranslationAlias';");
    expect(client).toContain('setHadithCookie(QURAN_PREFERRED_TRANSLATION_COOKIE, alias, window.HADITH_SESSION_MAX_AGE);');
    expect(client).toContain('storeQuranSelectedTranslationAlias(preferredAlias);');
    expect(route).toContain('preferredQuranTranslationFromCookie(req)');
    expect(route).toContain('return res.redirect(302, appendQueryExcluding(req, Utils.quranUrl(req, preferredTranslationPath)');
  });

  test('renders saved translation Markdown and footnotes back into the inline Study fields', () => {
    const html = Tafsir.renderLocalCommentaryLanguage({
      id: 8123,
      format: 'md',
      text_en: 'Translated text[^1]',
      footnotes_en: '[^1]: Translation note'
    }, false, 'en', 'study-test');
    const updateRoute = fs.readFileSync(path.join(__dirname, '..', 'routes', 'update.js'), 'utf8');
    const client = fs.readFileSync(path.join(__dirname, '..', 'public', 'static', 'js', 'script.js'), 'utf8');
    const inlineEditor = fs.readFileSync(path.join(__dirname, '..', 'views', 'sub-views', 'scripts.ejs'), 'utf8');

    expect(html).toContain('class="footnote-ref"');
    expect(html).toContain('class="footnotes"');
    expect(html).toContain('Translation note');
    expect(html).not.toContain('[^1]');
    expect(updateRoute).toContain('status.commentaryRendered = {');
    expect(client).toContain('function applySavedQuranStudyCommentary(editor, entry)');
    expect(inlineEditor).toContain('window.applySavedQuranStudyCommentary(this, resBody.commentaryRendered)');
  });

  test('keeps every paragraph from a separate footnotes field inside one rendered footnote unit', () => {
    const html = Tafsir.renderLocalCommentaryLanguage({
      id: 554569,
      format: 'md',
      text_en: 'Translation[^1] and more[^2]',
      footnotes_en: [
        '[^1]: First note paragraph.',
        '',
        'Second paragraph of the first note.',
        '',
        '[^2]: Second note.'
      ].join('\n')
    }, false, 'en', 'unal');

    expect(html.match(/<section class="footnotes">/g)).toHaveLength(1);
    expect(html.match(/class="footnote-item"/g)).toHaveLength(2);
    expect(html).toMatch(/<li[^>]*class="footnote-item"><p>First note paragraph\.<\/p>\s*<p>Second paragraph of the first note\./);
    expect(html).not.toMatch(/<\/section>\s*<p>Second paragraph of the first note\./);
  });

  test('keeps Quran emphasis italic and reserves green emphasis styling for Hadith', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'static', 'css', 'style.css'), 'utf8');

    expect(css).toMatch(/\.quran-passage-section em,[\s\S]*\.quran-tafsirs em,[\s\S]*color: inherit;[\s\S]*font-style: italic;/);
    expect(css).toContain('.h .body em,');
    expect(css.lastIndexOf('.quran-passage-section em,')).toBeGreaterThan(css.indexOf('.heading-intro em,'));
  });
});
