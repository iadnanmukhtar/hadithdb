'use strict';

const fs = require('fs');
const path = require('path');

describe('blog infinite scroll', () => {
  const template = fs.readFileSync(path.join(__dirname, '..', 'views', 'blog.ejs'), 'utf8');
  const scripts = fs.readFileSync(path.join(__dirname, '..', 'public', 'static', 'js', 'script.js'), 'utf8');
  const blogInfiniteScroll = scripts.slice(
    scripts.indexOf('function initBlogInfiniteScroll'),
    scripts.indexOf('function initStickyFooterScrollFade')
  );

  test('publishes paginated URLs with the shared status and sentinel controls', () => {
    expect(template).toContain('data-blog-infinite="1"');
    expect(template).toContain('data-blog-current-url=');
    expect(template).toContain('data-blog-next-url=');
    expect(template).toContain('data-blog-infinite-status');
    expect(template).toContain('data-blog-infinite-sentinel');
  });

  test('continues loading while a fast scroll leaves the sentinel in the preload zone', () => {
    expect(blogInfiniteScroll).toContain('function () {\n\t\t\tif (!nextUrl || !sentinelNeedsMoreContent())');
    expect(blogInfiniteScroll).toContain('getBoundingClientRect().top <= viewportHeight + preloadDistance');
    expect(blogInfiniteScroll).toContain('if (loaded)\n\t\t\t\t\tscheduleNextIfNeeded();');
    expect(blogInfiniteScroll).toContain('if (!loadingPromise && nextUrl && sentinelNeedsMoreContent())');
  });
});
