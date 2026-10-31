'use strict';
const mysql = require('mysql');
const Source = require('./CommunityActivitySource');
async function describe(payload) {
  const row = {type:payload.type || 'hadith', hadithId:payload.hadithId || payload.targetId, ref_num:payload.ref};
  const source = await Source.resolve((sql, values)=>global.query(mysql.format(sql, values)), row);
  const identity = require('./ContentIdentity');
  const referenceLabel = identity.readableReference(source.reference);
  const subject = identity.subject({...source, reference: referenceLabel});
  const site = global.settings.site;
  const path = source.url || (source.reference ? '/' + source.reference : '/community');
  const url = new URL(path, row.type === 'toc' ? (site.quranUrl || site.url) : site.url).href;
  return {...source, referenceLabel, subject, url};
}
module.exports = {describe};
