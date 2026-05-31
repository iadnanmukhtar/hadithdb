/* jslint node:true, esversion:9 */
'use strict';

const Utils = require('../lib/Utils');
const createReflectionRouter = require('./reflections');

module.exports = createReflectionRouter({
  debugName: 'hadithdb:blog-comments',
  table: 'blog_comments',
  votesTable: 'blog_comments_votes',
  targetParam: 'slug',
  targetColumn: 'post_slug',
  replyAnchor: '#blog-comments',
  invalidTargetError: 'Invalid blog post id',
  parseTarget(value) {
    const slug = Utils.trimToEmpty(value);
    return slug ? { value: slug, sql: `'${Utils.escSQL(slug)}'` } : null;
  },
  responseFields(row) {
    return { slug: row.post_slug };
  },
  notificationFields(row) {
    return { slug: row.post_slug };
  },
  describe(payload) {
    return {
      subject: `blog post ${payload.slug}`,
      url: `${global.settings.blog.url}/${payload.slug}`
    };
  }
});
