'use strict';
jest.mock('../lib/Model', () => ({ Item: {} }));
const Notebook = require('../lib/UserNotebook');

test('Discord subtext interrupts paragraphs and works inside quotes and lists', () => {
  const html = Notebook.render('Normal\n-# __small__ **bold**\nNormal again\n\n> -# نص عربي\n\n- Item\n  -# Detail');
  expect((html.match(/class="notebook-subtext"/g) || [])).toHaveLength(3);
  expect(html).toContain('<u><span class="notebook-underline">small</span></u> <strong>bold</strong>');
  expect(html).toContain('class="notebook-subtext" dir="rtl"');
  expect(Notebook.render('`-# literal`\n\n```\n-# literal\n```\n\n\\-# literal')).not.toContain('notebook-subtext');
});

test('supports the extended syntax guide examples', () => {
  const html = Notebook.render('| Left | Right |\n| :--- | ---: |\n| **bold** | text |\n\nTerm\n: Definition\n: Another definition\n\n- [x] Done\n- [ ] Pending\n\n~~old~~ ==new== H~2~O X^2^ :tent: :joy:\n\nhttps://example.com `https://literal.test`\n\nFootnote[^1]\n\n[^1]: Explanation\n\n```json\n{"safe": true}\n```');
  for (const fragment of ['<table>', 'text-align:right', '<dl>', '<dt dir="auto">Term', '<dd dir="auto">Definition', 'type="checkbox"', 'checked="" disabled=""', '<s>old</s>', '<mark>new</mark>', '<sub>2</sub>', '<sup>2</sup>', '⛺', '😂', 'href="https://example.com"', '<code>https://literal.test</code>', 'footnote-ref', 'hljs-attr']) expect(html).toContain(fragment);
});

test('heading IDs support safe local links and duplicate IDs', () => {
  const html = Notebook.render('### Section {#section}\n\n[Jump](#section)\n\n### Again {#section}\n\n### Unsafe {#x onclick=alert(1)}');
  expect(html).toContain('<h3 id="section"');
  expect(html).toContain('<h3 id="section-2"');
  expect(html).toContain('<a href="#section" rel="noopener noreferrer">Jump</a>');
  expect(html).not.toContain('id="x"');
});

test('extensions preserve code escaping and remove executable HTML', () => {
  const html = Notebook.render('```html\n<script>alert(1)</script>\n```\n\n<script>alert(2)</script>\n\n[x](javascript:alert(1))\n\n`H~2~O :joy: __text__`');
  expect(html).not.toContain('<script>');
  expect(html).not.toContain('href="javascript:');
  expect(html).toContain('<code>H~2~O :joy: __text__</code>');
});

test('native HTML supports inline formatting, block layouts, direction and Arabic fonts', () => {
  const html = Notebook.render('Inline <span style="color:red" title="a > b">red</span><br><sup>2</sup>\n\n<div><p dir="rtl">العربية English</p><details open><summary>More</summary><p>Details</p></details><table><tr><td colspan="2">Cell</td></tr></table><img src="https://example.com/a.png" alt="Image"></div>');
  for (const part of ['style="color:red"', 'title="a > b"', '<br>', '<sup>2</sup>', '<p dir="rtl">', 'class="notebook-arabic"', '<details open', '<summary>More</summary>', 'colspan="2"', 'alt="Image"']) expect(html).toContain(part);
});

test('native HTML strips executable markup, unsafe styles and app-control attributes', () => {
  const html = Notebook.render('<div><script>alert(1)</script><iframe src="https://evil.test"></iframe><svg><a href="javascript:alert(1)">x</a></svg><img src="javascript:alert(1)" onerror="alert(1)"><a href="javascript:alert(1)" onclick="alert(1)">Link</a><span style="color:red;position:fixed;background-image:url(https://evil.test)" data-notebook-wiki="Secret">Safe</span><button data-notebook-reference="bukhari:1">Fake</button></div>\n\nInline <img src=x onerror="alert(1)"> <span onclick="alert(1)">safe</span>');
  expect(html).not.toMatch(/<script|<iframe|<svg|<button|onerror|onclick|javascript:|position:|background-image|data-notebook/);
  expect(html).toContain('color:red');
  expect(html).toContain('Safe');
  expect(Notebook.render('`<span>literal</span>`\n\n```html\n<img src=x onerror=alert(1)>\n```')).not.toMatch(/<img|<span>literal/);
});

test.each([1, 2, 3, 4, 5, 6])('parallel heading H%s applies its level to the second column', level => {
  const { load } = require('cheerio');
  for (const secondary of ['Translation', '###### Translation']) {
    const $ = load(Notebook.render(`${'#'.repeat(level)} عنوان || ${secondary}`));
    expect($('.notebook-parallel-cell').eq(0).children()[0].tagName).toBe(`h${level}`);
    expect($('.notebook-parallel-cell').eq(1).children()[0].tagName).toBe(`h${level}`);
  }
  expect(Notebook.render('Normal || Normal')).not.toMatch(/<h[1-6]/);
});
