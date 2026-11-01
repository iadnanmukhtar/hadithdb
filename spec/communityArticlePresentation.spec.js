'use strict';
const ejs = require('ejs');
const fs = require('fs');
const path = require('path');
const {load} = require('cheerio');
const Community = require('../lib/Community');
const row = {id: 42, kind: 'article', public_title: 'An article', public_subtitle: 'A subtitle', public_markdown: '## Heading\n\nالعربية\n\n[Source](https://example.com/source)\n\n![Image](https://example.com/image.jpg)', published_at: new Date('2026-10-31T12:00:00Z'), name: 'Author', handle: 'author'};
function render(post) {
  const file = path.resolve('views/community.ejs');
  return ejs.render(fs.readFileSync(file, 'utf8'), {view:'post', post, author:post.author, page:{}, global:{settings:{site:{}}}, utils:{scriptAssetVersion:()=> 'test'}, include:(name, data)=>name.endsWith('blog_cover.ejs') ? ejs.render(fs.readFileSync(path.resolve('views',name),'utf8'),data) : ''}, {filename:file});
}
test('articles keep their cover and use post body rendering while preserving links and images', () => {
  const post=Community.postView(row), $=load(render(post));
  expect($('.community-article-layout > main.community-article')).toHaveLength(1);
  expect($('h1')).toHaveLength(1);
  expect($('.blog-cover-hero h1').text()).toBe(row.public_title);
  expect($('.blog-cover-hero .community-cover-subtitle').text()).toBe(row.public_subtitle);
  expect($('[data-article-body].notebook-markdown.community-reflection-body a').attr('href')).toBe('https://example.com/source');
  expect($('[data-article-body] img').attr('src')).toBe('https://example.com/image.jpg');
  expect($('[data-article-body]').text()).toContain('العربية');
  expect($('.community-link-preview, article.community-card, #community-author-profile')).toHaveLength(0);
});
test('short posts retain their layout and standalone link previews', () => {
  const $=load(render(Community.postView({...row,kind:'note'})));
  expect($('article.community-card')).toHaveLength(1);
  expect($('#community-author-profile')).toHaveLength(1);
  expect($('.community-link-preview')).toHaveLength(1);
  expect($('.blog-cover-hero')).toHaveLength(0);
});
test('article editor preview retains ordinary links', async () => {
  const media=require('../lib/CommunityMedia');
  expect((await media.prepare(row.public_markdown,'article')).html).not.toContain('community-link-preview');
  expect((await media.prepare(row.public_markdown,'note')).html).toContain('community-link-preview');
});
