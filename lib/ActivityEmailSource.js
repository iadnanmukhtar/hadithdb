'use strict';
const mysql = require('mysql');
const Source = require('./CommunityActivitySource');
async function describe(payload) {
  const row = {type:payload.type || 'hadith', hadithId:payload.hadithId || payload.targetId, ref_num:payload.ref};
  const source = await Source.resolve((sql, values)=>global.query(mysql.format(sql, values)), row);
  const subject = require('./ContentIdentity').subject(source);
  const site = global.settings.site;
  const path = source.url || (source.reference ? '/' + source.reference : '/community');
  const url = new URL(path, row.type === 'toc' ? (site.quranUrl || site.url) : site.url).href;
  return {...source, subject, url};
}
module.exports = {describe};
