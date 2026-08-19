/* jslint node:true, esversion:9 */
'use strict';

const debug = require('../lib/Debug')('hadithdb:Blog');
const express = require('express');
const fs = require('fs');
const createError = require('http-errors');
const fm = require('front-matter');
const markdownit = require('markdown-it');
const markdownitfence = require('markdown-it-fence')
const HttpRange = require('../lib/HttpRange');

const router = express.Router();
const BLOG_PLACEHOLDER_COVER = '/static/img/pearls_of_the_deep.jpg';

router.get('/', async function (req, res, next) {

  res.locals.req = req;
  res.locals.res = res;

  var pageSize = global.settings.blog.itemsPerPage || 5;
  var requestedOffset;
  try {
    requestedOffset = HttpRange.parseOffset(req.query.o);
  } catch (err) {
    return next(err);
  }
  var offset = Math.floor(Math.max(0, requestedOffset) / pageSize) * pageSize;

  var posts = [];
  const files = fs.readdirSync(global.settings.blog.dir);
  for (var file of files) {
    if (file.endsWith('.md')) {
      try {
        const { attributes } = fm(fs.readFileSync(`${global.settings.blog.dir}/${file}`).toString());
        var post = new Object(attributes);
        post.file = file.replace(/.md$/, '');
        applyCoverFallback(post);
        if (!post.hidden)
          posts.push(post);
      } catch (e) {
        debug(`Unable to read ${file}`);
      }
    }
  }
  posts.sort((a, b) => {
    return b.published - a.published;
  });
  var offsetError = HttpRange.itemOffsetNotSatisfiable(requestedOffset, posts.length, 'Blog');
  if (offsetError)
    return next(offsetError);

  var pagination = {
    offset: offset,
    number: Math.floor(offset / pageSize) + 1,
    hasPrev: offset > 0,
    prevOffset: ((offset - pageSize) < 0) ? 0 : offset - pageSize,
    hasNext: (offset + pageSize) < posts.length,
    nextOffset: offset + pageSize,
  };
  if (!pagination.hasNext)
    delete pagination.nextOffset;

  posts = posts.slice(offset, offset + pageSize);

  res.render('blog', {
    posts: posts,
    pagination: pagination
  });

});

router.get('/feed', async function (req, res, next) {
  res.setHeader('Content-Type', 'application/atom+xml; charset=UTF-8');
  res.setHeader('Content-Disposition', `inline; filename="${global.settings.blog.shortName}_atom.xml"`);
  res.locals.req = req;
  res.locals.res = res;
  var posts = getPosts();
  res.render('blog_feed', {
    posts: posts
  });
});

router.get('/rss', async function (req, res, next) {
  res.setHeader('Content-Type', 'application/rss+xml; charset=UTF-8');
  res.setHeader('Content-Disposition', `inline; filename="${global.settings.blog.shortName}_rss.xml"`);
  res.locals.req = req;
  res.locals.res = res;
  var posts = getPosts();
  res.render('blog_rss', {
    posts: posts
  });
});

router.get('/:title', async function (req, res, next) {

  res.locals.req = req;
  res.locals.res = res;

  const slug = req.params.title;
  const filename = `${global.settings.blog.dir}/${slug}.md`;
  if (fs.existsSync(filename)) {

    const { attributes, body } = fm(fs.readFileSync(filename).toString());
    const attr = applyCoverFallback(new Object(attributes));
    const html = renderHtml(body);

    res.render('blog_post', {
      attr: attr,
      body: html,
      slug
    });

  } else {
    debug(`Post ${filename} not found`);
    return next(createError(404, 'Post not found'));
  }

});

module.exports = router;

function getPosts() {
  var posts = [];
  const files = fs.readdirSync(global.settings.blog.dir);
  for (var file of files) {
    if (file.endsWith('.md')) {
      try {
        const stat = fs.statSync(`${global.settings.blog.dir}/${file}`);
        const { attributes, body } = fm(fs.readFileSync(`${global.settings.blog.dir}/${file}`).toString());
        var html = renderHtml(body);
        html = html.replace(/(href|src)="\//g, `$1="${global.settings.site.url}/`);
        var post = new Object(attributes);
        post.lastmod = stat.mtime;
        post.file = file.replace(/.md$/, '');
        post.html = html;
        applyCoverFallback(post);
        if (!(post.hidden === 'true'))
          posts.push(post);
      } catch (e) {
        debug(e.toString());
        debug.error(e.stack || e.message || e);
      }
    }
  }
  posts.sort((a, b) => {
    return b.published - a.published;
  });
  return posts;
}

function applyCoverFallback(post) {
  if (typeof post.cover !== 'string' || post.cover.trim().length === 0)
    post.cover = BLOG_PLACEHOLDER_COVER;
  else
    post.cover = global.utils.staticAssetUrl(post.cover.trim());
  post.coverUrl = absoluteCoverUrl(post.cover);
  return post;
}

function absoluteCoverUrl(cover) {
  cover = global.utils.staticAssetUrl(cover);
  if (/^https?:\/\//i.test(cover))
    return cover;
  if (cover.startsWith('/'))
    return `${global.settings.site.url}${cover}`;
  return `${global.settings.blog.url}/${cover}`;
}

function renderHtml(body) {
  const md = new markdownit({
    breaks: true,
    html: true,
    linkify: true,
    langPrefix: 'language-',
  });
  md.use(require('markdown-it-toc')); // @[toc]
  md.use(require('markdown-it-wikilinks'));
  md.use(require('markdown-it-obsidian-images')({ relativeBaseURL: 'Attachments/' }));
  md.use(require('markdown-it-bracketed-spans')); // [text]{attr=value}
  md.use(require('markdown-it-footnote'));
  md.use(require('markdown-it-attrs'));
  md.use(function (md, options) { // :::ar text :::
    return markdownitfence(md, "ar", {
      marker: ":",
      render: (tokens, idx, options, env, self) => {
        return `<div lang="ar" dir="rtl">${md.render(tokens[idx].content)}</div>`
      },
    })
  });
  body = body.replace(/==([^=]+)==/g, '<span class="highlight">$1</span>');
  body = body.replace(/\[![^\]]+\]/g, ''); // remove [!xyz] tags
  return global.utils.rewriteStaticAssetUrls(md.render(body));
}
