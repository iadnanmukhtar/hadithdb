'use strict';
const Mcp = require('../lib/HadithMcp');
const Community = require('../lib/Community');
const Research = require('../lib/HadithMcpResearch');
const context = { baseUrls: { hadith: 'https://hadith.example', quran: 'https://quran.example' } };
const row = (id, extra = {}) => ({ id, public_title: 'الاستخارة', public_markdown: 'How to pray istikharah',
  name: 'Author', handle: 'author', slug: 'Istikharah', published_at: '2026-10-01', updated_at: '2026-10-02', ...extra });
beforeEach(() => jest.spyOn(Community, 'ensure').mockResolvedValue());
afterEach(() => jest.restoreAllMocks());

test('blog search reads only published public blog snapshots, escapes LIKE wildcards and preserves identity', async () => {
  const sql = jest.spyOn(Community, 'sql').mockResolvedValue([row(8)]);
  const response = await Mcp.callTool('search_blog', { query: 'الاستخارة 100%_!' }, context);
  const [statement, values] = sql.mock.calls[0];
  expect(statement).toContain('FROM community_blog_posts');
  expect(statement).toContain("p.status='published' AND p.kind='article'");
  expect(statement).not.toMatch(/p\.(markdown|title)\b/);
  expect(values).toEqual(['%الاستخارة%', '%الاستخارة%', '%100!%!_!!%', '%100!%!_!!%', 100, 0]);
  expect(response.structuredContent.results[0]).toMatchObject({ id: 8, author: 'Author',
    url: 'https://hadith.example/blog/Istikharah', source_type: 'editorial_blog', text: 'How to pray istikharah' });
  expect(JSON.parse(response.content[0].text)).toEqual(response.structuredContent);
});

test('blog cursors return distinct pages and reject a changed query', async () => {
  jest.spyOn(Community, 'sql').mockResolvedValue([row(1), row(2), row(3)]);
  const first = (await Mcp.callTool('search_blog', { query: 'prayer', limit: 2 }, context)).structuredContent;
  expect(first.pagination).toMatchObject({ has_more: true, total_available: 3, total_is_exact: true });
  const second = (await Mcp.callTool('search_blog', { query: 'prayer', cursor: first.pagination.next_cursor }, context)).structuredContent;
  expect(second.results.map(post => post.id)).toEqual([3]);
  await expect(Mcp.callTool('search_blog', { query: 'fasting', cursor: first.pagination.next_cursor }, context)).rejects.toThrow('Invalid search cursor');
});

test('exact blog lookup keeps canonical community URLs and full Markdown with profile bounds', async () => {
  const sql = jest.spyOn(Community, 'sql').mockResolvedValue([row(9, { slug: null, public_markdown: 'ع'.repeat(7000) })]);
  const normal = (await Mcp.callTool('lookup_blog_post', { id: 9 }, context)).structuredContent.post;
  expect(sql.mock.calls[0][0]).toContain('AND p.id=?');
  expect(sql.mock.calls[0][1]).toEqual([9]);
  expect(normal).toMatchObject({ url: 'https://hadith.example/community/@author/9', truncated: true });
  expect(normal.text).toHaveLength(6000);
  const full = (await Mcp.callTool('lookup_blog_post', { id: 9, response_profile: 'full' }, context)).structuredContent.post;
  expect(full.text).toHaveLength(7000);
  expect(full.truncated).toBe(false);
  sql.mockResolvedValue([]);
  await expect(Mcp.callTool('lookup_blog_post', { id: 9 }, context)).rejects.toThrow('was not found');
});

test.each(['research_islamic_topic', 'research_quran_ayah'])('%s consults blog and retrieves articles with editorial attribution', async name => {
  const call = jest.fn(async tool => ({ structuredContent: tool === 'search_blog' ? { results: [{ id: 8 }] }
    : tool === 'lookup_blog_post' ? { post: { id: 8, source_type: 'editorial_blog', author: 'Author', text: 'Context' } }
    : tool === 'lookup_quran_ayah' ? { ayah: { reference: 'quran:3:159' } } : { results: [] } }));
  const args = name === 'research_quran_ayah' ? { surah: 3, ayah: 159, concepts: ['prayer'] } : { question: 'Prayer', queries: ['prayer'] };
  const dossier = await Research.research(name, args, context, call);
  expect(dossier.coverage.blog).toBe('found');
  expect(dossier.evidence.find(entry => entry.tool === 'search_blog').relationship).toBe('editorial_blog_candidate');
  expect(dossier.evidence.find(entry => entry.tool === 'lookup_blog_post')).toMatchObject({
    relationship: 'editorial_blog_context', data: { post: { author: 'Author', source_type: 'editorial_blog' } } });
});

test('blog outage remains unavailable while other research sources survive', async () => {
  const call = jest.fn(async tool => {
    if (tool === 'search_blog') throw new Error('Blog unavailable');
    return { structuredContent: { results: [] } };
  });
  const dossier = await Research.research('research_islamic_topic', { question: 'Prayer', queries: ['prayer'] }, context, call);
  expect(dossier.coverage.blog).toBe('unavailable');
  expect(dossier.evidence.find(entry => entry.tool === 'search_quran').status).toBe('searched_no_match');
});

test.each([['search_blog', { query: ' ' }], ['lookup_blog_post', { id: '8' }]])('validates %s inputs', async (name, args) => {
  await expect(Mcp.callTool(name, args, context)).rejects.toThrow();
});
