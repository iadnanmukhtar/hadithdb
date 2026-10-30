const ejs = require('ejs');
const {JSDOM} = require('jsdom');
const path = require('path');

test.each(['note', 'article'])('renders shared %s controls without a permalink', async kind => {
  const html = await ejs.renderFile(path.resolve('views/sub-views/community_post_actions.ejs'), {post: {
    id: 44, kind, url: '/community/p/example', title: 'Example', author: {handle: 'author', name: 'Author'}
  }});
  const dom = new JSDOM(html);
  try {
    const document = dom.window.document;
    expect(document.querySelector('[data-community-share-url]').dataset.communityShareUrl).toBe('/community/p/example');
    expect(document.querySelector('#community-report-post')).not.toBeNull();
    expect(document.querySelector('#community-blog-control, #community-blog-toggle')).toBeNull();
    expect(document.querySelector('#community-edit-post').getAttribute('href')).toBe(kind === 'note' ? '/community/mine?editPost=44' : '/community/write?post=44');
    expect(document.querySelector('[title="Post permalink"], .bi-arrow-right')).toBeNull();
  } finally { dom.window.close(); }
});
