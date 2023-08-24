/* jslint node:true, esversion:9 */
'use strict';

const debug = require('debug')('hadithdb:blog');
const express = require('express');
const asyncify = require('express-asyncify').default;
const fs = require('fs');
const createError = require('http-errors');
const fm = require('front-matter');
const markdownit = require('markdown-it');
const markdownitfence = require('markdown-it-fence')

const router = asyncify(express.Router());

router.get('/', async function (req, res, next) {

  res.locals.req = req;
  res.locals.res = res;

  var posts = [];
  const files = fs.readdirSync(global.settings.blog.dir);
  for (var file of files) {
    if (file.endsWith('.md')) {
      try {
        const { attributes } = fm(fs.readFileSync(`${global.settings.blog.dir}/${file}`).toString());
        var post = new Object(attributes);
        post.file = file.replace(/.md$/, '');
        posts.push(post);
      } catch (e) {
        debug(`Unable to read ${file}`);
      }
    }
  }
  posts.sort((a, b) => {
    return b.published - a.published;
  });
  res.render('blog', {
    posts: posts
  });

});

router.get('/feed', async function (req, res, next) {
  res.locals.req = req;
  res.locals.res = res;
  var posts = getPosts();
  res.render('blog_feed', {
    posts: posts
  });
});

router.get('/rss', async function (req, res, next) {
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

  const filename = `${global.settings.blog.dir}/${req.params.title}.md`;
  if (fs.existsSync(filename)) {

    const { attributes, body } = fm(fs.readFileSync(filename).toString());
    const html = renderHtml(body);

    res.render('blog_post', {
      attr: attributes,
      body: html
    });

  } else {
    debug(`Post ${filename} not found`);
    next(createError(404, 'Post not found'));
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
        posts.push(post);
      } catch (e) {
        debug(e.toString());
        debug(e.stack);
      }
    }
  }
  posts.sort((a, b) => {
    return b.published - a.published;
  });
  return posts;
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
  const html = md.render(body);
  return html;
}


