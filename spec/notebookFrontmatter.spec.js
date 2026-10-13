'use strict';
jest.mock('../lib/Model', () => ({ Item: { itemFromRef: jest.fn() } }));
const Frontmatter = require('../lib/NotebookFrontmatter');
const Notebook = require('../lib/UserNotebook');
const Drive = require('../lib/NotebookDrive');
const note = markdown => ({ source_key: 'general', source_title: 'General note', source_url: '/notebook', title: 'My note', tags: ['study'], markdown });
test.each(['\n', '\r\n'])('custom YAML and exact body whitespace round trip in one Drive header (%j)', eol => {
  const markdown = ['---', '# Keep this comment', 'author: "أحمد"', 'topic:', '  name: Patience', '  reviewed: false', 'attachments: []', '---', '', '', 'Body', ''].join(eol);
  const encoded = Drive.encode(note(markdown));
  expect(Frontmatter.parse(encoded, true).attributes.author).toBe('أحمد');
  expect(Frontmatter.parse(encoded, true).body).toBe(eol + eol + 'Body' + eol);
  expect(Drive.decode(encoded, 'general')).toMatchObject(note(markdown));
  expect(Drive.decode(encoded, 'general').markdown).not.toContain('hadithunlocked');
});
test('preview and hashtags exclude YAML, while downloads retain custom fields in one header', () => {
  const markdown = '---\nauthor: أحمد\ninternal: "#private"\ntitle: Custom export title\nattachments: []\n---\n\nVisible #study';
  expect(Notebook.render(markdown)).toContain('Visible');
  expect(Notebook.render(markdown)).not.toContain('أحمد');
  expect(Notebook.hashtags(markdown)).toEqual(['study']);
  const exported = Frontmatter.parse(Notebook.exportMarkdown(note(markdown)));
  expect(exported.attributes).toMatchObject({ author: 'أحمد', title: 'Custom export title', links: [], reference: 'general', tags: ['study'] });
  expect(exported.body).toBe('\nVisible #study');
});
test('attachment controls preserve custom values and the exact Markdown body', () => {
  const markdown = '---\nauthor: أحمد\ncustom:\n  count: 2\n  enabled: true\nattachments: []\n---\n\nBody\n';
  const updated = Frontmatter.parse(Frontmatter.withAttachments(markdown, ['bukhari:1', 'quran:2:255']));
  expect(updated.attributes).toEqual({ author: 'أحمد', custom: { count: 2, enabled: true }, links: ['bukhari:1', 'quran:2:255'] });
  expect(updated.body).toBe('\nBody\n');
});
test.each(['---\nauthor: [\n---\nBody', '---\nkey: value', '---\n- list\n---\nBody', '---\nhadithunlocked: {}\n---\nBody'])('invalid or reserved frontmatter fails clearly: %s', markdown => {
  expect(() => Frontmatter.parse(markdown)).toThrow();
});

test.each(['', '\n\n', '\uFEFF\r\n'])('download merges generated metadata and consecutive frontmatter blocks (%j)', prefix => {
  const body = '\nالنص\n\n---\n\nA normal Markdown divider remains.\n';
  const markdown = prefix + '---\ntitle: Export title\ntags: [custom]\nattachments: [bukhari:1]\n---\n\n---\nauthor: أحمد\ntags: [custom, second]\nattachments: [quran:2:255]\ncustom:\n  reviewed: false\n---\n' + body;
  const result = Notebook.exportMarkdown(note(markdown));
  const parsed = Frontmatter.parse(result);
  expect(parsed.attributes).toEqual({ title: 'Export title', reference: 'general', tags: ['study', 'custom', 'second'], links: ['bukhari:1', 'quran:2:255'], author: 'أحمد', custom: { reviewed: false } });
  expect(parsed.body).toBe(body);
  expect(result.match(/^---$/gm)).toHaveLength(3); // One header pair and the body divider.
});

test('downloads merge legacy attachments and links from consecutive headers into one links list', () => {
  const exported = Frontmatter.parse(Notebook.exportMarkdown(note('---\nattachments: [bukhari:1]\n---\n---\nlinks: [bukhari:1, quran:2:255]\n---\nBody')));
  expect(exported.attributes.links).toEqual(['bukhari:1', 'quran:2:255']);
  expect(exported.attributes).not.toHaveProperty('attachments');
  expect(exported.body).toBe('Body');
});
