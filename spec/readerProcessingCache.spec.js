'use strict';

jest.mock('../lib/NotebookDirection', () => jest.fn(jest.requireActual('../lib/NotebookDirection')));
const normalize = require('../lib/NotebookDirection');
const Content = require('../lib/ContentMarkdown');

test('reader cache reuses rendering and keeps text, speech and footnote identities distinct', () => {
  const text = '*Speech* with a note[^1].\n\n[^1]: Note';
  const first = { propheticSpeech: true, footnoteIdPrefix: 'cache-reader-a' };
  const output = Content.renderCached(text, first);
  normalize.mockClear();
  try {
    expect(Content.renderCached(text, first)).toBe(output);
    expect(normalize).not.toHaveBeenCalled();
    for (const [value, options] of [[text, {...first, propheticSpeech: false}], [text, {...first, footnoteIdPrefix: 'cache-reader-b'}], [text + ' changed', first]]) {
      expect(Content.renderCached(value, options)).toBe(Content.render(value, {...options}));
      expect(Content.renderCached(value, options)).not.toBe(output);
    }
  } finally { normalize.mockClear(); }
});

test('reader cache evicts older entries and bypasses mutable environments', () => {
  // Exact output remains stable even after more than the cache entry limit.
  const text = 'Eviction witness';
  const expected = Content.renderCached(text);
  for (let i = 0; i < 520; i++) Content.renderCached('Entry ' + i);
  normalize.mockClear();
  expect(Content.renderCached(text)).toBe(expected);
  expect(normalize).toHaveBeenCalledTimes(1);
  const env = {};
  expect(Content.renderCached('Note[^1]\n\n[^1]: Footnote', { footnotes: env }))
    .toBe(Content.render('Note[^1]\n\n[^1]: Footnote', { footnotes: {} }));

});

test('action metadata is read-only when current, but updates changes and rejects removed sources', async () => {
  const Items = require('../lib/ContentItems');
  const Sharh = require('../lib/Sharh');
  const source = jest.spyOn(Sharh, 'entryById').mockResolvedValue({entry:{title_en:'Title'},book:{alias:'test'},canonical:'/sharh/test/bukhari:1'});
  const previous = global.query;
  let item = {id:9,source_key:'sharh:42',title:'Title',url:'/sharh/test/bukhari:1#note-sharh-42'};
  global.query = jest.fn(async query => query.startsWith('SELECT * FROM content_items') ? [item] : []);
  try {
    await Items.resolve('sharh:42');
    global.query.mockClear();
    expect(await Items.resolve('sharh:42')).toEqual(item);
    expect(global.query.mock.calls).toHaveLength(1);
    expect(global.query.mock.calls[0][0]).toMatch(/^SELECT /);
    item = {...item,title:'Old title'};
    await Items.resolve('sharh:42');
    expect(global.query.mock.calls.some(([q]) => q.startsWith('INSERT INTO content_items'))).toBe(true);
    source.mockResolvedValue(null);
    await expect(Items.resolve('sharh:42')).rejects.toMatchObject({status:404});
  } finally { source.mockRestore(); global.query = previous; }
});
