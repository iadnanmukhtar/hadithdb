'use strict';
const Content = require('../lib/ContentMarkdown');
const Notebook = require('../lib/UserNotebook');
const Tafsir = require('../lib/Tafsir');
const {load} = require('cheerio');

test.each(['note', 'warning', 'tip', 'important', 'custom'])('renders %s callouts as a titled panel without authoring markers', kind => {
  const source = `> [!${kind}] A **title** {.callout}\n> Body with *emphasis*\n>\n> - First\n> - Second`;
  for (const html of [Content.render(source), Notebook.render(source), Tafsir.renderCommentaryText(source, '', 'md')]) {
    const $ = load(html);
    expect($(`blockquote.markdown-callout-${kind}`)).toHaveLength(1);
    expect($('.markdown-callout-title').text()).toBe('A title');
    expect($('.markdown-callout-title strong').text()).toBe('title');
    expect($('.markdown-callout li')).toHaveLength(2);
    expect($.text()).not.toMatch(/\[!|\{\.callout\}/);
  }
});

test('marker-only titles, Arabic titles and legacy callout attributes', () => {
  let $ = load(Content.render('> [!note]\n> Body'));
  expect($('.markdown-callout-title').text()).toBe('Note');
  expect($('.markdown-callout p').last().text()).toBe('Body');
  $ = load(Content.render('> [!warning] تنبيه\n> نص عربي {.callout}'));
  expect($('.markdown-callout-title').text()).toBe('تنبيه');
  expect($('.markdown-callout').attr('dir')).toBe('rtl');
  $ = load(Content.render('> Legacy title\n> Body {.callout}'));
  expect($('.markdown-callout-title').text()).toBe('Legacy title');
});

test('ordinary quotes, escaped markers and code remain literal', () => {
  expect(Content.render('> Ordinary quote')).not.toContain('markdown-callout');
  expect(Content.render('> \\[!note] literal')).not.toContain('markdown-callout');
  const $ = load(Content.render('```md\n> [!warning] Title {.callout}\n```'));
  expect($('code').text()).toContain('[!warning] Title {.callout}');
});

test('bilingual callouts keep their title and Arabic list in one uninterrupted panel', () => {
  const source = '> [!warning] Did you know? Qiyam should be done every night: Witr is Qiyam! {.callout}\n> - «مَنْ خَافَ أَنْ لاَ يَقُومَ مِنْ آخِرِ اللَّيْلِ فَلْيُوتِرْ أَوَّلَهُ\n>   **وَمَنْ طَمِعَ أَنْ يَقُومَ آخِرَهُ فَلْيُوتِرْ آخِرَ اللَّيْلِ**» [مسلم 755a](https://hadithunlocked.com/muslim:755a)';
  for (const html of [Content.render(source), Notebook.render(source), Tafsir.renderCommentaryText(source,'','md')]) {
    const $=load(html);
    expect($('.markdown-callout')).toHaveLength(1);
    expect($('.markdown-callout > .markdown-callout-title')).toHaveLength(1);
    expect($('.markdown-callout > ul > li').attr('dir')).toBe('rtl');
    expect($('.markdown-callout').attr('dir')).toBe('ltr');
    expect($('.markdown-callout a').attr('href')).toContain('muslim:755a');
  }
  expect(load(Content.render('> English\n>\n> العربية'))('blockquote')).toHaveLength(2);
});
