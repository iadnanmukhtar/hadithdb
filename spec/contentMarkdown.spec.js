'use strict';
const Content = require('../lib/ContentMarkdown');
const Notebook = require('../lib/UserNotebook');
const Tafsir = require('../lib/Tafsir');
const Utils = require('../lib/Utils');
const { load } = require('cheerio');

test.each([
  '__Underlined__ ==highlight== H~2~O x^2^',
  '- [x] Complete\n- [ ] Pending',
  '| English | العربية |\n| --- | --- |\n| Text | نص |',
  '> العربية\n>\n> - عنصر\n>   - فرع',
  'Term\n: Definition',
  '# Heading {#custom}\n\n-# Small print',
  '```js\nconst x = 1;\n```',
  '# English || العربية',
  '@[toc]\n\n# Heading\n\n## Subheading',
  '<details><summary>More</summary>\n\n**Details**\n\n</details>'
])('source readers share notebook formatting: %s', markdown => {
  const expected = Notebook.render(markdown);
  expect(Content.render(markdown)).toBe(expected);
  expect(Utils.markdownToHtml(markdown)).toBe(expected.trim());
  expect(Tafsir.renderCommentaryText(markdown, '', 'md', { markArabicOnlyBlocks: false })).toBe(expected);
});

test('keeps linked citations, Arabic footnote labels and separate commentary namespaces', () => {
  const markdown = 'Text [^[Source](https://example.com)] and Arabic[^٢].\n\n[^٢]: العربية';
  for (const prefix of ['tafsir-1', 'sharh-2', 'intro-3']) {
    const $ = load(Tafsir.renderCommentaryText(markdown, '', 'md', { footnoteIdPrefix: prefix }));
    expect($('.footnotes a[href="https://example.com"]').text()).toBe('Source');
    expect($('.footnote-ref').last().text()).toBe('[٢]');
    $('.footnote-ref a').each((_, a) => expect($(a).attr('href')).toMatch(new RegExp('^#' + prefix + '-fn')));
  }
});

test('safe HTML and soft breaks retain block structure in source readers', () => {
  const $ = load(Tafsir.renderCommentaryText('First\nsecond\n\n<script>alert(1)</script>\n\n<img src="x" onerror="alert(1)">', '', 'md'));
  expect($('p').first().find('br')).toHaveLength(1);
  expect($('p').first().text()).toContain('second');
  expect($('script, [onerror]')).toHaveLength(0);
});

test('source renderer does not add private notebook reference controls', () => {
  expect(Content.render('bukhari:1')).not.toContain('notebook-expand-reference');
  expect(Content.render('[[My note]]')).not.toContain('data-notebook-wiki');
  expect(Notebook.render('[[My note]]')).toContain('data-notebook-wiki');
});

test('virtual footnotes receive independent link targets', () => {
  for (const prefix of ['virtual-1-ar', 'virtual-2-en']) {
    const $ = load(Utils.markdownToHtml('Text[^1]\n\n[^1]: Note', { footnoteIdPrefix: prefix }));
    expect($('.footnote-ref a').attr('href')).toBe('#fn-' + prefix + '-1');
    expect($('.footnote-item').attr('id')).toBe('fn-' + prefix + '-1');
  }
});

 test('source speech and ordinary italics retain distinct semantics in both languages', () => {
  const markdown = '*Quotation حديث ﷺ* and _Italics نص_';
  for (const html of [Utils.markdownToHtml(markdown), Tafsir.renderCommentaryText(markdown, '', 'md')]) {
    const $ = load(html);
    expect($('em.source-prophetic-speech').text()).toBe('Quotation حديث ﷺ');
    expect($('em.source-italic').text()).toBe('Italics نص');
  }
  expect(Content.render(markdown)).not.toContain('source-prophetic-speech');
  expect(Notebook.render(markdown)).not.toContain('source-prophetic-speech');
});
