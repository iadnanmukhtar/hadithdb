'use strict';
const Community = require('../lib/Community');
global.books = [{ alias: 'bukhari' }];
test('publication strips frontmatter, private destinations, notebook controls, and executable HTML while preserving bilingual content', () => {
  const result = Community.content('---\ntitle: Private title\nsecret: hidden metadata\n---\n# العربية\n\nEnglish **reflection**\n\n[[Private note|Visible label]]\n\n[Private Drive file](https://drive.google.com/file/d/secret/view)\n\n[Notebook](/notebook?note_source=secret)\n\n<script>alert(1)</script><img src=x onerror=alert(1)>\n\n[Source](/bukhari:1)');
  expect(result.html).toContain('العربية'); expect(result.html).toContain('<strong>reflection</strong>');
  expect(result.html).toContain('Visible label'); expect(result.html).toContain('/bukhari:1');
  for (const value of ['hidden metadata', 'Private title', 'Private note', 'drive.google', 'note_source', 'onerror', '<script', 'data-notebook-wiki', 'data-notebook-reference']) expect(result.html).not.toContain(value);
});
test('IDs reject coercion, unsafe values, and SQL fragments', () => {
  for (const value of ['1 OR 1=1', '0', '-1', '1.5', '1e3', '9007199254740992', null, {}, '1;DROP TABLE']) expect(() => Community.id(value)).toThrow();
  expect(Community.id('42')).toBe(42);
});
test('moderator identity comes only from explicit verified UID configuration', () => {
  const old = process.env.COMMUNITY_MODERATOR_UIDS; process.env.COMMUNITY_MODERATOR_UIDS = 'alice, bob';
  expect(Community.moderator({ uid: 'alice' })).toBe(true);
  expect(Community.moderator({ uid: 'mallory', admin: true, email: 'alice' })).toBe(false);
  expect(Community.moderator(null)).toBe(false);
  if (old === undefined) delete process.env.COMMUNITY_MODERATOR_UIDS; else process.env.COMMUNITY_MODERATOR_UIDS = old;
});
test('public post representation excludes owner identity, draft body, draft status, and revision metadata', () => {
  const post = Community.postView({ id: 1, kind: 'article', title: 'Private draft title', subtitle: 'Private subtitle', public_subtitle: 'Published subtitle', markdown: 'Unpublished changes', tags: 'private tag', status: 'draft', version: 17, author_uid: 'private-uid', name: 'Author', handle: 'author', public_title: 'Published title', public_markdown: 'Published body', public_tags: 'public tag', published_at: new Date() });
  expect(post.subtitle).toBe('Published subtitle'); expect(post.title).toBe('Published title'); expect(post.html).toContain('Published body');
  expect(JSON.stringify(post)).not.toMatch(/Unpublished|Private draft|private tag|private-uid|version|status/);
});
