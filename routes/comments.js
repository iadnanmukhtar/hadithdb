/* jslint node:true, esversion:9 */
'use strict';

const { homedir } = require('os');
const Utils = require('../lib/Utils');
const createReflectionRouter = require('./reflections');

async function flushCommentedCaches() {
  const cacheDir = `${homedir()}/.hadithdb/cache`;
  await Promise.all([
    Utils.flushCachedFile(`${cacheDir}/commented.html`),
    Utils.flushCachedFile(`${cacheDir}/commented_feed.xml`),
    Utils.flushCachedFile(`${cacheDir}/commented_rss.xml`)
  ]);
}

module.exports = createReflectionRouter({
  debugName: 'hadithdb:comments',
  table: 'hadiths_comments',
  votesTable: 'hadiths_comments_votes',
  targetParam: 'hadithId',
  targetColumn: 'hadithId',
  extraSelect: 'ref_num',
  replyAnchor: '#comments',
  invalidTargetError: 'Invalid hadith id',
  parseTarget(value) {
    const hadithId = parseInt(value);
    return Number.isNaN(hadithId) ? null : { value: hadithId, sql: hadithId };
  },
  responseFields(row) {
    return { ref: row.ref_num };
  },
  notificationFields(row) {
    return { ref: row.ref_num || row.hadithId };
  },
  describe(payload) {
    return {
      subject: `Hadith ${payload.ref}`,
      url: `${global.settings.site.url}/${payload.ref}`
    };
  },
  async afterCreate(target) {
    await global.query(`UPDATE hadiths SET commented=(commented+1), lastfixed=CURRENT_TIMESTAMP() WHERE id=${target.value}`);
    await flushCommentedCaches();
  },
  async afterEdit(row) {
    await global.query(`UPDATE hadiths SET lastfixed=CURRENT_TIMESTAMP() WHERE id=${row.hadithId}`);
  },
  async afterDelete(row) {
    await global.query(`UPDATE hadiths SET commented=GREATEST(commented-1, 0), lastfixed=CURRENT_TIMESTAMP() WHERE id=${row.hadithId}`);
    await flushCommentedCaches();
  },
  registerExtraRoutes(router, debug) {
    router.get('/counts', async function (req, res, next) {
      const ids = [...new Set((req.query.ids || '').toString().split(',').map(Number).filter(Number.isInteger))];
      if (!ids.length || ids.length > 100 || ids.some(id => id < 1)) {
        res.status(400).json({ error: 'Provide between 1 and 100 valid hadith ids.' });
        return;
      }
      try {
        const rows = await global.query(`SELECT id AS hadithId, commented AS count FROM hadiths WHERE id IN (${ids.join(',')})`);
        const counts = {};
        ids.forEach(id => counts[id] = 0);
        rows.forEach(row => counts[row.hadithId] = row.count);
        res.json({ counts });
      } catch (err) {
        debug(`Error loading reflection counts:\n${err.stack}`);
        next(err);
      }
    });
  }
});
