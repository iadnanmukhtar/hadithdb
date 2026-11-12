'use strict';
const Community = require('../lib/Community');
const Sitemap = require('../lib/CommunitySitemap');
const BlogImport = require('../lib/CommunityBlogImport');
afterEach(()=>jest.restoreAllMocks());
test('all published articles have canonical URLs independently of feed placement or Blog feature status', async()=>{
  jest.spyOn(Community,'ensure').mockResolvedValue();
  const sql=jest.spyOn(Community,'sql').mockResolvedValue([
    {id:1,guid:'483bb19c-9951-46fd-8f61-e07a1196e6ee',handle:'author',published_at:'2025-01-01T00:00:00Z',public_updated_at:'2025-02-01T00:00:00Z'},
    {id:2,slug:'An article',published_at:'2025-01-02T00:00:00Z'}
  ]);
  const entries=await Sitemap.entries();
  expect(entries.map(entry=>entry.path)).toEqual(['/community/p/483bb19c-9951-46fd-8f61-e07a1196e6ee','/blog/An%20article']);
  expect(entries[0].modified).toBe('2025-02-01T00:00:00.000Z');
  expect(sql.mock.calls[0][0]).toContain("p.status='published' AND p.kind='article'");
  expect(sql.mock.calls[0][0]).not.toContain('community_blog_posts');
  expect(sql.mock.calls[0][0]).not.toContain('LIMIT');
  expect(await BlogImport.publicUrls()).toEqual(entries.map(entry=>entry.path));
  await Sitemap.entries({recent:true});
  expect(sql.mock.calls.at(-1)[0]).toContain('LIMIT 1000');
});
