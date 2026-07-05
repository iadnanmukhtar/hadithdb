/* jslint node:true, esversion:9 */
'use strict';

const { homedir } = require('os');
const Utils = require('../lib/Utils');
const createReflectionRouter = require('./reflections');
const COMMENT_TYPES = new Set(['hadith', 'toc']);
let commentsTypeColumnReady;

function normalizeCommentType(value) {
  return COMMENT_TYPES.has(value) ? value : 'hadith';
}

async function ensureCommentsTypeColumn() {
  if (!commentsTypeColumnReady) {
    commentsTypeColumnReady = (async () => {
      const rows = await global.query(`
        SELECT 1
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'hadiths_comments'
          AND COLUMN_NAME = 'type'
        LIMIT 1
      `);
      if (rows && rows.length)
        return;
      await global.query(`
        ALTER TABLE hadiths_comments
        ADD COLUMN \`type\` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'hadith' AFTER hadithId
      `);
      await global.query(`
        CREATE INDEX ndx_hadiths_comments_type_target
        ON hadiths_comments (\`type\`, hadithId)
      `);
    })();
  }
  return commentsTypeColumnReady;
}

async function targetExists(target) {
  if (target.type === 'toc') {
    const rows = await global.query(`SELECT 1 FROM v_toc WHERE tId=${target.value} OR hId=${target.value} LIMIT 1`);
    return !!(rows && rows.length);
  }
  const rows = await global.query(`SELECT 1 FROM hadiths WHERE id=${target.value} LIMIT 1`);
  return !!(rows && rows.length);
}

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
  typeColumn: '`type`',
  extraSelect: 'ref_num',
  replyAnchor: '#comments',
  invalidTargetError: 'Invalid route parameter',
  targetNotFoundError: 'Comment target not found.',
  prepareTargetStorage: ensureCommentsTypeColumn,
  validateTarget: targetExists,
  parseTarget(value, req) {
    value = (value || '').toString();
    const hadithId = /^\d+$/.test(value) ? Number(value) : NaN;
    const type = normalizeCommentType((req.body && req.body.type) || req.query.type);
    return (!Number.isSafeInteger(hadithId) || hadithId < 1) ? null : { value: hadithId, sql: hadithId, type };
  },
  responseFields(row) {
    return { ref: row.ref_num, type: row.type || 'hadith' };
  },
  notificationFields(row) {
    return { ref: row.ref_num || row.hadithId, type: row.type || 'hadith', targetId: row.hadithId };
  },
  describe(payload) {
    if (payload.type === 'toc')
      return {
        subject: `Quran passage ${payload.ref || payload.targetId}`,
        url: `${global.settings.site.quranUrl || global.settings.site.url}/${payload.ref || payload.targetId}`
      };
    return {
      subject: `Hadith ${payload.ref}`,
      url: `${global.settings.site.url}/${payload.ref}`
    };
  },
  async afterCreate(target) {
    if (target.type === 'hadith')
      await global.query(`UPDATE hadiths SET commented=(commented+1), lastfixed=CURRENT_TIMESTAMP() WHERE id=${target.value}`);
    await flushCommentedCaches();
  },
  async afterEdit(row) {
    if ((row.type || 'hadith') === 'hadith')
      await global.query(`UPDATE hadiths SET lastfixed=CURRENT_TIMESTAMP() WHERE id=${row.hadithId}`);
  },
  async afterDelete(row) {
    if ((row.type || 'hadith') === 'hadith')
      await global.query(`UPDATE hadiths SET commented=GREATEST(commented-1, 0), lastfixed=CURRENT_TIMESTAMP() WHERE id=${row.hadithId}`);
    await flushCommentedCaches();
  },
  registerExtraRoutes(router, debug) {
    router.get('/counts', async function (req, res, next) {
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      res.setHeader('Cache-Control', 'private, max-age=60');
      const ids = [...new Set((req.query.ids || '').toString().split(',').map(Number).filter(Number.isInteger))];
      const type = normalizeCommentType(req.query.type);
      if (!ids.length || ids.length > 100 || ids.some(id => id < 1)) {
        res.status(400).json({ error: 'Provide between 1 and 100 valid hadith ids.' });
        return;
      }
      try {
        await ensureCommentsTypeColumn();
        const rows = type === 'toc'
          ? await global.query(`
            SELECT hadithId, COUNT(*) AS count
            FROM hadiths_comments
            WHERE \`type\`='toc'
              AND hadithId IN (${ids.join(',')})
              AND deleted=0
            GROUP BY hadithId
          `)
          : await global.query(`SELECT id AS hadithId, commented AS count FROM hadiths WHERE id IN (${ids.join(',')})`);
        const counts = {};
        ids.forEach(id => counts[id] = 0);
        rows.forEach(row => counts[row.hadithId] = row.count);
        res.json({ counts });
      } catch (err) {
        debug.error(`Error loading reflection counts:\n${err.stack || err.message}`);
        next(err);
      }
    });
  }
});
