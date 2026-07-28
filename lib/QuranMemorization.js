/* jslint node:true, esversion:9 */
'use strict';

const MySQL = require('mysql');

const TABLE = 'quran_memorization_pages';
const STATUS = new Set(['todo', 'hard', 'good', 'easy', 'never']);
let ensurePromise = null;

async function ensureTable() {
  if (!ensurePromise) {
    ensurePromise = (async function () {
      await global.query(`
        CREATE TABLE IF NOT EXISTS ${TABLE} (
          user_uid VARCHAR(191) NOT NULL,
          page_number SMALLINT UNSIGNED NOT NULL,
          status ENUM('todo', 'hard', 'good', 'easy', 'never') NOT NULL DEFAULT 'todo',
          next_review_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          last_reviewed_at DATETIME NULL,
          review_count INT UNSIGNED NOT NULL DEFAULT 0,
          interval_days SMALLINT UNSIGNED NOT NULL DEFAULT 0,
          createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (user_uid, page_number),
          KEY due_pages (user_uid, next_review_at, page_number)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      const statusColumns = await global.query(`SHOW COLUMNS FROM ${TABLE} LIKE 'status'`);
      if (statusColumns[0] && !statusColumns[0].Type.includes("'never'"))
        await global.query(`ALTER TABLE ${TABLE} MODIFY status ENUM('todo', 'hard', 'good', 'easy', 'never') NOT NULL DEFAULT 'todo'`);
      const intervalColumns = await global.query(`SHOW COLUMNS FROM ${TABLE} LIKE 'interval_days'`);
      if (!intervalColumns.length)
        await global.query(`ALTER TABLE ${TABLE} ADD COLUMN interval_days SMALLINT UNSIGNED NOT NULL DEFAULT 0 AFTER review_count`);
    }()).catch(function (err) {
      ensurePromise = null;
      throw err;
    });
  }
  return ensurePromise;
}

function validPage(value) {
  const page = parseInt(value, 10);
  return Number.isInteger(page) && page >= 1 && page <= 604 ? page : null;
}

function validStatus(value) {
  const status = (value || '').toString().trim().toLowerCase();
  return STATUS.has(status) ? status : null;
}

function intervalDays(settings, status) {
  const memorize = settings && settings.memorization && typeof settings.memorization === 'object'
    ? settings.memorization
    : {};
  const fallback = status === 'easy' ? 14 : 7;
  const value = parseInt(status === 'easy' ? memorize.easyReviewDays : memorize.goodReviewDays, 10);
  return Number.isInteger(value) && value >= 1 && value <= 365 ? value : fallback;
}

async function save(userUid, pageValue, statusValue, settings, options) {
  await ensureTable();
  const page = validPage(pageValue);
  const status = validStatus(statusValue);
  if (!page || !status) throw new Error('Invalid memorization page or status.');
  const existing = await get(userUid, page);
  const reviewed = !options || options.reviewed !== false;
  const baseDays = status === 'good' || status === 'easy' ? intervalDays(settings, status) : 0;
  const previousDays = parseInt(existing && existing.interval_days, 10) || 0;
  const days = status === 'easy' && existing && existing.status === 'easy'
    ? Math.min(365, Math.max(baseDays, previousDays || baseDays) * 2)
    : baseDays;
  const uidSql = MySQL.escape(userUid);
  const statusSql = MySQL.escape(status);
  await global.query(`
    INSERT INTO ${TABLE}
      (user_uid, page_number, status, next_review_at, last_reviewed_at, review_count, interval_days)
    VALUES
      (${uidSql}, ${page}, ${statusSql}, DATE_ADD(NOW(), INTERVAL ${days} DAY), ${reviewed ? 'NOW()' : 'NULL'}, ${reviewed ? 1 : 0}, ${days})
    ON DUPLICATE KEY UPDATE
      status=VALUES(status),
      next_review_at=VALUES(next_review_at),
      last_reviewed_at=${reviewed ? 'VALUES(last_reviewed_at)' : 'last_reviewed_at'},
      review_count=review_count + ${reviewed ? 1 : 0},
      interval_days=VALUES(interval_days)
  `);
  return get(userUid, page);
}

async function get(userUid, pageValue) {
  await ensureTable();
  const page = validPage(pageValue);
  if (!page) return null;
  const rows = await global.query(`
    SELECT page_number, status, next_review_at, last_reviewed_at, review_count, interval_days
    FROM ${TABLE}
    WHERE user_uid=${MySQL.escape(userUid)} AND page_number=${page}
    LIMIT 1
  `);
  return rows && rows[0] || {
    page_number: page,
    status: 'todo',
    next_review_at: null,
    last_reviewed_at: null,
    review_count: 0,
    interval_days: 0,
    due: 0
  };
}

async function list(userUid) {
  await ensureTable();
  const rows = await global.query(`
    SELECT page_number, status, next_review_at, last_reviewed_at, review_count, interval_days,
      next_review_at <= NOW() AS due
    FROM ${TABLE}
    WHERE user_uid=${MySQL.escape(userUid)}
    ORDER BY page_number
  `) || [];
  const savedByPage = new Map(rows.map(row => [Number(row.page_number), row]));
  return Array.from({ length: 604 }, function (_unused, index) {
    const page = index + 1;
    return savedByPage.get(page) || {
      page_number: page,
      status: 'todo',
      next_review_at: null,
      last_reviewed_at: null,
      review_count: 0,
      interval_days: 0,
      due: 0
    };
  });
}

async function nextDue(userUid, excludePage) {
  await ensureTable();
  const exclude = validPage(excludePage);
  const rows = await global.query(`
    SELECT page_number, status, next_review_at
    FROM ${TABLE}
    WHERE user_uid=${MySQL.escape(userUid)}
      AND next_review_at <= NOW()
      AND status IN ('hard', 'good', 'easy')
      ${exclude ? `AND page_number<>${exclude}` : ''}
    ORDER BY
      CASE status WHEN 'hard' THEN 0 WHEN 'good' THEN 1 ELSE 2 END,
      next_review_at,
      page_number
    LIMIT 1
  `);
  return rows && rows[0] || null;
}

async function hasActivePages(userUid) {
  await ensureTable();
  const rows = await global.query(`
    SELECT 1
    FROM ${TABLE}
    WHERE user_uid=${MySQL.escape(userUid)}
      AND status IN ('hard', 'good', 'easy')
    LIMIT 1
  `);
  return Boolean(rows && rows.length);
}

module.exports = {
  get,
  hasActivePages,
  intervalDays,
  list,
  nextDue,
  save,
  validPage,
  validStatus
};
