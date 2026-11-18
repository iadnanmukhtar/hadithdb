'use strict';
const Content = require('../lib/ContentMarkdown');
const { load } = require('cheerio');
const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=60';
const source = `Opening [Lecture](${url}).\n\nClosing paragraph.`;

test.each([
  ['passages', text => require('../lib/Utils').markdownToHtml(text)],
  ['tafsir', text => require('../lib/Tafsir').renderCommentaryText(text, '', 'md')],
  ['notes', text => require('../lib/UserNotebook').render(text)],
  ['articles', text => require('../lib/Community').content(text, 280, { linkPreviews: false }).html],
  ['posts', text => require('../lib/Community').content(text).html]
])('%s append video links after the body', (_, render) => {
  const $ = load(render(source), null, false);
  expect($.root().children().last().hasClass('markdown-video-previews')).toBe(true);
  expect($('.markdown-video-preview')).toHaveLength(1);
  expect($('.markdown-video-preview').attr('href')).toBe(url);
  expect($('.markdown-video-copy strong').text()).toBe('Lecture');
  expect($('p a').attr('href')).toBe(url);
  expect($('.markdown-video-preview img').attr('src')).toContain('/dQw4w9WgXcQ/');
  expect($('iframe, video, .community-link-preview')).toHaveLength(0);
});
test('shows the description supplied in the Markdown link title as text', () => {
  const description = 'Introducing the Prophet ﷺ & his qualities <script>alert(1)</script>';
  const $ = load(Content.render(`[Seerah lecture](${url} "${description}")`));
  expect($('.markdown-video-copy strong').text()).toBe('Seerah lecture');
  expect($('.markdown-video-description').text()).toBe(description);
  expect($('.markdown-video-description script')).toHaveLength(0);
});
test('deduplicates video identities, supports bare URLs and multiple providers', () => {
  const $ = load(Content.render(`${source}\n\nhttps://youtu.be/dQw4w9WgXcQ\n\nhttps://vimeo.com/12345\n\nhttps://example.com/clip.mp4`));
  expect($('.markdown-video-preview')).toHaveLength(3);
});
test('ignores code, footnotes, hidden text and lookalike hosts', () => {
  const text = `\`${url}\`\n\n\`\`\`\n${url}\n\`\`\`\n\nFootnote[^1]\n\n[^1]: [Video](${url})\n\n[Fake](https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ)`;
  expect(Content.render(text)).not.toContain('markdown-video-previews');
  expect(require('../lib/MarkdownVideoPreviews')(`<div data-note-hidden="true"><a href="${url}">Hidden</a></div>`)).not.toContain('markdown-video-previews');
});
test('preview finishing is idempotent and does not pollute post excerpts', () => {
  const html = Content.render(source);
  expect(Content.finish(html, source)).toBe(html);
  expect(require('../lib/Community').content(source).excerpt).not.toContain('Watch video');
});
