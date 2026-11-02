'use strict';
jest.mock('../lib/GoogleAuth', () => ({ verifyRequest: jest.fn(async () => null) }));
jest.mock('../lib/UserAvatar', () => ({ decorateRows: jest.fn(async () => {}) }));
const createRouter = require('../routes/reflections');
const Markdown = require('../lib/ContentMarkdown');

test.each(['hadiths_comments', 'blog_comments'])('%s uses shared Arabic formatting for reader reflections', async table => {
  const text = 'قال رسول الله ﷺ\n\n==Highlight== and a note.[^1]\n\n[^1]: العربية';
  const rows = [{ id: 7, text, deleted: 0 }, { id: 8, text, deleted: 1 }];
  const originalQuery = global.query;
  global.query = jest.fn(async sql => sql.includes('FROM votes') ? [] : rows);
  try {
    const router = createRouter({ table, votesTable: 'votes', targetParam: 'id', targetColumn: 'targetId', debugName: 'test:reflections', parseTarget: () => ({ sql: '42' }), responseFields: () => ({}) });
    const handler = router.stack.find(layer => layer.route?.methods.get).route.stack[0].handle;
    const res = { json: jest.fn() }, next = jest.fn();
    await handler({ params: { id: '42' } }, res, next);
    expect(next).not.toHaveBeenCalled();
    const result = res.json.mock.calls[0][0];
    expect(result[0].html).toBe(Markdown.render(text, { footnoteIdPrefix: `reflection-${table}-7` }));
    expect(result[0].html).toContain('class="notebook-arabic"');
    expect(result[0].html).toContain('<mark>Highlight</mark>');
    expect(result[1].html).toBe('');
  } finally { global.query = originalQuery; }
});
