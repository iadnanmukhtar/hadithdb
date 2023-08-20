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
        posts.push({
          file: file.replace(/.md$/, ''),
          title: attributes.title,
          description: attributes.description,
          published: Date.parse(attributes.published)
        });
      } catch (e) {
      }
    }
  }
  posts.sort((a, b) => {
    return new Date(b.published) - new Date(a.published);
  });
  res.render('blog', {
    posts: posts
  });

});

router.get('/:title', async function (req, res, next) {

  res.locals.req = req;
  res.locals.res = res;

  const filename = `${global.settings.blog.dir}/${req.params.title}.md`;
  if (fs.existsSync(filename)) {

    const { attributes, body } = fm(fs.readFileSync(filename).toString());
    const md = new markdownit({
      html: true,
      linkify: true,
      langPrefix: '',
      highlight: function (str, lang) {
        return `<p lang="${lang}">${str}</p>`;
      }
    });
    md.use(require('markdown-it-toc'));
    md.use(require('markdown-it-wikilinks'));
    md.use(require('markdown-it-obsidian-images')({ relativeBaseURL: 'Attachments/' }));
    md.use(require('markdown-it-bracketed-spans'));
    md.use(require('markdown-it-attrs'));
    md.use(function (md, options) {
      return markdownitfence(md, "ar", {
        marker: ":",
        render: (tokens, idx, options, env, self) => {
          return `<div lang="ar">${md.render(tokens[idx].content)}</div>`
        },
      })
    });
    const html = md.render(body);

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


