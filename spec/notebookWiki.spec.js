'use strict';
const MarkdownIt = require('markdown-it');
const Wiki = require('../lib/NotebookWiki');
const Autocomplete = require('../public/static/js/notebook-wiki');
const md = new MarkdownIt({ html: false }); Wiki.install(md);

test('wiki links preserve titles and aliases as safe text', () => {
  const html = md.render('[[My note]] and [[My note|short alias]] and [[العربية|تذكير]]');
  expect(html).toContain('data-notebook-wiki="My note"');
  expect(html).toContain('href="/notebook?note=My%20note"');
  expect(html).toContain('>short alias</a>');
  expect(html).toContain('>تذكير</a>');
  const unsafe = md.render('[[<img src=x>|<script>alert(1)</script>]]');
  expect(unsafe).not.toContain('<script>'); expect(unsafe).not.toContain('<img');
});
test.each(['`[[Title]]`', '```\n[[Title]]\n```', '\\[[Title]]', '[outer [[Title]]](https://example.com)', '[[]]', '[[Title| ]]'])('does not link literal or invalid syntax: %s', text => {
  expect(md.render(text)).not.toContain('data-notebook-wiki');
});
test('autocomplete starts at two characters, ignores aliases and escaped brackets, and respects cursor', () => {
  expect(Autocomplete.context('[[T', 3)).toBeNull();
  expect(Autocomplete.context('[[', 2)).toBeNull();
  expect(Autocomplete.context('[[Ti', 4)).toMatchObject({ query: 'Ti', start: 0 });
  expect(Autocomplete.context('[[عل', 4)).toMatchObject({ query: 'عل' });
  expect(Autocomplete.context('[[Title|al', 10)).toBeNull();
  expect(Autocomplete.context('\\[[Ti', 5)).toBeNull();
  expect(Autocomplete.context('prefix [[Ti suffix', 11)).toMatchObject({ query: 'Ti', start: 7 });
});
test('selection completes wiki links without duplicate brackets and preserves an existing alias', () => {
  for (const text of ['[[Ti', '[[Ti]]', '[[Title|alias]]']) {
    const edit = Autocomplete.replacement(text, Autocomplete.context(text, 4), 'Title');
    const output = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
    expect(output).toBe(text.includes('|') ? '[[Title|alias]]' : '[[Title]]');
  }
});
