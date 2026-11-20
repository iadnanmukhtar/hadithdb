'use strict';
const Pairs = require('./HadithBilingualPairs');
const HdithMetadata = require('./HdithMetadata');
const HadithNarratorIndex = require('./HadithNarratorIndex');
const Books = require('./Books');
const Utils = require('./Utils');
const Hadith = require('./Hadith');
const RuntimeRefresh = require('./RuntimeRefresh');

async function refresh(pair) {
  const ids = pair.affected_hadith_ids || [];
  const aliases = new Set(pair.affected_book_aliases || []);
  const virtualBooks = new Map();
  for (let offset = 0; offset < ids.length; offset += 100) {
    const batch = ids.slice(offset, offset + 100);
    const rows = await global.query(`SELECT DISTINCT b.id,b.alias FROM hadiths_virtual v JOIN books b ON b.id=v.bookId WHERE v.hadithId IN (${batch.join(',')})`);
    rows.forEach(row => { virtualBooks.set(Number(row.id), row.alias); aliases.add(row.alias); });
  }
  if (pair.type !== 'grade_opinions') {
    for (const id of virtualBooks.keys()) await global.query(`CALL refresh_v_hadiths_virtual_snapshot(${id})`);
  }
  // Publish documents before evicting pages that read them.
  if (pair.type === 'grade_opinions') {
    await require('./HadithGradeIndex').refresh(ids);
    if (ids.length) await require('./Index').refresh('hadiths');
  } else {
    await HadithNarratorIndex.reindex(ids);
  }
  for (const alias of aliases) {
    await Books.touchBookContentLastmodByAlias(alias);
    await Utils.flushCacheContaining(alias);
    await Utils.flushCacheContaining(`book:${alias}`);
    await Utils.flushBookDiskCache(alias, { strict: true });
  }
  HdithMetadata.invalidatePrimaryNarratorSuggestionCache();
  HdithMetadata.invalidateSharhTitleSuggestionCache();
  if (pair.type === 'narrator') await Pairs.rebuildNarratorCatalog();
  // Reload grade/attribution options in this worker and notify the other workers.
  await Hadith.a_reinit();
  await RuntimeRefresh.publish();
}
module.exports = { refresh };
