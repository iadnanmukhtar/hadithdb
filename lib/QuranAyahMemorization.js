/* jslint node:true, esversion:9 */
'use strict';

const MySQL = require('mysql');
const QuranFsrs = require('./QuranFsrs');
const UserSettings = require('./UserSettings');
const crypto = require('crypto');
const util = require('util');
const QuranTocSubdivisions = require('./QuranTocSubdivisions');
const QuranReviewCore = require('../packages/quran-review-core');

const TABLE = 'quran_ayah_memorization';
const HISTORY_TABLE = 'quran_ayah_review_history';
const SESSION_TABLE = 'quran_ayah_review_sessions';
const SESSION_ITEM_TABLE = 'quran_ayah_review_session_items';
const USER_UID_DEFINITION = 'VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL';
const OPTIMIZED_INDEXES = Object.freeze([
  { table: TABLE, name: 'due_ayahs', columns: 'user_uid, lifecycle_state, next_review_at' },
  { table: TABLE, name: 'lifecycle_collection', columns: 'user_uid, lifecycle_state, surah_number, ayah_number' },
  { table: TABLE, name: 'reviewed_recent', columns: 'user_uid, last_reviewed_at, surah_number, ayah_number' },
  { table: TABLE, name: 'fsrs_due_ayahs', columns: 'user_uid, lifecycle_state, fsrs_state, next_review_at' },
  {
    table: TABLE,
    name: 'progress_user_order',
    columns: 'user_uid, surah_number, ayah_number, lifecycle_state, fsrs_state, next_review_at, review_count'
  },
  {
    table: HISTORY_TABLE,
    name: 'history_stats_cover',
    columns: 'user_uid, reviewed_at, duration_seconds'
  },
  {
    table: HISTORY_TABLE,
    name: 'fsrs_optimizer_history',
    columns: 'user_uid, surah_number, ayah_number, reviewed_at, grade'
  },
  { table: HISTORY_TABLE, name: 'session_history', columns: 'user_uid, session_id, reviewed_at' },
  { table: HISTORY_TABLE, name: 'undo_attempt', columns: 'user_uid, attempt_token' },
  { table: SESSION_TABLE, name: 'active_user_session', columns: 'user_uid, completed_at, started_at DESC, session_id' },
  { table: SESSION_TABLE, name: 'paused_user_session', columns: 'user_uid, completed_at, paused_at DESC, session_id' },
  { table: SESSION_ITEM_TABLE, name: 'session_queue', columns: 'session_id, item_state, queue_position' }
]);
const LIFECYCLE_STATES = new Set(Object.keys(QuranReviewCore.LIFECYCLE_STATE_LABELS));
const USER_SELECTABLE_LIFECYCLE_STATES = new Set(QuranReviewCore.USER_SELECTABLE_LIFECYCLE_STATES);
const INITIAL_USER_SELECTABLE_LIFECYCLE_STATES = new Set(QuranReviewCore.INITIAL_ASSESSMENT_STAGES.map(stage => stage.state));
const SELF_ASSESSED_WEAK_DIFFICULTY = QuranFsrs.WEAK_DIFFICULTY_THRESHOLD + 1;
const ENROLLED_AYAH_USER_SELECTABLE_LIFECYCLE_STATES = new Set(['core', 'later', 'suspended']);
const ENROLLED_BULK_USER_SELECTABLE_LIFECYCLE_STATES = new Set(['core', 'later', 'suspended']);
const LEARNING_PROGRESS = new Set(['started', 'partial', 'nearly_memorized']);
const REVIEW_GRADES = new Set(['again', 'hard', 'good', 'easy', 'skip']);
const REVIEWABLE_LIFECYCLE_STATES = new Set(['learning', 'relearning', 'weak', 'review']);
const SURAH_REVIEW_LIFECYCLE_STATES = new Set([...REVIEWABLE_LIFECYCLE_STATES, 'core', 'suspended']);
const REVIEW_SESSION_DEFAULTS = Object.freeze({
  total: 10,
  learning: 3,
  weak: 3,
  memorized: 10
});
// Shared with the browser and native app so every client validates the same
// canonical Hafs references before touching local or remote state.
const CANONICAL_AYAH_COUNTS = QuranReviewCore.CANONICAL_AYAH_COUNTS;
const STATE_LABELS = QuranReviewCore.LIFECYCLE_STATE_LABELS;
const STATE_DESCRIPTIONS = {
  later: 'Not currently being memorized',
  learning: 'Still learning the complete ayah',
  weak: 'Hard recall, scheduled with shorter intervals',
  review: 'Good recall, maintained through spaced review',
  core: 'Easy recall, retained without scheduled reviews',
  relearning: 'Hard recall under automatic recovery after Again',
  suspended: 'Temporarily removed from learning and review'
};
const DEFAULT_LEARNING_SURAHS = Object.freeze([1, 113, 114]);
const MAX_AGAIN_GRADES_PER_SESSION_ITEM = 2;
let ensurePromise = null;
let mushafPageRangesPromise = null;
let progressGroupDefinitionsPromise = null;
const newUserSeedPromises = new Map();
const initializedLearningUsers = new Set();

function getConnection() {
  return new Promise((resolve, reject) => global.dbPool.getConnection((err, connection) => err ? reject(err) : resolve(connection)));
}

async function transaction(fn) {
  const connection = await getConnection();
  const query = util.promisify(connection.query).bind(connection);
  const begin = util.promisify(connection.beginTransaction).bind(connection);
  const commit = util.promisify(connection.commit).bind(connection);
  const rollback = util.promisify(connection.rollback).bind(connection);
  try {
    await begin();
    const value = await fn(query);
    await commit();
    return value;
  } catch (err) {
    try { await rollback(); } catch (_rollbackErr) {}
    throw err;
  } finally {
    connection.release();
  }
}

function sql(value) {
  return value === null || value === undefined
    ? 'NULL'
    : MySQL.escape(value, false, value instanceof Date ? 'Z' : 'local');
}

function utcDateColumnSql(column, alias) {
  return `DATE_FORMAT(CONVERT_TZ(${column},@@session.time_zone,'+00:00'),'%Y-%m-%dT%H:%i:%sZ') AS ${alias || column}`;
}

function memoryUtcDateColumns(prefix) {
  const source = prefix ? `${prefix}.` : '';
  return [
    'learning_started_at', 'learning_last_worked_at', 'fully_memorized_at',
    'last_reviewed_at', 'next_review_at', 'suspended_at', 'created_at', 'updated_at'
  ].map(column => utcDateColumnSql(`${source}${column}`, column)).join(',\n      ');
}

function reviewDayStart(value) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const distance = Date.now() - date.getTime();
  return distance >= -86400000 && distance <= 172800000 ? date : null;
}

function storedDateOrNow(value) {
  if (!value) return new Date();
  if (value instanceof Date) return value;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : value;
}

function defaultLearningRefs() {
  return DEFAULT_LEARNING_SURAHS.flatMap(surah => Array.from(
    { length: CANONICAL_AYAH_COUNTS[surah - 1] },
    (_value, index) => ({ surah, ayah: index + 1 })
  ));
}

async function seedDefaultLearningAyat(q, userUid) {
  const existing = await q(`
    SELECT 1 FROM ${TABLE}
    WHERE user_uid=${sql(userUid)}
    LIMIT 1
  `) || [];
  if (existing.length) return 0;
  const values = defaultLearningRefs().map(ref => `(
    ${sql(userUid)},${ref.surah},${ref.ayah},'learning','started',UTC_TIMESTAMP(),UTC_TIMESTAMP(),
    0,0,0,0,0,${QuranFsrs.FSRS_VERSION}
  )`).join(',');
  const result = await q(`
    INSERT IGNORE INTO ${TABLE}
      (user_uid,surah_number,ayah_number,lifecycle_state,learning_progress,
       learning_started_at,learning_last_worked_at,stability,difficulty,fsrs_state,
       fsrs_scheduled_days,fsrs_learning_steps,fsrs_version)
    VALUES ${values}
  `);
  return Math.max(0, Number(result && result.affectedRows) || 0);
}

async function initializeNewUserLearning(userUid) {
  const key = (userUid || '').toString();
  if (initializedLearningUsers.has(key)) return 0;
  if (newUserSeedPromises.has(key)) return newUserSeedPromises.get(key);
  const pending = (async function () {
    await ensureTables();
    const seeded = await seedDefaultLearningAyat(global.query, key);
    initializedLearningUsers.add(key);
    return seeded;
  }()).finally(() => newUserSeedPromises.delete(key));
  newUserSeedPromises.set(key, pending);
  return pending;
}

const strictInteger = QuranReviewCore.strictInteger;
const parseRef = QuranReviewCore.parseRef;
const parseRefString = QuranReviewCore.parseRefString;

function refInputs(values) {
  if (Array.isArray(values)) return values;
  const normalized = (values || '').toString();
  return normalized.trim() ? normalized.split(',') : [];
}

function parseRefInput(value) {
  return typeof value === 'object' && value ? parseRef(value.surah, value.ayah) : parseRefString(value);
}

function normalizeRefs(values, max = 500) {
  const seen = new Set();
  return refInputs(values)
    .map(parseRefInput)
    .filter(ref => {
      if (!ref) return false;
      const key = `${ref.surah}:${ref.ayah}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, max);
}

function expectedRowVersion(options) {
  if (!options || options.expectedVersion === undefined || options.expectedVersion === null || options.expectedVersion === '')
    return null;
  const version = strictInteger(options.expectedVersion);
  if (version === null) {
    const err = new Error('A valid expected row version is required.');
    err.status = 400;
    throw err;
  }
  return version;
}

function conflictError() {
  const err = new Error('This ayah was updated elsewhere. Reload its current state and try again.');
  err.status = 409;
  return err;
}

async function ensureColumn(table, column, definition) {
  const columns = await global.query(`SHOW COLUMNS FROM ${table} LIKE ${sql(column)}`) || [];
  if (columns.length) return false;
  try {
    await global.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    return true;
  } catch (err) {
    // A second process can complete the same additive upgrade between SHOW and
    // ALTER. Treat only that race as success; every other schema error matters.
    if (!(err && (err.code === 'ER_DUP_FIELDNAME' || Number(err.errno) === 1060))) throw err;
    return false;
  }
}

async function ensureEnumValue(table, column, definition, value) {
  const columns = await global.query(`SHOW COLUMNS FROM ${table} LIKE ${sql(column)}`) || [];
  if (!columns.length) return ensureColumn(table, column, definition);
  const type = (columns[0].Type || columns[0].type || '').toString().toLowerCase();
  if (type.includes(`'${value.toString().toLowerCase()}'`)) return false;
  await global.query(`ALTER TABLE ${table} MODIFY COLUMN ${column} ${definition}`);
  return true;
}

async function ensureColumnType(table, column, definition, expectedType) {
  const columns = await global.query(`SHOW COLUMNS FROM ${table} LIKE ${sql(column)}`) || [];
  if (!columns.length) return ensureColumn(table, column, definition);
  const type = (columns[0].Type || columns[0].type || '').toString().toLowerCase();
  if (type === expectedType.toLowerCase()) return false;
  await global.query(`ALTER TABLE ${table} MODIFY COLUMN ${column} ${definition}`);
  return true;
}

function normalizedIndexColumns(columns) {
  return columns.split(',').map(column => column.trim().replace(/\s+/g, ' ').toLowerCase());
}

function indexColumnsFromRows(rows) {
  return (rows || []).slice().sort((left, right) => Number(left.Seq_in_index) - Number(right.Seq_in_index))
    .map(row => `${row.Column_name}${row.Collation === 'D' ? ' DESC' : ''}`.toLowerCase());
}

function indexMatches(rows, columns) {
  const actual = indexColumnsFromRows(rows);
  const expected = normalizedIndexColumns(columns);
  return actual.length === expected.length && actual.every((column, index) => column === expected[index]);
}

async function ensureIndex(table, name, columns) {
  const indexes = await global.query(`SHOW INDEX FROM ${table} WHERE Key_name=${sql(name)}`) || [];
  if (indexes.length && indexMatches(indexes, columns)) return false;
  try {
    await global.query(indexes.length
      ? `ALTER TABLE ${table} DROP INDEX ${name}, ADD KEY ${name} (${columns})`
      : `ALTER TABLE ${table} ADD KEY ${name} (${columns})`);
    return true;
  } catch (err) {
    if (!(err && (err.code === 'ER_DUP_KEYNAME' || Number(err.errno) === 1061))) throw err;
    return false;
  }
}

async function dropIndex(table, name) {
  const indexes = await global.query(`SHOW INDEX FROM ${table} WHERE Key_name=${sql(name)}`) || [];
  if (!indexes.length) return false;
  await global.query(`ALTER TABLE ${table} DROP INDEX ${name}`);
  return true;
}

async function ensureTables() {
  if (!ensurePromise) {
    ensurePromise = (async function () {
      await global.query(`
        CREATE TABLE IF NOT EXISTS ${TABLE} (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          user_uid ${USER_UID_DEFINITION},
          surah_number SMALLINT UNSIGNED NOT NULL,
          ayah_number SMALLINT UNSIGNED NOT NULL,
          lifecycle_state ENUM('later','learning','weak','review','relearning','suspended','core') NOT NULL DEFAULT 'later',
          learning_progress ENUM('started','partial','nearly_memorized') DEFAULT NULL,
          learning_started_at DATETIME DEFAULT NULL,
          learning_last_worked_at DATETIME DEFAULT NULL,
          fully_memorized_at DATETIME DEFAULT NULL,
          stability DECIMAL(12,6) NOT NULL DEFAULT 0,
          difficulty DECIMAL(10,6) NOT NULL DEFAULT 5,
          last_reviewed_at DATETIME DEFAULT NULL,
          next_review_at DATETIME DEFAULT NULL,
          review_count INT UNSIGNED NOT NULL DEFAULT 0,
          lapse_count INT UNSIGNED NOT NULL DEFAULT 0,
          consecutive_successes INT UNSIGNED NOT NULL DEFAULT 0,
          last_grade ENUM('again','hard','good','easy') DEFAULT NULL,
          relearning_step TINYINT UNSIGNED NOT NULL DEFAULT 0,
          fsrs_state TINYINT UNSIGNED DEFAULT NULL,
          fsrs_scheduled_days INT UNSIGNED NOT NULL DEFAULT 0,
          fsrs_learning_steps SMALLINT UNSIGNED NOT NULL DEFAULT 0,
          fsrs_version TINYINT UNSIGNED NOT NULL DEFAULT 6,
          suspended_at DATETIME DEFAULT NULL,
          suspended_from_state ENUM('later','learning','weak','review','relearning','core') DEFAULT NULL,
          row_version INT UNSIGNED NOT NULL DEFAULT 1,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uq_quran_ayah_memorization (user_uid, surah_number, ayah_number),
          KEY due_ayahs (user_uid, lifecycle_state, next_review_at),
          KEY fsrs_due_ayahs (user_uid, lifecycle_state, fsrs_state, next_review_at),
          KEY lifecycle_collection (user_uid, lifecycle_state, surah_number, ayah_number),
          KEY reviewed_recent (user_uid, last_reviewed_at, surah_number, ayah_number),
          KEY progress_user_order
            (user_uid, surah_number, ayah_number, lifecycle_state, fsrs_state, next_review_at, review_count)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      await global.query(`
        CREATE TABLE IF NOT EXISTS ${HISTORY_TABLE} (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          user_uid ${USER_UID_DEFINITION},
          surah_number SMALLINT UNSIGNED NOT NULL,
          ayah_number SMALLINT UNSIGNED NOT NULL,
          reviewed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          grade ENUM('again','hard','good','easy') NOT NULL,
          lifecycle_state_before ENUM('later','learning','weak','review','relearning','suspended','core') NOT NULL,
          lifecycle_state_after ENUM('later','learning','weak','review','relearning','suspended','core') NOT NULL,
          scheduled_interval INT UNSIGNED NOT NULL DEFAULT 0,
          actual_elapsed_time DECIMAL(10,3) DEFAULT NULL,
          duration_seconds INT UNSIGNED DEFAULT NULL,
          mistake_count INT UNSIGNED DEFAULT NULL,
          prompt_count INT UNSIGNED DEFAULT NULL,
          session_id VARCHAR(64) DEFAULT NULL,
          attempt_token CHAR(36) DEFAULT NULL,
          memory_before JSON DEFAULT NULL,
          session_item_before JSON DEFAULT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          KEY session_history (user_uid, session_id, reviewed_at),
          KEY undo_attempt (user_uid, attempt_token),
          KEY history_stats_cover (user_uid, reviewed_at, duration_seconds),
          KEY fsrs_optimizer_history (user_uid, surah_number, ayah_number, reviewed_at, grade)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      await global.query(`
        CREATE TABLE IF NOT EXISTS ${SESSION_TABLE} (
          session_id CHAR(36) NOT NULL,
          user_uid ${USER_UID_DEFINITION},
          scheduled_limit SMALLINT UNSIGNED NOT NULL,
          learning_limit SMALLINT UNSIGNED NOT NULL DEFAULT 3,
          relearning_limit SMALLINT UNSIGNED NOT NULL,
          weak_limit SMALLINT UNSIGNED NOT NULL DEFAULT 3,
          memorized_limit SMALLINT UNSIGNED NOT NULL DEFAULT 10,
          time_budget_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 0,
          scheduled_reviewed SMALLINT UNSIGNED NOT NULL DEFAULT 0,
          learning_reviewed SMALLINT UNSIGNED NOT NULL DEFAULT 0,
          relearning_reviewed SMALLINT UNSIGNED NOT NULL DEFAULT 0,
          weak_reviewed SMALLINT UNSIGNED NOT NULL DEFAULT 0,
          memorized_reviewed SMALLINT UNSIGNED NOT NULL DEFAULT 0,
          undo_attempt_token CHAR(36) DEFAULT NULL,
          session_mode ENUM('regular','surah','page','passage') NOT NULL DEFAULT 'regular',
          review_unit ENUM('ayah','passage') NOT NULL DEFAULT 'ayah',
          review_surah_number SMALLINT UNSIGNED DEFAULT NULL,
          review_page_limit SMALLINT UNSIGNED DEFAULT NULL,
          review_page_number SMALLINT UNSIGNED DEFAULT NULL,
          continue_forward TINYINT(1) NOT NULL DEFAULT 0,
          review_cursor_page SMALLINT UNSIGNED DEFAULT NULL,
          review_cursor_ref VARCHAR(16) DEFAULT NULL,
          started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          paused_at DATETIME DEFAULT NULL,
          ended_at DATETIME DEFAULT NULL,
          completed_at DATETIME DEFAULT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (session_id),
          KEY active_user_session (user_uid, completed_at, started_at DESC, session_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      await global.query(`
        CREATE TABLE IF NOT EXISTS ${SESSION_ITEM_TABLE} (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          session_id CHAR(36) NOT NULL,
          user_uid ${USER_UID_DEFINITION},
          surah_number SMALLINT UNSIGNED NOT NULL,
          ayah_number SMALLINT UNSIGNED NOT NULL,
          source_state ENUM('learning','relearning','weak','review','core','suspended') NOT NULL,
          queue_position INT UNSIGNED NOT NULL,
          unit_key VARCHAR(64) DEFAULT NULL,
          item_state ENUM('queued','retry_pending','reviewed','skipped') NOT NULL DEFAULT 'queued',
          attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
          current_token CHAR(36) DEFAULT NULL,
          presented_at DATETIME DEFAULT NULL,
          last_attempt_token CHAR(36) DEFAULT NULL,
          last_attempt_grade ENUM('again','hard','good','easy','skip') DEFAULT NULL,
          last_retry_queued TINYINT(1) NOT NULL DEFAULT 0,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uq_session_ayah (session_id, surah_number, ayah_number),
          KEY session_queue (session_id, item_state, queue_position)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      await ensureColumn(TABLE, 'suspended_from_state', "ENUM('later','learning','weak','review','relearning','core') DEFAULT NULL");
      await ensureColumn(TABLE, 'fsrs_state', 'TINYINT UNSIGNED DEFAULT NULL');
      await ensureColumn(TABLE, 'fsrs_scheduled_days', 'INT UNSIGNED NOT NULL DEFAULT 0');
      await ensureColumn(TABLE, 'fsrs_learning_steps', 'SMALLINT UNSIGNED NOT NULL DEFAULT 0');
      await ensureColumn(TABLE, 'fsrs_version', 'TINYINT UNSIGNED NOT NULL DEFAULT 6');
      await ensureColumnType(TABLE, 'stability', 'DECIMAL(12,6) NOT NULL DEFAULT 0', 'decimal(12,6)');
      await ensureColumnType(TABLE, 'difficulty', 'DECIMAL(10,6) NOT NULL DEFAULT 5', 'decimal(10,6)');
      await ensureEnumValue(TABLE, 'lifecycle_state', "ENUM('later','learning','weak','review','relearning','suspended','core') NOT NULL DEFAULT 'later'", 'weak');
      await ensureEnumValue(TABLE, 'suspended_from_state', "ENUM('later','learning','weak','review','relearning','core') DEFAULT NULL", 'weak');
      await ensureEnumValue(HISTORY_TABLE, 'lifecycle_state_before', "ENUM('later','learning','weak','review','relearning','suspended','core') NOT NULL", 'weak');
      await ensureEnumValue(HISTORY_TABLE, 'lifecycle_state_after', "ENUM('later','learning','weak','review','relearning','suspended','core') NOT NULL", 'weak');
      await ensureEnumValue(SESSION_ITEM_TABLE, 'source_state', "ENUM('learning','relearning','weak','review','core','suspended') NOT NULL", 'core');
      await ensureEnumValue(SESSION_ITEM_TABLE, 'source_state', "ENUM('learning','relearning','weak','review','core','suspended') NOT NULL", 'suspended');
      await ensureColumn(SESSION_TABLE, 'learning_limit', 'SMALLINT UNSIGNED NOT NULL DEFAULT 3');
      await ensureColumn(SESSION_TABLE, 'weak_limit', 'SMALLINT UNSIGNED NOT NULL DEFAULT 3');
      await ensureColumn(SESSION_TABLE, 'memorized_limit', 'SMALLINT UNSIGNED NOT NULL DEFAULT 10');
      await ensureColumn(SESSION_TABLE, 'time_budget_minutes', 'SMALLINT UNSIGNED NOT NULL DEFAULT 0');
      await ensureColumn(SESSION_TABLE, 'scheduled_reviewed', 'SMALLINT UNSIGNED NOT NULL DEFAULT 0');
      await ensureColumn(SESSION_TABLE, 'learning_reviewed', 'SMALLINT UNSIGNED NOT NULL DEFAULT 0');
      await ensureColumn(SESSION_TABLE, 'relearning_reviewed', 'SMALLINT UNSIGNED NOT NULL DEFAULT 0');
      await ensureColumn(SESSION_TABLE, 'weak_reviewed', 'SMALLINT UNSIGNED NOT NULL DEFAULT 0');
      await ensureColumn(SESSION_TABLE, 'memorized_reviewed', 'SMALLINT UNSIGNED NOT NULL DEFAULT 0');
      await ensureColumn(SESSION_TABLE, 'undo_attempt_token', 'CHAR(36) DEFAULT NULL');
      await ensureEnumValue(SESSION_TABLE, 'session_mode', "ENUM('regular','surah','page') NOT NULL DEFAULT 'regular'", 'page');
      await ensureEnumValue(SESSION_TABLE, 'session_mode', "ENUM('regular','surah','page','passage') NOT NULL DEFAULT 'regular'", 'passage');
      await ensureColumn(SESSION_TABLE, 'review_unit', "ENUM('ayah','passage') NOT NULL DEFAULT 'ayah'");
      await ensureColumn(SESSION_TABLE, 'review_surah_number', 'SMALLINT UNSIGNED DEFAULT NULL');
      await ensureColumn(SESSION_TABLE, 'review_page_limit', 'SMALLINT UNSIGNED DEFAULT NULL');
      await ensureColumn(SESSION_TABLE, 'review_page_number', 'SMALLINT UNSIGNED DEFAULT NULL');
      await ensureColumn(SESSION_TABLE, 'continue_forward', 'TINYINT(1) NOT NULL DEFAULT 0');
      await ensureColumn(SESSION_TABLE, 'review_cursor_page', 'SMALLINT UNSIGNED DEFAULT NULL');
      await ensureColumn(SESSION_TABLE, 'review_cursor_ref', 'VARCHAR(16) DEFAULT NULL');
      await ensureColumn(SESSION_TABLE, 'paused_at', 'DATETIME DEFAULT NULL');
      await ensureColumn(SESSION_TABLE, 'ended_at', 'DATETIME DEFAULT NULL');
      await ensureColumn(SESSION_TABLE, 'completed_at', 'DATETIME DEFAULT NULL');
      await ensureColumn(SESSION_ITEM_TABLE, 'attempts', 'TINYINT UNSIGNED NOT NULL DEFAULT 0');
      await ensureColumn(SESSION_ITEM_TABLE, 'unit_key', 'VARCHAR(64) DEFAULT NULL');
      await ensureColumn(SESSION_ITEM_TABLE, 'current_token', 'CHAR(36) DEFAULT NULL');
      await ensureColumn(SESSION_ITEM_TABLE, 'presented_at', 'DATETIME DEFAULT NULL');
      await ensureColumn(SESSION_ITEM_TABLE, 'last_attempt_token', 'CHAR(36) DEFAULT NULL');
      await ensureColumn(SESSION_ITEM_TABLE, 'last_attempt_grade', "ENUM('again','hard','good','easy','skip') DEFAULT NULL");
      await ensureColumn(SESSION_ITEM_TABLE, 'last_retry_queued', 'TINYINT(1) NOT NULL DEFAULT 0');
      await ensureColumn(HISTORY_TABLE, 'attempt_token', 'CHAR(36) DEFAULT NULL');
      await ensureColumn(HISTORY_TABLE, 'memory_before', 'JSON DEFAULT NULL');
      await ensureColumn(HISTORY_TABLE, 'session_item_before', 'JSON DEFAULT NULL');
      await ensureIndex(TABLE, 'reviewed_recent', 'user_uid, last_reviewed_at, surah_number, ayah_number');
      await ensureIndex(TABLE, 'due_ayahs', 'user_uid, lifecycle_state, next_review_at');
      await ensureIndex(TABLE, 'lifecycle_collection', 'user_uid, lifecycle_state, surah_number, ayah_number');
      await ensureIndex(TABLE, 'fsrs_due_ayahs', 'user_uid, lifecycle_state, fsrs_state, next_review_at');
      await ensureIndex(TABLE, 'progress_user_order', 'user_uid, surah_number, ayah_number, lifecycle_state, fsrs_state, next_review_at, review_count');
      await ensureIndex(HISTORY_TABLE, 'history_stats_cover', 'user_uid, reviewed_at, duration_seconds');
      await ensureIndex(HISTORY_TABLE, 'fsrs_optimizer_history', 'user_uid, surah_number, ayah_number, reviewed_at, grade');
      await ensureIndex(HISTORY_TABLE, 'session_history', 'user_uid, session_id, reviewed_at');
      await ensureIndex(HISTORY_TABLE, 'undo_attempt', 'user_uid, attempt_token');
      await ensureIndex(SESSION_TABLE, 'active_user_session', 'user_uid, completed_at, started_at DESC, session_id');
      await ensureIndex(SESSION_TABLE, 'paused_user_session', 'user_uid, completed_at, paused_at DESC, session_id');
      await global.query(`
        UPDATE ${TABLE}
        SET suspended_from_state=CASE
          WHEN relearning_step>0 OR last_grade='again' THEN 'relearning'
          WHEN fully_memorized_at IS NOT NULL OR review_count>0 THEN 'review'
          WHEN learning_started_at IS NOT NULL THEN 'learning'
          ELSE 'later'
        END
        WHERE lifecycle_state='suspended' AND suspended_from_state IS NULL
      `);
      await global.query(`
        UPDATE ${TABLE}
        SET lifecycle_state='weak', row_version=row_version+1
        WHERE lifecycle_state='review'
          AND difficulty>${Number(QuranFsrs.WEAK_DIFFICULTY_THRESHOLD)}
      `);
      await global.query(`
        UPDATE ${TABLE}
        SET lifecycle_state='core', next_review_at=NULL, fsrs_scheduled_days=0,
          relearning_step=0, fully_memorized_at=COALESCE(fully_memorized_at,NOW()),
          row_version=row_version+1
        WHERE lifecycle_state IN ('review','weak')
          AND stability>${Number(QuranFsrs.CORE_STABILITY_THRESHOLD_DAYS)}
          AND difficulty<${Number(QuranFsrs.CORE_DIFFICULTY_MAXIMUM)}
      `);
    }()).catch(function (err) {
      ensurePromise = null;
      throw err;
    });
  }
  return ensurePromise;
}

async function assertCanonicalRef(surahValue, ayahValue) {
  const ref = parseRef(surahValue, ayahValue);
  if (!ref) {
    const err = new Error('A valid Quran surah and ayah are required.');
    err.status = 400;
    throw err;
  }
  if (!(global.surahs || []).length) {
    const rows = await global.query(`
      SELECT 1 FROM quran_mushaf_words
      WHERE surah=${ref.surah} AND ayah=${ref.ayah} AND is_ayah_marker=1
      LIMIT 1
    `);
    if (!rows.length) {
      const err = new Error(`Quran ${ref.surah}:${ref.ayah} does not exist.`);
      err.status = 400;
      throw err;
    }
  }
  return ref;
}

function defaultRecord(ref) {
  return {
    surah_number: ref.surah,
    ayah_number: ref.ayah,
    lifecycle_state: 'later',
    lifecycle_label: STATE_LABELS.later,
    learning_progress: null,
    learning_started_at: null,
    learning_last_worked_at: null,
    fully_memorized_at: null,
    stability: 0,
    difficulty: 5,
    last_reviewed_at: null,
    next_review_at: null,
    review_count: 0,
    lapse_count: 0,
    consecutive_successes: 0,
    last_grade: null,
    relearning_step: 0,
    suspended_at: null,
    suspended_from_state: null,
    row_version: 0,
    due: 0
  };
}

function decorate(row) {
  if (!row) return row;
  row.lifecycle_label = row.lifecycle_state === 'relearning'
    ? STATE_LABELS.weak
    : STATE_LABELS[row.lifecycle_state] || row.lifecycle_state;
  const scheduledDue = row.is_due_now === undefined
    ? row.next_review_at && new Date(row.next_review_at).getTime() <= Date.now()
    : Number(row.is_due_now) === 1;
  const initialized = [1, 2, 3].includes(Number(row.fsrs_state));
  row.is_new = REVIEWABLE_LIFECYCLE_STATES.has(row.lifecycle_state) && Number(row.fsrs_state) === 0 ? 1 : 0;
  row.due = REVIEWABLE_LIFECYCLE_STATES.has(row.lifecycle_state)
    && ((row.is_new && row.lifecycle_state !== 'weak') || (initialized && scheduledDue)) ? 1 : 0;
  return row;
}

async function get(userUid, surahValue, ayahValue) {
  await ensureTables();
  const ref = await assertCanonicalRef(surahValue, ayahValue);
  await initializeNewUserLearning(userUid);
  const rows = await global.query(`
    SELECT *, ${memoryUtcDateColumns()},
      next_review_at<=NOW() AS is_due_now
    FROM ${TABLE}
    WHERE user_uid=${sql(userUid)} AND surah_number=${ref.surah} AND ayah_number=${ref.ayah}
    LIMIT 1
  `);
  return decorate(rows[0] || defaultRecord(ref));
}

async function getMany(userUid, refsValue) {
  await ensureTables();
  const inputs = refInputs(refsValue);
  if (inputs.length > 500) {
    const err = new Error('A maximum of 500 ayah references may be requested at once.');
    err.status = 400;
    throw err;
  }
  if (inputs.some(value => !parseRefInput(value))) {
    const err = new Error('Every requested Quran reference must contain a canonical surah and ayah.');
    err.status = 400;
    throw err;
  }
  const refs = normalizeRefs(refsValue);
  if (!refs.length) return [];
  await initializeNewUserLearning(userUid);
  const refTuples = refs.map(ref => `(${ref.surah},${ref.ayah})`).join(',');
  const rows = await global.query(`
    SELECT *, ${memoryUtcDateColumns()},
      next_review_at<=NOW() AS is_due_now
    FROM ${TABLE}
    WHERE user_uid=${sql(userUid)} AND (surah_number,ayah_number) IN (${refTuples})
  `) || [];
  const byRef = new Map(rows.map(row => [`${row.surah_number}:${row.ayah_number}`, decorate(row)]));
  return refs.map(ref => byRef.get(`${ref.surah}:${ref.ayah}`) || defaultRecord(ref));
}

function stateUpdateValues(existing, nextState, fsrsSettings) {
  const values = { lifecycle_state: nextState };
  const initialized = [1, 2, 3].includes(Number(existing.fsrs_state));
  const reviewed = initialized || Number(existing.review_count) > 0 || Boolean(existing.last_reviewed_at)
    || Number(existing.stability) > 0;
  const resumeState = existing.lifecycle_state === 'suspended' && existing.suspended_from_state;
  if (resumeState === nextState) {
    if (nextState === 'weak' && reviewed) values.next_review_at = new Date();
    values.suspended_at = null;
    values.suspended_from_state = null;
    return values;
  }
  if (nextState === 'learning') {
    values.learning_progress = existing.learning_progress || 'started';
    values.learning_started_at = storedDateOrNow(existing.learning_started_at);
    values.learning_last_worked_at = new Date();
    if (!reviewed) {
      values.next_review_at = null;
      values.stability = 0;
      values.difficulty = 0;
      values.fsrs_state = 0;
      values.fsrs_scheduled_days = 0;
      values.fsrs_learning_steps = 0;
      values.fsrs_version = QuranFsrs.FSRS_VERSION;
    } else if (!existing.next_review_at) values.next_review_at = new Date();
    values.suspended_at = null;
    values.suspended_from_state = null;
  } else if (nextState === 'weak') {
    values.learning_progress = existing.learning_progress || 'nearly_memorized';
    values.learning_started_at = storedDateOrNow(existing.learning_started_at);
    values.learning_last_worked_at = new Date();
    values.fully_memorized_at = storedDateOrNow(existing.fully_memorized_at);
    if (reviewed) {
      Object.assign(values, QuranFsrs.initialAssessment('weak', fsrsSettings));
    } else {
      values.next_review_at = null;
      values.stability = 0;
      values.difficulty = SELF_ASSESSED_WEAK_DIFFICULTY;
      values.fsrs_state = 0;
      values.fsrs_scheduled_days = 0;
      values.fsrs_learning_steps = 0;
      values.fsrs_version = QuranFsrs.FSRS_VERSION;
    }
    values.relearning_step = 0;
    values.suspended_at = null;
    values.suspended_from_state = null;
  } else if (nextState === 'review') {
    const assessment = QuranFsrs.initialAssessment('review', fsrsSettings);
    values.fully_memorized_at = storedDateOrNow(existing.fully_memorized_at);
    Object.assign(values, assessment);
    values.consecutive_successes = Math.max(0, Number(existing.consecutive_successes) || 0);
    values.relearning_step = 0;
    values.suspended_at = null;
    values.suspended_from_state = null;
  } else if (nextState === 'core') {
    const assessment = QuranFsrs.initialAssessment('core', fsrsSettings);
    values.fully_memorized_at = storedDateOrNow(existing.fully_memorized_at);
    Object.assign(values, assessment);
    values.relearning_step = 0;
    values.suspended_at = null;
    values.suspended_from_state = null;
  } else if (nextState === 'relearning') {
    values.fully_memorized_at = storedDateOrNow(existing.fully_memorized_at);
    values.stability = Number(existing.stability) > 0 ? clamp(0.2, 3650, Number(existing.stability)) : 1;
    values.difficulty = Number(existing.difficulty) > 0 ? clamp(1, 10, Number(existing.difficulty)) : 5;
    values.next_review_at = new Date();
    values.relearning_step = 0;
    values.consecutive_successes = 0;
    values.suspended_at = null;
    values.suspended_from_state = null;
  } else if (nextState === 'suspended') {
    values.suspended_at = new Date();
    values.suspended_from_state = existing.lifecycle_state === 'suspended'
      ? (existing.suspended_from_state || 'later')
      : existing.lifecycle_state;
  } else if (nextState === 'later') {
    values.next_review_at = null;
    values.learning_progress = null;
    values.suspended_at = null;
    values.suspended_from_state = null;
  }
  return values;
}

function userStateTransitionAllowed(currentStateValue, nextStateValue) {
  const currentState = (currentStateValue || 'later').toString().trim().toLowerCase();
  const nextState = (nextStateValue || '').toString().trim().toLowerCase();
  if (currentState === nextState) return true;
  return currentState === 'later'
    ? INITIAL_USER_SELECTABLE_LIFECYCLE_STATES.has(nextState)
    : ENROLLED_AYAH_USER_SELECTABLE_LIFECYCLE_STATES.has(nextState);
}

function bulkStateTransitionAllowed(currentStateValue, nextStateValue) {
  const currentState = (currentStateValue || 'later').toString().trim().toLowerCase();
  const nextState = (nextStateValue || '').toString().trim().toLowerCase();
  if (currentState === nextState) return true;
  return currentState === 'later'
    ? INITIAL_USER_SELECTABLE_LIFECYCLE_STATES.has(nextState)
    : ENROLLED_BULK_USER_SELECTABLE_LIFECYCLE_STATES.has(nextState);
}

function assertUserStateTransition(currentState, nextState) {
  if (userStateTransitionAllowed(currentState, nextState)) return;
  const err = new Error('An enrolled ayah can only be marked Easy, Paused, or Later. Review grades manage its other learning stages.');
  err.status = 409;
  throw err;
}

async function updateState(userUid, surahValue, ayahValue, stateValue, options) {
  await ensureTables();
  const ref = await assertCanonicalRef(surahValue, ayahValue);
  const state = (stateValue || '').toString().trim().toLowerCase();
  if (!USER_SELECTABLE_LIFECYCLE_STATES.has(state)) {
    const err = new Error(state === 'relearning'
      ? 'Relearning is assigned automatically after a failed review.'
      : 'Unsupported memorization lifecycle state.');
    err.status = 400;
    throw err;
  }
  const existing = await get(userUid, ref.surah, ref.ayah);
  const expectedVersion = expectedRowVersion(options);
  if (expectedVersion !== null && expectedVersion !== Number(existing.row_version)) throw conflictError();
  if (!existing.id && state === 'later') return existing;
  if (existing.id && existing.lifecycle_state === state) return existing;
  assertUserStateTransition(existing.lifecycle_state, state);
  const settings = await UserSettings.getSettings(userUid);
  const values = stateUpdateValues(existing, state, settings.memorization.fsrs);
  const columns = Object.keys(values);
  if (!existing.id) {
    try {
      await global.query(`
        INSERT INTO ${TABLE}
          (user_uid, surah_number, ayah_number, ${columns.join(', ')})
        VALUES
          (${sql(userUid)}, ${ref.surah}, ${ref.ayah}, ${columns.map(column => sql(values[column])).join(', ')})
      `);
    } catch (err) {
      if (err && (err.code === 'ER_DUP_ENTRY' || Number(err.errno) === 1062)) throw conflictError();
      throw err;
    }
  } else {
    const result = await global.query(`
      UPDATE ${TABLE}
      SET ${columns.map(column => `${column}=${sql(values[column])}`).join(', ')}, row_version=row_version+1
      WHERE id=${Number(existing.id)} AND row_version=${Number(existing.row_version)}
    `);
    if (!result.affectedRows) {
      throw conflictError();
    }
  }
  return get(userUid, ref.surah, ref.ayah);
}

async function setRefsState(userUid, refsValue, stateValue) {
  await ensureTables();
  const inputs = refInputs(refsValue);
  if (!inputs.length || inputs.length > 500 || inputs.some(value => !parseRefInput(value))) {
    const err = new Error('Between 1 and 500 canonical Quran ayah references are required.');
    err.status = 400;
    throw err;
  }
  const refs = normalizeRefs(refsValue, 500);
  const state = (stateValue || '').toString().trim().toLowerCase();
  if (!USER_SELECTABLE_LIFECYCLE_STATES.has(state)) {
    const err = new Error(state === 'relearning'
      ? 'Relearning is assigned automatically after a failed review.'
      : 'Unsupported memorization lifecycle state.');
    err.status = 400;
    throw err;
  }
  const settings = await UserSettings.getSettings(userUid);
  const changedCount = await transaction(async function (q) {
    const refTuples = refs.map(ref => `(${ref.surah},${ref.ayah})`).join(',');
    const existing = await q(`
      SELECT *
      FROM ${TABLE}
      WHERE user_uid=${sql(userUid)} AND (surah_number,ayah_number) IN (${refTuples})
      FOR UPDATE
    `) || [];
    const byRef = new Map(existing.map(row => [`${Number(row.surah_number)}:${Number(row.ayah_number)}`, row]));
    const changedRows = [];
    refs.forEach(ref => {
      const row = byRef.get(`${ref.surah}:${ref.ayah}`);
      if (!row && state === 'later') return;
      if (row && row.lifecycle_state === state) return;
      const current = decorate(row || defaultRecord(ref));
      if (!bulkStateTransitionAllowed(current.lifecycle_state, state)) {
        const err = new Error('An enrolled page or surah can only be marked Easy, Paused, or Later.');
        err.status = 409;
        throw err;
      }
      const values = stateUpdateValues(current, state, settings.memorization.fsrs);
      changedRows.push({ ref, values });
    });
    if (!changedRows.length) return 0;
    const batches = new Map();
    changedRows.forEach(item => {
      const columns = Object.keys(item.values).sort();
      const signature = columns.join(',');
      if (!batches.has(signature)) batches.set(signature, { columns, rows: [] });
      batches.get(signature).rows.push(item);
    });
    for (const batch of batches.values()) {
      const tuples = batch.rows.map(item => `(${sql(userUid)},${item.ref.surah},${item.ref.ayah},${batch.columns.map(column => sql(item.values[column])).join(',')})`);
      await q(`
        INSERT INTO ${TABLE} (user_uid,surah_number,ayah_number,${batch.columns.join(',')})
        VALUES ${tuples.join(',')}
        ON DUPLICATE KEY UPDATE
          ${batch.columns.map(column => `${column}=VALUES(${column})`).join(',')},
          row_version=row_version+1
      `);
    }
    return changedRows.length;
  });
  const ayahs = await getMany(userUid, refs);
  return {
    ayah_count: refs.length,
    changed_count: changedCount,
    lifecycle_state: state,
    ayahs
  };
}

async function setSurahState(userUid, surahValue, stateValue) {
  const ref = parseRef(surahValue, 1);
  if (!ref) {
    const err = new Error('A valid Quran surah is required.');
    err.status = 400;
    throw err;
  }
  const ayahCount = CANONICAL_AYAH_COUNTS[ref.surah - 1];
  const result = await setRefsState(
    userUid,
    Array.from({ length: ayahCount }, (_, index) => `${ref.surah}:${index + 1}`),
    stateValue
  );
  return Object.assign({ surah_number: ref.surah }, result);
}

function buildMushafPageRefs(rows) {
  const seen = new Set();
  return (rows || []).map(row => parseRef(row.surah, row.ayah)).filter(ref => {
    if (!ref) return false;
    const key = `${ref.surah}:${ref.ayah}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(ref => `${ref.surah}:${ref.ayah}`);
}

async function mushafPageRefs(pageValue) {
  const pageNumber = strictInteger(pageValue);
  if (!pageNumber || pageNumber > 604) {
    const err = new Error('A valid Mushaf page from 1 through 604 is required.');
    err.status = 400;
    throw err;
  }
  const rows = await global.query(`
    SELECT word.surah, word.ayah, MIN(word.global_word_id) AS first_word_id
    FROM quran_mushaf_pages line
    JOIN quran_mushaf_words word
      ON word.global_word_id BETWEEN line.first_word_id AND line.last_word_id
    WHERE line.page_number=${pageNumber} AND line.line_type='ayah'
      AND word.is_ayah_marker=0
    GROUP BY word.surah, word.ayah
    ORDER BY first_word_id
  `) || [];
  const refs = buildMushafPageRefs(rows);
  if (!refs.length) {
    const err = new Error('No Quran ayat were found on this Mushaf page.');
    err.status = 404;
    throw err;
  }
  return { page_number: pageNumber, refs };
}

async function setMushafPageState(userUid, pageValue, stateValue) {
  const page = await mushafPageRefs(pageValue);
  const result = await setRefsState(userUid, page.refs, stateValue);
  return Object.assign({ page_number: page.page_number }, result);
}

async function markSurahCore(userUid, surahValue) {
  return setSurahState(userUid, surahValue, 'core');
}

function isCleanCoreRow(row) {
  return Boolean(row && row.lifecycle_state === 'core' && row.fully_memorized_at
    && !row.next_review_at && Number(row.relearning_step) === 0
    && !row.suspended_at && !row.suspended_from_state);
}

function buildCoreSurahStatuses(surahValues, rows) {
  const surahs = Array.from(new Set((Array.isArray(surahValues) ? surahValues : [surahValues])
    .map(strictInteger)
    .filter(value => value && value <= CANONICAL_AYAH_COUNTS.length)));
  if (!surahs.length) return [];
  const requested = new Set(surahs);
  const canonicalRefs = new Set((rows || []).map(row => parseRef(row.surah_number, row.ayah_number))
    .filter(ref => ref && requested.has(ref.surah))
    .map(ref => `${ref.surah}:${ref.ayah}`));
  return surahs.map(surah => {
    const ayahCount = CANONICAL_AYAH_COUNTS[surah - 1];
    let coreCount = 0;
    for (let ayah = 1; ayah <= ayahCount; ayah += 1) {
      if (canonicalRefs.has(`${surah}:${ayah}`)) coreCount += 1;
    }
    return {
      surah_number: surah,
      ayah_count: ayahCount,
      core_count: coreCount,
      is_core: coreCount === ayahCount
    };
  });
}

async function coreSurahStatuses(userUid, surahValues) {
  const statuses = await surahStateStatuses(userUid, surahValues);
  return statuses.map(status => ({
    surah_number: status.surah_number,
    ayah_count: status.ayah_count,
    core_count: status.counts.core,
    is_core: status.uniform_state === 'core'
  }));
}

function buildSurahStateStatuses(surahValues, rows) {
  const surahs = Array.from(new Set((Array.isArray(surahValues) ? surahValues : [surahValues])
    .map(strictInteger)
    .filter(value => value && value <= CANONICAL_AYAH_COUNTS.length)));
  const requested = new Set(surahs);
  const byRef = new Map();
  (rows || []).forEach(row => {
    const ref = parseRef(row.surah_number, row.ayah_number);
    if (!ref || !requested.has(ref.surah) || !LIFECYCLE_STATES.has(row.lifecycle_state)) return;
    byRef.set(`${ref.surah}:${ref.ayah}`, row.lifecycle_state);
  });
  return surahs.map(surah => {
    const ayahCount = CANONICAL_AYAH_COUNTS[surah - 1];
    const counts = { later: 0, learning: 0, weak: 0, review: 0, core: 0, relearning: 0, suspended: 0 };
    for (let ayah = 1; ayah <= ayahCount; ayah += 1)
      counts[byRef.get(`${surah}:${ayah}`) || 'later'] += 1;
    const uniformState = stateArray().find(state => counts[state] === ayahCount) || null;
    return { surah_number: surah, ayah_count: ayahCount, counts, uniform_state: uniformState };
  });
}

function stateArray() {
  return Array.from(LIFECYCLE_STATES);
}

async function surahStateStatuses(userUid, surahValues) {
  await ensureTables();
  const surahs = Array.from(new Set((Array.isArray(surahValues) ? surahValues : [surahValues])
    .map(strictInteger)
    .filter(value => value && value <= CANONICAL_AYAH_COUNTS.length)));
  if (!surahs.length) return [];
  const rows = await global.query(`
    SELECT surah_number, ayah_number, lifecycle_state
    FROM ${TABLE}
    WHERE user_uid=${sql(userUid)} AND surah_number IN (${surahs.join(',')})
  `) || [];
  return buildSurahStateStatuses(surahs, rows);
}

async function recordLearningActivity(userUid, surahValue, ayahValue, progressValue, options) {
  const ref = await assertCanonicalRef(surahValue, ayahValue);
  let existing = await get(userUid, ref.surah, ref.ayah);
  const expectedVersion = expectedRowVersion(options);
  if (expectedVersion !== null && expectedVersion !== Number(existing.row_version)) throw conflictError();
  if (existing.id && !['later', 'learning'].includes(existing.lifecycle_state)) {
    const err = new Error('Move this ayah to Learning before recording learning activity.');
    err.status = 409;
    throw err;
  }
  const rawProgress = progressValue === undefined || progressValue === null || progressValue === ''
    ? (existing.learning_progress || 'started')
    : progressValue;
  const progress = rawProgress.toString().trim().toLowerCase();
  if (!LEARNING_PROGRESS.has(progress)) {
    const err = new Error('Unsupported learning progress value.');
    err.status = 400;
    throw err;
  }
  if (!existing.id) {
    try {
      await global.query(`
        INSERT INTO ${TABLE}
          (user_uid,surah_number,ayah_number,lifecycle_state,learning_progress,learning_started_at,learning_last_worked_at,
           next_review_at,stability,difficulty,fsrs_state,fsrs_scheduled_days,fsrs_learning_steps,fsrs_version)
        VALUES
          (${sql(userUid)},${ref.surah},${ref.ayah},'learning',${sql(progress)},NOW(),NOW(),NULL,0,0,0,0,0,${QuranFsrs.FSRS_VERSION})
      `);
    } catch (err) {
      if (err && (err.code === 'ER_DUP_ENTRY' || Number(err.errno) === 1062)) throw conflictError();
      throw err;
    }
  } else {
    const result = await global.query(`
      UPDATE ${TABLE}
      SET lifecycle_state='learning', learning_progress=${sql(progress)},
        learning_started_at=COALESCE(learning_started_at,NOW()), learning_last_worked_at=NOW(),
        next_review_at=CASE WHEN review_count=0 AND last_reviewed_at IS NULL THEN NULL ELSE next_review_at END,
        stability=CASE WHEN review_count=0 AND last_reviewed_at IS NULL THEN 0 ELSE stability END,
        difficulty=CASE WHEN review_count=0 AND last_reviewed_at IS NULL THEN 0 ELSE difficulty END,
        fsrs_state=CASE WHEN review_count=0 AND last_reviewed_at IS NULL THEN 0 ELSE fsrs_state END,
        fsrs_scheduled_days=CASE WHEN review_count=0 AND last_reviewed_at IS NULL THEN 0 ELSE fsrs_scheduled_days END,
        fsrs_learning_steps=CASE WHEN review_count=0 AND last_reviewed_at IS NULL THEN 0 ELSE fsrs_learning_steps END,
        fsrs_version=${QuranFsrs.FSRS_VERSION}, suspended_at=NULL, suspended_from_state=NULL, row_version=row_version+1
      WHERE id=${Number(existing.id)} AND row_version=${Number(existing.row_version)}
    `);
    if (!result.affectedRows) throw conflictError();
  }
  return get(userUid, ref.surah, ref.ayah);
}

function elapsedDaysSince(value, nowValue) {
  if (!value) return null;
  const reviewedAt = new Date(value).getTime();
  const now = nowValue === undefined ? Date.now() : new Date(nowValue).getTime();
  if (!Number.isFinite(reviewedAt) || !Number.isFinite(now)) return null;
  return Math.max(0, (now - reviewedAt) / 86400000);
}

function reviewMetricSql(value) {
  if (value === undefined || value === null || value === '') return 'NULL';
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 && number <= 4294967295 ? number : 'NULL';
}

function reviewUndoSnapshot(memory, item) {
  const memoryFields = [
    'lifecycle_state', 'learning_progress', 'learning_last_worked_at', 'fully_memorized_at',
    'stability', 'difficulty', 'last_reviewed_at', 'next_review_at', 'review_count',
    'lapse_count', 'consecutive_successes', 'last_grade', 'relearning_step', 'fsrs_state',
    'fsrs_scheduled_days', 'fsrs_learning_steps', 'fsrs_version', 'row_version'
  ];
  const itemFields = [
    'item_state', 'attempts', 'current_token', 'presented_at', 'last_attempt_token',
    'last_attempt_grade', 'last_retry_queued'
  ];
  return {
    memory: memoryFields.reduce((snapshot, field) => {
      snapshot[field] = memory[field] === undefined ? null : memory[field];
      return snapshot;
    }, {}),
    item: itemFields.reduce((snapshot, field) => {
      snapshot[field] = item[field] === undefined ? null : item[field];
      return snapshot;
    }, {})
  };
}

function parseUndoSnapshot(value) {
  if (!value) return null;
  if (Buffer.isBuffer(value)) value = value.toString('utf8');
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch (_err) { return null; }
  }
  return typeof value === 'object' ? value : null;
}

function undoDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function shouldQueueReviewRetry(grade, attempts) {
  return grade === 'again' && Number(attempts) + 1 < MAX_AGAIN_GRADES_PER_SESSION_ITEM;
}

function reviewSchedule(existing, grade, settings, nowValue) {
  return QuranFsrs.schedule(existing, grade, settings, nowValue);
}

async function recordReview(userUid, surahValue, ayahValue, gradeValue, options) {
  await ensureTables();
  const ref = await assertCanonicalRef(surahValue, ayahValue);
  const grade = (gradeValue || '').toString().trim().toLowerCase();
  if (!REVIEW_GRADES.has(grade)) {
    const err = new Error('Unsupported review result.');
    err.status = 400;
    throw err;
  }
  const existing = await get(userUid, ref.surah, ref.ayah);
  if (grade === 'skip') return { ayah: existing, skipped: true };
  if (!REVIEWABLE_LIFECYCLE_STATES.has(existing.lifecycle_state)) {
    const err = new Error('This ayah is not currently available for recall review.');
    err.status = 409;
    throw err;
  }
  const sessionId = (options && options.sessionId || '').toString().trim().slice(0, 64);
  if (!sessionId) {
    const err = new Error('A review session is required.');
    err.status = 400;
    throw err;
  }
  const expectedVersion = expectedRowVersion(options);
  if (expectedVersion !== null && expectedVersion !== Number(existing.row_version)) throw conflictError();
  const elapsedDays = elapsedDaysSince(existing.last_reviewed_at || existing.fully_memorized_at);
  const schedule = reviewSchedule(existing, grade, options && options.fsrs);
  const result = await global.query(`
    UPDATE ${TABLE}
    SET lifecycle_state=${sql(schedule.lifecycle_state)},
      learning_progress=${schedule.learning_progress === undefined ? 'learning_progress' : sql(schedule.learning_progress)},
      learning_last_worked_at=${existing.lifecycle_state === 'learning' ? 'NOW()' : 'learning_last_worked_at'},
      fully_memorized_at=${schedule.graduated ? 'COALESCE(fully_memorized_at,NOW())' : 'fully_memorized_at'},
      stability=${Number(schedule.stability).toFixed(6)}, difficulty=${Number(schedule.difficulty).toFixed(6)},
      last_reviewed_at=NOW(), next_review_at=${sql(schedule.due)},
      review_count=review_count+1, lapse_count=${Number(schedule.lapse_count)},
      consecutive_successes=${Number(schedule.consecutive_successes)}, last_grade=${sql(grade)},
      relearning_step=${Number(schedule.relearning_step)}, fsrs_state=${Number(schedule.fsrs_state)},
      fsrs_scheduled_days=${Number(schedule.scheduled_days)}, fsrs_learning_steps=${Number(schedule.learning_steps)},
      fsrs_version=${QuranFsrs.FSRS_VERSION}, row_version=row_version+1
    WHERE id=${Number(existing.id)} AND row_version=${Number(existing.row_version)}
  `);
  if (!result.affectedRows) throw conflictError();
  await global.query(`
    INSERT INTO ${HISTORY_TABLE}
      (user_uid, surah_number, ayah_number, grade, lifecycle_state_before, lifecycle_state_after,
       scheduled_interval, actual_elapsed_time, duration_seconds, mistake_count, prompt_count, session_id)
    VALUES
      (${sql(userUid)}, ${ref.surah}, ${ref.ayah}, ${sql(grade)}, ${sql(existing.lifecycle_state)},
       ${sql(schedule.lifecycle_state)}, ${Number(schedule.interval)}, ${elapsedDays === null ? 'NULL' : elapsedDays.toFixed(3)},
       ${reviewMetricSql(options && options.durationSeconds)},
       ${reviewMetricSql(options && options.mistakeCount)},
       ${reviewMetricSql(options && options.promptCount)}, ${sql(sessionId)})
  `);
  return { ayah: await get(userUid, ref.surah, ref.ayah), skipped: false, interval_days: schedule.interval };
}

async function metadataForRows(rows) {
  if (!rows.length) return rows;
  const refs = rows.map(row => `(${Number(row.surah_number)},${Number(row.ayah_number)})`).join(',');
  // Aggregate in JavaScript instead of GROUP_CONCAT. Long āyāt can exceed
  // MySQL's session group_concat_max_len and must never be silently truncated.
  if (!mushafPageRangesPromise) {
    mushafPageRangesPromise = global.query(`
      SELECT page_number, MIN(first_word_id) AS first_word_id, MAX(last_word_id) AS last_word_id
      FROM quran_mushaf_pages
      WHERE first_word_id IS NOT NULL AND last_word_id IS NOT NULL
      GROUP BY page_number
      ORDER BY first_word_id
    `).catch(err => {
      mushafPageRangesPromise = null;
      throw err;
    });
  }
  const [wordsResult, pageRangesResult] = await Promise.all([
    global.query(`
      SELECT word.surah, word.ayah, word.global_word_id, word.is_ayah_marker,
        COALESCE(word.source_text, corpus.text) AS arabic_word,
        COALESCE(word.source_meaning_en, corpus.meaning_en) AS translation_word
      FROM quran_mushaf_words word
      LEFT JOIN quran_corpus_words corpus ON corpus.id=word.corpus_word_id
      WHERE (word.surah, word.ayah) IN (${refs})
      ORDER BY word.surah, word.ayah, word.global_word_id
    `),
    mushafPageRangesPromise
  ]);
  const words = wordsResult || [];
  const pageRanges = pageRangesResult || [];
  const pageForWord = globalWordId => {
    let low = 0;
    let high = pageRanges.length - 1;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const range = pageRanges[middle];
      if (globalWordId < Number(range.first_word_id)) high = middle - 1;
      else if (globalWordId > Number(range.last_word_id)) low = middle + 1;
      else return Number(range.page_number) || null;
    }
    return null;
  };
  const byRef = new Map();
  words.forEach(word => {
    const key = `${word.surah}:${word.ayah}`;
    if (!byRef.has(key)) byRef.set(key, { page_number: null, arabic: [], translation: [] });
    const item = byRef.get(key);
    const page = pageForWord(Number(word.global_word_id));
    if (Number.isInteger(page) && (!item.page_number || page < item.page_number)) item.page_number = page;
    if (!Number(word.is_ayah_marker)) {
      if (word.arabic_word) item.arabic.push(word.arabic_word.toString().trim());
      if (word.translation_word) item.translation.push(word.translation_word.toString().trim());
    }
  });
  rows.forEach(row => {
    const item = byRef.get(`${row.surah_number}:${row.ayah_number}`) || {};
    const surah = (global.surahs || []).find(value => Number(value.num) === Number(row.surah_number));
    row.reference = `${row.surah_number}:${row.ayah_number}`;
    row.surah_name = surah && (surah.name_en || surah.name_ar) || `Surah ${row.surah_number}`;
    row.surah_alternate_names = surah ? (surah.aliases || []).concat(surah.name_ar || []).filter(Boolean).join(' ') : '';
    row.page_number = Number(item.page_number) || null;
    row.arabic_text = (item.arabic || []).filter(Boolean).join(' ');
    row.translation_en = (item.translation || []).filter(Boolean).join(' ');
    decorate(row);
  });
  return rows;
}

function firstWords(value, maximum = 4) {
  return (value || '').toString().trim().split(/\s+/).filter(Boolean).slice(0, maximum).join(' ');
}

function buildProgressGroupDefinitions(lineCounts, ayahStarts, pageStarts) {
  const shortSurahs = new Set((lineCounts || [])
    .filter(row => Number(row.line_count) <= 30)
    .map(row => Number(row.surah))
    .filter(Number.isInteger));
  const groupsByKey = new Map();
  const groupKeyByRef = new Map();
  const pageByRef = new Map();

  (ayahStarts || []).forEach(row => {
    const surah = Number(row.surah);
    const ayah = Number(row.ayah);
    const page = Number(row.page_number);
    const firstWordId = Number(row.first_word_id);
    if (!parseRef(surah, ayah) || !Number.isInteger(page) || page < 1) return;
    const isShortSurah = shortSurahs.has(surah);
    const groupKey = isShortSurah ? `surah:${surah}` : `surah-page:${surah}:${page}`;
    if (!groupsByKey.has(groupKey)) {
      groupsByKey.set(groupKey, {
        group_key: groupKey,
        group_type: isShortSurah ? 'surah' : 'page',
        unit_label: isShortSurah ? 'Whole surah' : `Page ${page}`,
        page_number: page,
        surah_number: surah,
        start_surah_number: surah,
        start_ayah_number: ayah,
        order_word_id: firstWordId,
        member_refs: [],
        surah_numbers: [surah]
      });
    }
    const group = groupsByKey.get(groupKey);
    group.member_refs.push(`${surah}:${ayah}`);
    if (!Number.isFinite(group.order_word_id) || firstWordId < group.order_word_id) {
      group.order_word_id = firstWordId;
      group.page_number = page;
      group.start_ayah_number = ayah;
    }
    groupKeyByRef.set(`${surah}:${ayah}`, groupKey);
    pageByRef.set(`${surah}:${ayah}`, page);
  });

  return {
    groups: Array.from(groupsByKey.values()).sort((left, right) =>
      left.surah_number - right.surah_number || left.page_number - right.page_number || left.order_word_id - right.order_word_id),
    groupKeyByRef,
    pageByRef,
    shortSurahs
  };
}

function buildProgressGeometry(lineRows, wordRows) {
  const lines = (lineRows || []).map(row => ({
    page_number: Number(row.page_number),
    line_number: Number(row.line_number),
    first_word_id: Number(row.first_word_id),
    last_word_id: Number(row.last_word_id)
  })).filter(row => Number.isInteger(row.page_number)
    && Number.isFinite(row.first_word_id) && Number.isFinite(row.last_word_id))
    .sort((left, right) => left.first_word_id - right.first_word_id);
  const words = (wordRows || []).map(row => ({
    surah: Number(row.surah),
    ayah: Number(row.ayah),
    global_word_id: Number(row.global_word_id)
  })).filter(row => parseRef(row.surah, row.ayah) && Number.isFinite(row.global_word_id))
    .sort((left, right) => left.global_word_id - right.global_word_id);
  const lineCountBySurah = new Map();
  const pageStartByNumber = new Map();
  const pageRangeByNumber = new Map();
  let wordIndex = 0;

  lines.forEach(line => {
    const range = pageRangeByNumber.get(line.page_number) || {
      page_number: line.page_number,
      first_word_id: line.first_word_id,
      last_word_id: line.last_word_id
    };
    range.first_word_id = Math.min(range.first_word_id, line.first_word_id);
    range.last_word_id = Math.max(range.last_word_id, line.last_word_id);
    pageRangeByNumber.set(line.page_number, range);
    while (wordIndex < words.length && words[wordIndex].global_word_id < line.first_word_id) wordIndex += 1;
    let cursor = wordIndex;
    const lineSurahs = new Set();
    while (cursor < words.length && words[cursor].global_word_id <= line.last_word_id) {
      const word = words[cursor];
      lineSurahs.add(word.surah);
      if (!pageStartByNumber.has(line.page_number)) {
        pageStartByNumber.set(line.page_number, {
          page_number: line.page_number,
          surah: word.surah,
          ayah: word.ayah,
          first_word_id: word.global_word_id
        });
      }
      cursor += 1;
    }
    wordIndex = cursor;
    lineSurahs.forEach(surah => lineCountBySurah.set(surah, (lineCountBySurah.get(surah) || 0) + 1));
  });

  const pageRanges = Array.from(pageRangeByNumber.values()).sort((left, right) => left.first_word_id - right.first_word_id);
  const pageForWord = globalWordId => {
    let low = 0;
    let high = pageRanges.length - 1;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const range = pageRanges[middle];
      if (globalWordId < range.first_word_id) high = middle - 1;
      else if (globalWordId > range.last_word_id) low = middle + 1;
      else return range.page_number;
    }
    return null;
  };
  const ayahStartByRef = new Map();
  words.forEach(word => {
    const key = `${word.surah}:${word.ayah}`;
    if (ayahStartByRef.has(key)) return;
    ayahStartByRef.set(key, {
      surah: word.surah,
      ayah: word.ayah,
      first_word_id: word.global_word_id,
      page_number: pageForWord(word.global_word_id)
    });
  });
  return {
    lineCounts: Array.from(lineCountBySurah, ([surah, line_count]) => ({ surah, line_count })),
    ayahStarts: Array.from(ayahStartByRef.values()).filter(row => Number.isInteger(row.page_number)),
    pageStarts: Array.from(pageStartByNumber.values()).sort((left, right) => left.page_number - right.page_number)
  };
}

function surahMetadata(surahNumber) {
  const surah = (global.surahs || []).find(value => Number(value.num) === Number(surahNumber));
  return {
    name: surah && (surah.name_en || surah.name_ar) || `Surah ${surahNumber}`,
    aliases: surah
      ? [].concat(surah.aliases || [], surah.name_ar || []).filter(Boolean).map(value => value.toString())
      : []
  };
}

function juzNumbersForRefs(refs, juzRows) {
  const starts = (juzRows || []).map(row => {
    const start = Number(row.num) === 1 ? { surah: 1, ayah: 1 } : parseRefString(row.start || row.visual_start);
    return start ? { num: Number(row.num), surah: start.surah, ayah: start.ayah } : null;
  }).filter(item => item && Number.isInteger(item.num) && item.num >= 1 && item.num <= 30)
    .sort((left, right) => left.surah - right.surah || left.ayah - right.ayah);
  const numbers = new Set();
  (refs || []).forEach(value => {
    const ref = parseRefString(value);
    if (!ref) return;
    const current = starts.filter(start => start.surah < ref.surah || (start.surah === ref.surah && start.ayah <= ref.ayah)).pop();
    if (current) numbers.add(current.num);
  });
  return Array.from(numbers).sort((left, right) => left - right);
}

async function progressGroupDefinitions() {
  if (!progressGroupDefinitionsPromise) {
    progressGroupDefinitionsPromise = (async function () {
      const [lines, words] = await Promise.all([
        global.query(`
          SELECT page_number, line_number, first_word_id, last_word_id
          FROM quran_mushaf_pages
          WHERE line_type='ayah' AND first_word_id IS NOT NULL AND last_word_id IS NOT NULL
          ORDER BY first_word_id
        `),
        global.query(`
          SELECT surah, ayah, global_word_id
          FROM quran_mushaf_words
          WHERE is_ayah_marker=0
          ORDER BY global_word_id
        `)
      ]);
      const geometry = buildProgressGeometry(lines, words);
      const definitions = buildProgressGroupDefinitions(
        geometry.lineCounts,
        geometry.ayahStarts,
        geometry.pageStarts
      );
      const startRows = definitions.groups.map(group => ({
        surah_number: group.start_surah_number,
        ayah_number: group.start_ayah_number
      }));
      const startReferences = startRows.map(row => `${row.surah_number}:${row.ayah_number}`);
      const [metadata, searchableAyat, juzRows] = await Promise.all([
        metadataForRows(startRows),
        global.query(`
          SELECT num AS reference, search_body
          FROM hadiths
          WHERE bookId=(SELECT id FROM books WHERE alias='quran' LIMIT 1)
            AND num IN (${startReferences.map(sql).join(',')})
        `),
        QuranTocSubdivisions.juzRows()
      ]);
      const metadataByRef = new Map(metadata.map(row => [`${row.surah_number}:${row.ayah_number}`, row]));
      const searchableByRef = new Map((searchableAyat || []).map(row => [row.reference, row.search_body]));
      definitions.groups.forEach(group => {
        const startRef = `${group.start_surah_number}:${group.start_ayah_number}`;
        const opening = metadataByRef.get(startRef) || {};
        const startSurah = surahMetadata(group.start_surah_number);
        const hiddenNames = [];
        Array.from(new Set([group.start_surah_number].concat(group.surah_numbers))).forEach(surahNumber => {
          const item = surahMetadata(surahNumber);
          if (item.name !== startSurah.name) hiddenNames.push(item.name);
          hiddenNames.push(...item.aliases);
        });
        group.start_reference = startRef;
        group.surah_name = startSurah.name;
        group.surah_alternate_names = Array.from(new Set(hiddenNames.filter(Boolean)));
        group.opening_arabic = firstWords(opening.arabic_text, 4);
        group.opening_searchable = firstWords(searchableByRef.get(startRef), 4);
        group.juz_numbers = juzNumbersForRefs(group.member_refs, juzRows);
      });
      return definitions;
    }()).catch(function (err) {
      progressGroupDefinitionsPromise = null;
      throw err;
    });
  }
  return progressGroupDefinitionsPromise;
}

async function setProgressGroupState(userUid, groupKeyValue, stateValue) {
  const groupKey = (groupKeyValue || '').toString().trim();
  const state = (stateValue || '').toString().trim().toLowerCase();
  if (!ENROLLED_BULK_USER_SELECTABLE_LIFECYCLE_STATES.has(state)) {
    const err = new Error('A page or short surah can only be marked Easy, Paused, or Later from Memorization Progress.');
    err.status = 400;
    throw err;
  }
  const definitions = await progressGroupDefinitions();
  const group = definitions.groups.find(item => item.group_key === groupKey);
  if (!group) {
    const err = new Error('The requested memorization group was not found.');
    err.status = 404;
    throw err;
  }
  const result = await setRefsState(userUid, group.member_refs, state);
  return Object.assign({
    group_key: group.group_key,
    group_type: group.group_type,
    page_number: group.page_number,
    surah_number: group.surah_number
  }, result);
}

function buildProgressGroups(definitions, rows, nowValue) {
  const now = nowValue === undefined ? Date.now() : new Date(nowValue).getTime();
  const groupsByKey = new Map();
  const metricsByPage = new Map();
  const definitionsByKey = new Map(definitions.groups.map(group => [group.group_key, group]));
  const pageCountsBySurah = new Map();
  definitions.groups.forEach(group => {
    const surah = Number(group.surah_number);
    if (!pageCountsBySurah.has(surah)) pageCountsBySurah.set(surah, new Set());
    pageCountsBySurah.get(surah).add(Number(group.page_number));
  });
  (rows || []).forEach(row => {
    const lifecycleState = (row.lifecycle_state || '').toString();
    if (!['learning', 'weak', 'review', 'core', 'relearning', 'suspended'].includes(lifecycleState)) return;
    const state = lifecycleState === 'relearning' ? 'weak' : lifecycleState;
    const groupKey = definitions.groupKeyByRef.get(`${Number(row.surah_number)}:${Number(row.ayah_number)}`);
    if (!groupKey) return;
    const definition = definitionsByKey.get(groupKey);
    if (!definition) return;
    const rowRef = `${Number(row.surah_number)}:${Number(row.ayah_number)}`;
    const rowPage = Number(definitions.pageByRef && definitions.pageByRef.get(rowRef));
    if (Number.isInteger(rowPage)) {
      const pageMetrics = metricsByPage.get(rowPage) || { difficulty_total: 0, difficulty_count: 0, stability_total: 0, stability_count: 0 };
      const pageDifficulty = Number(row.difficulty);
      const pageStability = Number(row.stability);
      if (Number.isFinite(pageDifficulty) && pageDifficulty > 0) {
        pageMetrics.difficulty_total += pageDifficulty;
        pageMetrics.difficulty_count += 1;
      }
      if (Number.isFinite(pageStability) && pageStability > 0) {
        pageMetrics.stability_total += pageStability;
        pageMetrics.stability_count += 1;
      }
      metricsByPage.set(rowPage, pageMetrics);
    }
    if (!groupsByKey.has(groupKey)) {
      groupsByKey.set(groupKey, Object.assign({}, definition, {
        counts: { learning: 0, weak: 0, review: 0, core: 0, relearning: 0, suspended: 0 },
        stage_start_references: {},
        stage_start_pages: {},
        active_ayah_count: 0,
        due_count: 0,
        new_count: 0,
        next_review_at: null,
        review_count: 0,
        difficulty_total: 0,
        difficulty_count: 0,
        stability_total: 0,
        stability_count: 0
      }));
    }
    const group = groupsByKey.get(groupKey);
    group.counts[state] += 1;
    if (!group.stage_start_references[state]) {
      const statePage = Number(definitions.pageByRef && definitions.pageByRef.get(rowRef));
      group.stage_start_references[state] = rowRef;
      if (Number.isInteger(statePage) && statePage >= 1 && statePage <= 604)
        group.stage_start_pages[state] = statePage;
    }
    group.active_ayah_count += 1;
    group.review_count += Math.max(0, Number(row.review_count) || 0);
    const difficulty = Number(row.difficulty);
    const stability = Number(row.stability);
    if (Number.isFinite(difficulty) && difficulty > 0) {
      group.difficulty_total += difficulty;
      group.difficulty_count += 1;
    }
    if (Number.isFinite(stability) && stability > 0) {
      group.stability_total += stability;
      group.stability_count += 1;
    }
    if (REVIEWABLE_LIFECYCLE_STATES.has(lifecycleState) && Number(row.fsrs_state) === 0) {
      group.new_count += 1;
      if (lifecycleState !== 'weak') group.due_count += 1;
    }
    if (REVIEWABLE_LIFECYCLE_STATES.has(lifecycleState) && [1, 2, 3].includes(Number(row.fsrs_state)) && row.next_review_at) {
      const reviewTime = new Date(row.next_review_at).getTime();
      if (Number.isFinite(reviewTime)) {
        const currentTime = group.next_review_at ? new Date(group.next_review_at).getTime() : Infinity;
        if (reviewTime < currentTime) group.next_review_at = row.next_review_at;
        const dueNow = row.is_due_now === undefined
          ? Number.isFinite(now) && reviewTime <= now
          : Number(row.is_due_now) === 1;
        if (dueNow) group.due_count += 1;
      }
    }
  });
  return definitions.groups
    .filter(definition => groupsByKey.has(definition.group_key))
    .map(definition => {
      const group = groupsByKey.get(definition.group_key);
      group.member_count = group.member_refs.length;
      group.surah_page_count = (pageCountsBySurah.get(Number(group.surah_number)) || new Set()).size;
      const metricScope = group.group_type === 'page' ? metricsByPage.get(Number(group.page_number)) : group;
      group.average_difficulty = metricScope && metricScope.difficulty_count ? metricScope.difficulty_total / metricScope.difficulty_count : null;
      group.average_stability = metricScope && metricScope.stability_count ? metricScope.stability_total / metricScope.stability_count : null;
      delete group.difficulty_total;
      delete group.difficulty_count;
      delete group.stability_total;
      delete group.stability_count;
      delete group.member_refs;
      delete group.order_word_id;
      return group;
    });
}

async function progressGroups(userUid) {
  await ensureTables();
  await initializeNewUserLearning(userUid);
  const [definitions, rows] = await Promise.all([
    progressGroupDefinitions(),
    global.query(`
      SELECT surah_number, ayah_number, lifecycle_state,
        ${utcDateColumnSql('next_review_at', 'next_review_at')}, review_count, fsrs_state, difficulty, stability,
        next_review_at<=NOW() AS is_due_now
      FROM ${TABLE} FORCE INDEX (progress_user_order)
      WHERE user_uid=${sql(userUid)}
        AND lifecycle_state IN ('learning','weak','review','core','relearning','suspended')
      ORDER BY surah_number, ayah_number
    `)
  ]);
  return buildProgressGroups(definitions, rows || []);
}

async function collection(userUid, stateValue) {
  await ensureTables();
  const requested = (stateValue || '').toString().trim().toLowerCase();
  const states = requested === 'memorized' ? ['review', 'core']
    : requested === 'needs-practice' ? ['relearning']
      : requested === 'paused' ? ['suspended']
        : requested === 'learning' ? ['learning']
          : requested === 'weak' ? ['weak', 'relearning']
          : requested === 'active' ? ['learning', 'weak', 'review', 'core', 'relearning', 'suspended']
            : LIFECYCLE_STATES.has(requested) ? [requested] : [];
  if (!states.length) {
    const err = new Error('Unsupported memorization collection.');
    err.status = 400;
    throw err;
  }
  const rows = await global.query(`
    SELECT *, ${memoryUtcDateColumns()}, next_review_at<=NOW() AS is_due_now
    FROM ${TABLE}
    WHERE user_uid=${sql(userUid)} AND lifecycle_state IN (${states.map(sql).join(',')})
    ORDER BY surah_number, ayah_number
  `) || [];
  return metadataForRows(rows);
}

async function progress(userUid) {
  await ensureTables();
  await initializeNewUserLearning(userUid);
  const counts = { later: 0, learning: 0, weak: 0, review: 0, core: 0, relearning: 0, suspended: 0, due_today: 0, new: 0, memorized: 0, total: 0 };
  counts.total = CANONICAL_AYAH_COUNTS.reduce((sum, value) => sum + value, 0);
  const rows = await global.query(`
    SELECT lifecycle_state, COUNT(*) AS count,
      SUM(CASE
        WHEN lifecycle_state IN ('learning','weak','review','relearning')
          AND ((lifecycle_state<>'weak' AND fsrs_state=0)
            OR (fsrs_state IN (1,2,3) AND next_review_at<=NOW())) THEN 1
        ELSE 0
      END) AS due_count,
      SUM(CASE WHEN lifecycle_state IN ('learning','weak','review','relearning') AND fsrs_state=0 THEN 1 ELSE 0 END) AS new_count
    FROM ${TABLE} FORCE INDEX (fsrs_due_ayahs)
    WHERE user_uid=${sql(userUid)}
    GROUP BY lifecycle_state
  `) || [];
  let explicit = 0;
  rows.forEach(row => {
    const count = Number(row.count) || 0;
    counts[row.lifecycle_state] = count;
    if (row.lifecycle_state === 'relearning') counts.weak += count;
    explicit += count;
    counts.due_today += Number(row.due_count) || 0;
    counts.new += Number(row.new_count) || 0;
  });
  counts.later += Math.max(0, counts.total - explicit);
  counts.memorized = counts.review + counts.core;
  return counts;
}

async function rescheduleForTargetRetention(userUid, fsrsSettings) {
  await ensureTables();
  const modifier = QuranFsrs.intervalModifier(fsrsSettings);
  const result = await global.query(`
    UPDATE ${TABLE}
    SET fsrs_scheduled_days=LEAST(36500,GREATEST(1,ROUND(stability*${modifier.toFixed(8)}))),
      next_review_at=DATE_ADD(
        COALESCE(last_reviewed_at,learning_last_worked_at,fully_memorized_at,updated_at),
        INTERVAL LEAST(36500,GREATEST(1,ROUND(stability*${modifier.toFixed(8)}))) DAY
      ),
      row_version=row_version+1
    WHERE user_uid=${sql(userUid)}
      AND lifecycle_state IN ('learning','weak','review','relearning')
      AND fsrs_state IN (1,2,3)
      AND stability>0
  `);
  const current = await progress(userUid);
  return {
    rescheduled_count: Math.max(0, Number(result && result.affectedRows) || 0),
    due_now: Math.max(0, Number(current.due_today) || 0)
  };
}

function sessionOrderSql(settings) {
  const order = settings && settings.memorization && settings.memorization.reviewOrder;
  if (order === 'quran_order' || order === 'page_order') return 'surah_number, ayah_number';
  if (order === 'random') return 'RAND()';
  return 'next_review_at, surah_number, ayah_number';
}

function boundedSessionLimit(value, fallback, maximum) {
  const parsed = parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= maximum ? parsed : fallback;
}

function reviewSessionLimits(settings) {
  const memorization = settings && settings.memorization || {};
  const weakLimit = boundedSessionLimit(memorization.weakLimit, REVIEW_SESSION_DEFAULTS.weak, 50);
  return {
    total: boundedSessionLimit(memorization.reviewLimit, REVIEW_SESSION_DEFAULTS.total, 200),
    learning: boundedSessionLimit(memorization.learningLimit, REVIEW_SESSION_DEFAULTS.learning, 50),
    relearning: weakLimit,
    weak: weakLimit,
    memorized: boundedSessionLimit(memorization.memorizedLimit, REVIEW_SESSION_DEFAULTS.memorized, 200)
  };
}

function normalizeSelectionLimits(value, total) {
  const source = value && typeof value === 'object'
    ? value
    : { relearning: value };
  const weakLimit = boundedSessionLimit(source.weak === undefined ? source.relearning : source.weak, REVIEW_SESSION_DEFAULTS.weak, 50);
  return {
    learning: boundedSessionLimit(source.learning, REVIEW_SESSION_DEFAULTS.learning, 50),
    relearning: weakLimit,
    weak: weakLimit,
    memorized: boundedSessionLimit(source.memorized, Math.min(REVIEW_SESSION_DEFAULTS.memorized, total), 200)
  };
}

function allocateReviewCandidates(candidates, limits, totalLimit, categoryOrder) {
  const selected = { learning: [], relearning: [], weak: [], memorized: [] };
  let total = 0;
  while (total < totalLimit) {
    let added = false;
    categoryOrder.forEach(category => {
      if (total >= totalLimit) return;
      if (['relearning', 'weak'].includes(category)
        && selected.relearning.length + selected.weak.length >= limits.weak) return;
      const rows = candidates[category] || [];
      const index = selected[category].length;
      if (index >= Math.min(limits[category], rows.length)) return;
      selected[category].push(rows[index]);
      total += 1;
      added = true;
    });
    if (!added) break;
  }
  return selected;
}

function fillUnusedCapacityWithDueCards(selected, candidates, totalLimit, categoryOrder, limits) {
  let total = categoryOrder.reduce((sum, category) => sum + selected[category].length, 0);
  const overflow = {};
  categoryOrder.forEach(category => {
    const selectedRefs = new Set(selected[category].map(row => `${row.surah_number}:${row.ayah_number}`));
    overflow[category] = (candidates[category] || []).filter(row => Number(row.fsrs_state) !== 0
      && !selectedRefs.has(`${row.surah_number}:${row.ayah_number}`));
  });
  while (total < totalLimit) {
    let added = false;
    categoryOrder.forEach(category => {
      if (total >= totalLimit || !overflow[category].length) return;
      // Category settings are hard caps, not just allocation targets. A large
      // due backlog must not silently turn a bounded regular session into a
      // much larger workload.
      if (category === 'learning' && selected.learning.length >= limits.learning) return;
      if (['relearning', 'weak'].includes(category)
        && selected.relearning.length + selected.weak.length >= limits.weak) return;
      if (category === 'memorized' && selected.memorized.length >= limits.memorized) return;
      selected[category].push(overflow[category].shift());
      total += 1;
      added = true;
    });
    if (!added) break;
  }
  return selected;
}

function orderReviewItemsBySurah(items) {
  return (items || []).slice().sort((left, right) =>
    Number(left.surah_number) - Number(right.surah_number)
      || Number(left.ayah_number) - Number(right.ayah_number));
}

function diversifyReviewCandidatesBySurah(rows, chunkSizeValue) {
  const chunkSize = Math.max(1, parseInt(chunkSizeValue, 10) || 3);
  const groups = new Map();
  (rows || []).forEach(row => {
    const surahNumber = Number(row.surah_number);
    if (!groups.has(surahNumber)) groups.set(surahNumber, []);
    groups.get(surahNumber).push(row);
  });
  const queues = Array.from(groups.values());
  const diversified = [];
  let added = true;
  while (added) {
    added = false;
    queues.forEach(queue => {
      if (!queue.length) return;
      diversified.push(...queue.splice(0, chunkSize));
      added = true;
    });
  }
  return diversified;
}

async function reviewCategoryCandidates(q, userUid, category, limit, order, future, refsValue) {
  if (limit < 1) return [];
  const state = category === 'memorized' ? 'review' : category;
  const refs = normalizeRefs(refsValue);
  const scopeCondition = refs.length
    ? `AND (surah_number,ayah_number) IN (${refs.map(ref => `(${ref.surah},${ref.ayah})`).join(',')})`
    : '';
  const scheduleCondition = future
    ? '(fsrs_state=0 OR (fsrs_state IN (1,2,3) AND next_review_at IS NOT NULL AND next_review_at>NOW()))'
    : '(fsrs_state=0 OR (fsrs_state IN (1,2,3) AND next_review_at IS NOT NULL AND next_review_at<=NOW()))';
  const ordering = future
    ? `CASE WHEN last_reviewed_at>=DATE_SUB(NOW(),INTERVAL 24 HOUR) THEN 1 ELSE 0 END, ${order}`
    : order;
  // In a due session, initialized cards whose scheduled time has arrived must
  // come before untouched Learning cards. Otherwise each session can admit new
  // cards while leaving the same overdue Learning cards behind indefinitely.
  const initializationOrder = future
    ? 'CASE WHEN fsrs_state=0 THEN 0 ELSE 1 END'
    : 'CASE WHEN fsrs_state=0 THEN 1 ELSE 0 END';
  // Pull enough ordered candidates to see beyond even the longest surah
  // (Al-Baqarah has 286 ayat), then take small passages from each surah in
  // turn. A plain LIMIT lets one large bulk-enrolled surah monopolize every
  // regular session even while many other memorized surahs are overdue.
  const candidateLimit = refs.length ? limit : Math.min(6236, Math.max(300, limit * 30));
  const rows = await q(`
    SELECT surah_number, ayah_number, lifecycle_state, fsrs_state
    FROM ${TABLE}
    WHERE user_uid=${sql(userUid)} AND lifecycle_state=${sql(state)}
      AND ${scheduleCondition}
      ${scopeCondition}
    ORDER BY ${initializationOrder}, ${ordering}
    LIMIT ${candidateLimit} FOR UPDATE
  `) || [];
  return refs.length ? rows : diversifyReviewCandidatesBySurah(rows, 3);
}

async function selectReviewSessionItems(q, userUid, scheduledLimit, categoryLimitsValue, orderValue, refsValue) {
  const totalLimit = boundedSessionLimit(scheduledLimit, REVIEW_SESSION_DEFAULTS.total, 200);
  const limits = normalizeSelectionLimits(categoryLimitsValue, totalLimit);
  const order = orderValue || 'next_review_at, surah_number, ayah_number';
  const categoryOrder = ['learning', 'relearning', 'weak', 'memorized'];
  const candidates = {};
  for (const category of categoryOrder) {
    candidates[category] = await reviewCategoryCandidates(q, userUid, category, totalLimit, order, false, refsValue);
  }
  let selected = allocateReviewCandidates(candidates, limits, totalLimit, categoryOrder);
  selected = fillUnusedCapacityWithDueCards(selected, candidates, totalLimit, categoryOrder, limits);
  let fresh = false;
  const dueCount = categoryOrder.reduce((sum, category) => sum + selected[category].length, 0);
  // Once the due queue is complete, Start Review begins another deliberate
  // practice session instead of creating an empty session. Relearning recovery
  // intervals remain authoritative, while future Learning, Weak, and Memorized
  // ayat may be practiced early.
  if (!dueCount) {
    const freshOrder = ['learning', 'weak', 'memorized'];
    const futureCandidates = { relearning: [] };
    for (const category of freshOrder) {
      futureCandidates[category] = await reviewCategoryCandidates(q, userUid, category, limits[category], order, true, refsValue);
    }
    selected = allocateReviewCandidates(futureCandidates, limits, totalLimit, freshOrder);
    fresh = freshOrder.some(category => selected[category].length > 0);
  }
  return Object.assign(selected, {
    scheduled: selected.weak.concat(selected.memorized),
    fresh
  });
}

async function surahReviewScope(surahNumber) {
  const definitions = await progressGroupDefinitions();
  const groups = definitions.groups
    .filter(group => Number(group.surah_number) === Number(surahNumber))
    .sort((left, right) => Number(left.page_number) - Number(right.page_number));
  const totalPages = new Set(groups.map(group => Number(group.page_number))).size;
  if (!groups.length || !totalPages) {
    const err = new Error('The Mushaf pages for this surah could not be found.');
    err.status = 404;
    throw err;
  }
  return {
    refs: groups.flatMap(group => group.member_refs || []),
    selectedPages: totalPages,
    totalPages
  };
}

async function selectSurahReviewSessionItems(q, userUid, surahNumber, refsValue) {
  const refs = normalizeRefs(refsValue);
  const surahCondition = Number.isInteger(Number(surahNumber)) && Number(surahNumber) > 0
    ? `AND surah_number=${Number(surahNumber)}`
    : '';
  const scopeCondition = refs.length
    ? `AND (surah_number,ayah_number) IN (${refs.map(ref => `(${ref.surah},${ref.ayah})`).join(',')})`
    : '';
  const rows = await q(`
    SELECT surah_number, ayah_number, lifecycle_state, fsrs_state
    FROM ${TABLE} FORCE INDEX (uq_quran_ayah_memorization)
    WHERE user_uid=${sql(userUid)} ${surahCondition}
      AND lifecycle_state IN ('learning','relearning','weak','review','core','suspended')
      ${scopeCondition}
    ORDER BY surah_number, ayah_number
    FOR UPDATE
  `) || [];
  const selected = { learning: [], relearning: [], weak: [], memorized: [], core: [], suspended: [], items: rows, fresh: false };
  rows.forEach(row => {
    const category = row.lifecycle_state === 'review' ? 'memorized' : row.lifecycle_state;
    selected[category].push(row);
  });
  selected.scheduled = selected.weak.concat(selected.memorized);
  return selected;
}

async function enrollReviewScope(q, userUid, refsValue) {
  const refs = normalizeRefs(refsValue);
  if (!refs.length) return 0;
  const refTuples = refs.map(ref => `(${ref.surah},${ref.ayah})`).join(',');
  const existing = await q(`
    SELECT surah_number, ayah_number, lifecycle_state
    FROM ${TABLE}
    WHERE user_uid=${sql(userUid)} AND (surah_number,ayah_number) IN (${refTuples})
    FOR UPDATE
  `) || [];
  const alreadyEnrolled = new Set(existing
    .filter(row => row.lifecycle_state !== 'later')
    .map(row => `${Number(row.surah_number)}:${Number(row.ayah_number)}`));
  const refsToEnroll = refs.filter(ref => !alreadyEnrolled.has(`${ref.surah}:${ref.ayah}`));
  if (!refsToEnroll.length) return 0;
  const values = refsToEnroll.map(ref => `(${sql(userUid)},${ref.surah},${ref.ayah},'learning','started',NOW(),NOW(),${QuranFsrs.FSRS_VERSION})`);
  await q(`
    INSERT INTO ${TABLE}
      (user_uid,surah_number,ayah_number,lifecycle_state,learning_progress,
       learning_started_at,learning_last_worked_at,fsrs_version)
    VALUES ${values.join(',')}
    ON DUPLICATE KEY UPDATE
      learning_progress=IF(lifecycle_state='later',COALESCE(learning_progress,'started'),learning_progress),
      learning_started_at=IF(lifecycle_state='later',COALESCE(learning_started_at,NOW()),learning_started_at),
      learning_last_worked_at=IF(lifecycle_state='later',NOW(),learning_last_worked_at),
      fsrs_version=IF(lifecycle_state='later',${QuranFsrs.FSRS_VERSION},fsrs_version),
      row_version=row_version+IF(lifecycle_state='later',1,0),
      lifecycle_state=IF(lifecycle_state='later','learning',lifecycle_state)
  `);
  return refsToEnroll.length;
}

async function enrollLearningAyahs(userUid, surahValue, ayahCountValue) {
  await ensureTables();
  const ref = parseRef(surahValue, 1);
  const ayahCount = strictInteger(ayahCountValue);
  if (!ref || !ayahCount || ayahCount > CANONICAL_AYAH_COUNTS[ref.surah - 1]) {
    const err = new Error('Choose a valid surah and number of ayat to learn.');
    err.status = 400;
    throw err;
  }
  const refs = Array.from({ length: ayahCount }, (_, index) => `${ref.surah}:${index + 1}`);
  const enrolledCount = await transaction(q => enrollReviewScope(q, userUid, refs));
  return { surah_number: ref.surah, ayah_count: ayahCount, enrolled_count: enrolledCount };
}

const reviewSessionRequest = QuranReviewCore.reviewSessionRequest;

function nextCanonicalRef(refValue) {
  const ref = parseRefString(refValue);
  if (!ref) return null;
  if (ref.ayah < CANONICAL_AYAH_COUNTS[ref.surah - 1]) return `${ref.surah}:${ref.ayah + 1}`;
  return ref.surah < CANONICAL_AYAH_COUNTS.length ? `${ref.surah + 1}:1` : null;
}

async function passageReviewScope(refValue) {
  const ref = parseRefString(refValue);
  if (!ref) {
    const err = new Error('A valid Quran ayah is required for a Passage Review.');
    err.status = 400;
    throw err;
  }
  const [sectionsBySurah, subsectionsBySurah] = await Promise.all([
    QuranTocSubdivisions.quranSectionRangesBySurah(),
    QuranTocSubdivisions.quranSubsectionRangesBySurah()
  ]);
  const ranges = subsectionsBySurah[ref.surah] || [];
  const range = ranges.find(item => ref.ayah >= item.start && ref.ayah <= item.end)
    || (sectionsBySurah[ref.surah] || []).find(item => ref.ayah >= item.start && ref.ayah <= item.end)
    || { start: ref.ayah, end: ref.ayah };
  const start = Math.max(ref.ayah, Number(range.start));
  const end = Math.min(CANONICAL_AYAH_COUNTS[ref.surah - 1], Number(range.end));
  return {
    refs: Array.from({ length: end - start + 1 }, (_, index) => `${ref.surah}:${start + index}`),
    start_ref: `${ref.surah}:${start}`,
    end_ref: `${ref.surah}:${end}`
  };
}

function passageKeysForItems(items, sectionsBySurah, subsectionsBySurah) {
  return items.map(function (item) {
    const surahNumber = Number(item.surah_number);
    const sections = sectionsBySurah[surahNumber] || [];
    const subsections = subsectionsBySurah[surahNumber] || [];
    const ayah = Number(item.ayah_number);
    const subsection = subsections.find(range => ayah >= range.start && ayah <= range.end);
    if (subsection) return `h3:${surahNumber}:${subsection.section}:${subsection.subsection}:${subsection.start}-${subsection.end}`;
    const section = sections.find(range => ayah >= range.start && ayah <= range.end);
    if (section) return `h2:${surahNumber}:${section.section}:${section.start}-${section.end}`;
    return `ayah:${surahNumber}:${ayah}`;
  });
}

async function includeEnrolledAyatForSelectedPassages(q, userUid, items, sectionsBySurah, subsectionsBySurah) {
  if (!items.length) return items;
  const selectedKeys = new Set(passageKeysForItems(items, sectionsBySurah, subsectionsBySurah));
  const surahs = Array.from(new Set(items.map(item => Number(item.surah_number))));
  const enrolled = await q(`
    SELECT surah_number, ayah_number, lifecycle_state, fsrs_state
    FROM ${TABLE} FORCE INDEX (uq_quran_ayah_memorization)
    WHERE user_uid=${sql(userUid)} AND surah_number IN (${surahs.join(',')})
      AND lifecycle_state IN ('learning','relearning','weak','review','core','suspended')
    ORDER BY surah_number, ayah_number
    FOR UPDATE
  `) || [];
  return enrolled.filter(item => selectedKeys.has(
    passageKeysForItems([item], sectionsBySurah, subsectionsBySurah)[0]
  ));
}

function limitRegularSessionPassageCompanions(selectedItems, expandedItems, limitsValue, totalLimitValue) {
  const selected = orderReviewItemsBySurah(selectedItems);
  const expanded = orderReviewItemsBySurah(expandedItems);
  const selectedRefs = new Set(selected.map(item => `${Number(item.surah_number)}:${Number(item.ayah_number)}`));
  const keptRefs = new Set(selectedRefs);
  const limits = normalizeSelectionLimits(limitsValue, totalLimitValue);
  const totalLimit = boundedSessionLimit(totalLimitValue, REVIEW_SESSION_DEFAULTS.total, 200);
  let learningCount = selected.filter(item => item.lifecycle_state === 'learning').length;
  let weakCount = selected.filter(item => ['relearning', 'weak'].includes(item.lifecycle_state)).length;
  let memorizedCount = selected.filter(item => item.lifecycle_state === 'review').length;
  let total = selected.length;
  const companions = [];
  expanded.forEach(item => {
    const ref = `${Number(item.surah_number)}:${Number(item.ayah_number)}`;
    if (keptRefs.has(ref) || total >= totalLimit) return;
    // Passage context may broaden a regular ayah-by-ayah review, but it must
    // never override the learner's regular-session category caps.
    if (item.lifecycle_state === 'learning' && learningCount >= limits.learning) return;
    if (['relearning', 'weak'].includes(item.lifecycle_state) && weakCount >= limits.weak) return;
    if (item.lifecycle_state === 'review' && memorizedCount >= limits.memorized) return;
    keptRefs.add(ref);
    companions.push(item);
    total += 1;
    if (item.lifecycle_state === 'learning') learningCount += 1;
    if (['relearning', 'weak'].includes(item.lifecycle_state)) weakCount += 1;
    if (item.lifecycle_state === 'review') memorizedCount += 1;
  });
  return orderReviewItemsBySurah(selected.concat(companions));
}

async function startReviewSession(userUid, settings, options) {
  await ensureTables();
  await initializeNewUserLearning(userUid);
  const request = reviewSessionRequest(options);
  const memorization = settings && settings.memorization || {};
  const limits = reviewSessionLimits(settings);
  let scheduledLimit = limits.total;
  const timeBudget = request.mode !== 'regular'
    ? 0
    : Math.max(0, Math.min(240, parseInt(memorization.reviewTimeBudgetMinutes, 10) || 0));
  const sessionId = crypto.randomUUID();
  const order = sessionOrderSql(settings);
  const surahScope = request.mode === 'surah'
    ? await surahReviewScope(request.surahNumber)
    : null;
  const pageScope = request.mode === 'page'
    ? await mushafPageRefs(request.pageNumber)
    : null;
  const passageScope = request.mode === 'passage'
    ? await passageReviewScope(request.startRef)
    : null;
  const passageCatalog = await Promise.all([
    QuranTocSubdivisions.quranSectionRangesBySurah(),
    QuranTocSubdivisions.quranSubsectionRangesBySurah()
  ]);
  let passageKeys = null;
  const snapshot = await transaction(async function (q) {
    // Serialize session switching per user. Starting another review pauses the
    // current session so the user can return to its immutable queue later.
    const active = await q(`
      SELECT session_id FROM ${SESSION_TABLE}
      WHERE user_uid=${sql(userUid)} AND completed_at IS NULL AND paused_at IS NULL
      ORDER BY started_at DESC FOR UPDATE
    `) || [];
    if (active.length) {
      await q(`
        UPDATE ${SESSION_TABLE} SET paused_at=NOW()
        WHERE user_uid=${sql(userUid)} AND completed_at IS NULL AND paused_at IS NULL
      `);
    }
    const enrolledCount = ['page', 'passage'].includes(request.mode) || (request.mode === 'surah' && request.reviewType === 'all')
      ? await enrollReviewScope(q, userUid, request.mode === 'surah' ? surahScope.refs : request.mode === 'passage' ? passageScope.refs : pageScope.refs)
      : 0;
    const selected = request.mode === 'surah'
      ? request.reviewType === 'all'
        ? await selectSurahReviewSessionItems(q, userUid, request.surahNumber, surahScope.refs)
        : await selectReviewSessionItems(q, userUid, scheduledLimit, limits, order, surahScope.refs)
      : ['page', 'passage'].includes(request.mode)
        ? await selectSurahReviewSessionItems(q, userUid, request.mode === 'passage' ? request.surahNumber : null, request.mode === 'passage' ? passageScope.refs : pageScope.refs)
        : await selectReviewSessionItems(q, userUid, scheduledLimit, limits, order);
    let items = orderReviewItemsBySurah(
      selected.items || selected.learning.concat(selected.relearning, selected.weak, selected.memorized)
    );
    // In ayah-by-ayah review, strengthen passage recall by completing every
    // selected ayah's Study passage with its other enrolled ayat. They remain
    // separate queue items with independent presentation, grading, and FSRS
    // schedules. Passage-by-passage review retains its existing exact scope.
    if (request.reviewUnit === 'ayah') {
      const expandedItems = await includeEnrolledAyatForSelectedPassages(
        q, userUid, items, passageCatalog[0], passageCatalog[1]
      );
      items = request.mode === 'regular'
        ? limitRegularSessionPassageCompanions(items, expandedItems, limits, scheduledLimit)
        : orderReviewItemsBySurah(expandedItems);
    }
    const queuedByStage = { learning: [], relearning: [], weak: [], memorized: [], core: [], suspended: [] };
    items.forEach(item => {
      const stage = item.lifecycle_state === 'review' ? 'memorized' : item.lifecycle_state;
      if (queuedByStage[stage]) queuedByStage[stage].push(item);
    });
    Object.assign(selected, queuedByStage, {
      items,
      scheduled: queuedByStage.weak.concat(queuedByStage.memorized)
    });
    if (request.mode !== 'regular' && !items.length) {
      const err = new Error(request.mode === 'page'
        ? 'This Mushaf page has no āyāt to review.'
        : 'This surah has no āyāt to review.');
      err.status = 409;
      throw err;
    }
    scheduledLimit = items.length;
    if (request.reviewUnit === 'passage') passageKeys = passageKeysForItems(items, passageCatalog[0], passageCatalog[1]);
    await q(`
      INSERT INTO ${SESSION_TABLE}
        (session_id,user_uid,scheduled_limit,learning_limit,relearning_limit,weak_limit,memorized_limit,time_budget_minutes,
         session_mode,review_unit,review_surah_number,review_page_limit,review_page_number,continue_forward,review_cursor_page,review_cursor_ref)
      VALUES (${sql(sessionId)},${sql(userUid)},${scheduledLimit},${limits.learning},${limits.relearning},${limits.weak},${limits.memorized},${timeBudget},
        ${sql(request.mode)},${sql(request.reviewUnit)},${request.surahNumber === null ? 'NULL' : request.surahNumber},${request.pageLimit === null ? 'NULL' : request.pageLimit},
        ${request.pageNumber === null ? 'NULL' : request.pageNumber},${request.continueForward ? 1 : 0},${request.pageNumber === null ? 'NULL' : request.pageNumber},${sql(passageScope && passageScope.end_ref || surahScope && surahScope.refs[surahScope.refs.length - 1])})
    `);
    if (items.length) {
      const values = items.map((row, index) => `(${sql(sessionId)},${sql(userUid)},${Number(row.surah_number)},${Number(row.ayah_number)},${sql(row.lifecycle_state)},${index + 1},${sql(passageKeys && passageKeys[index])})`);
      await q(`INSERT INTO ${SESSION_ITEM_TABLE} (session_id,user_uid,surah_number,ayah_number,source_state,queue_position,unit_key) VALUES ${values.join(',')}`);
    }
    return Object.assign({}, selected, { enrolledCount, fresh: selected.fresh, superseded: active.length });
  });
  const queued = snapshot.items
    ? snapshot.items.length
    : snapshot.learning.length + snapshot.relearning.length + snapshot.weak.length + snapshot.memorized.length;
  return {
    session_id: sessionId,
    session_mode: request.mode,
    review_unit: request.reviewUnit,
    review_surah_number: request.surahNumber,
    review_page_limit: request.pageLimit,
    review_page_number: request.pageNumber,
    continue_forward: request.continueForward,
    review_start_ref: request.startRef,
    surah_review_type: request.mode === 'surah' ? request.reviewType : null,
    review_page_count: pageScope ? 1 : surahScope && surahScope.selectedPages,
    review_total_pages: pageScope ? 1 : surahScope && surahScope.totalPages,
    scheduled_limit: scheduledLimit,
    learning_limit: limits.learning,
    relearning_limit: limits.relearning,
    weak_limit: limits.weak,
    memorized_limit: limits.memorized,
    time_budget_minutes: timeBudget,
    queued,
    enrolled_count: snapshot.enrolledCount || 0,
    scheduled_queued: snapshot.scheduled.length,
    learning_queued: snapshot.learning.length,
    relearning_queued: snapshot.relearning.length,
    weak_queued: snapshot.weak.length,
    memorized_queued: snapshot.memorized.length,
    core_queued: snapshot.core ? snapshot.core.length : 0,
    paused_queued: snapshot.suspended ? snapshot.suspended.length : 0,
    fresh_session: snapshot.fresh,
    superseded_sessions: snapshot.superseded
  };
}

async function activeReviewSession(userUid) {
  await ensureTables();
  const sessions = await global.query(`
    SELECT session_id, scheduled_limit, learning_limit, relearning_limit, weak_limit, memorized_limit,
      time_budget_minutes, scheduled_reviewed, learning_reviewed, relearning_reviewed,
      weak_reviewed, memorized_reviewed, session_mode, review_unit, review_surah_number, review_page_limit, review_page_number,
      ${utcDateColumnSql('started_at', 'started_at')}
    FROM ${SESSION_TABLE}
    WHERE user_uid=${sql(userUid)} AND completed_at IS NULL AND paused_at IS NULL
    ORDER BY started_at DESC
    LIMIT 1
  `) || [];
  if (!sessions.length) return null;
  const session = sessions[0];
  const rows = await global.query(`
    SELECT source_state, COUNT(*) AS queued,
      SUM(CASE WHEN item_state IN ('reviewed','skipped') THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN item_state='retry_pending' THEN 1 ELSE 0 END) AS again_queued
    FROM ${SESSION_ITEM_TABLE}
    WHERE session_id=${sql(session.session_id)} AND user_uid=${sql(userUid)}
    GROUP BY source_state
  `) || [];
  const counts = new Map(rows.map(row => [row.source_state, {
    total: Math.max(0, Number(row.queued) || 0),
    completed: Math.max(0, Number(row.completed) || 0),
    again: Math.max(0, Number(row.again_queued) || 0)
  }]));
  const category = state => counts.get(state) || { total: 0, completed: 0 };
  session.learning_queued = category('learning').total;
  session.learning_completed = category('learning').completed;
  session.relearning_queued = category('relearning').total;
  session.relearning_completed = category('relearning').completed;
  session.weak_queued = category('weak').total;
  session.weak_completed = category('weak').completed;
  session.memorized_queued = category('review').total;
  session.memorized_completed = category('review').completed;
  session.core_queued = category('core').total;
  session.core_completed = category('core').completed;
  session.paused_queued = category('suspended').total;
  session.paused_completed = category('suspended').completed;
  session.again_queued = Array.from(counts.values()).reduce((total, count) => total + count.again, 0);
  session.scheduled_queued = session.weak_queued + session.memorized_queued;
  session.queued = session.learning_queued + session.relearning_queued + session.scheduled_queued
    + session.core_queued + session.paused_queued;
  session.completed = session.learning_completed + session.relearning_completed + session.weak_completed
    + session.memorized_completed + session.core_completed + session.paused_completed;
  return session;
}

async function pausedReviewSessions(userUid) {
  await ensureTables();
  const rows = await global.query(`
    SELECT session.session_id, session.session_mode, session.review_surah_number,
      session.review_page_limit, session.review_page_number,
      ${utcDateColumnSql('session.started_at', 'started_at')},
      ${utcDateColumnSql('session.paused_at', 'paused_at')},
      SUM(CASE WHEN item.item_state IN ('queued','retry_pending') THEN 1 ELSE 0 END) AS remaining_count,
      SUM(CASE WHEN item.item_state IN ('reviewed','skipped') THEN 1 ELSE 0 END) AS completed_count
    FROM ${SESSION_TABLE} session
    LEFT JOIN ${SESSION_ITEM_TABLE} item
      ON item.session_id=session.session_id AND item.user_uid=session.user_uid
    WHERE session.user_uid=${sql(userUid)} AND session.completed_at IS NULL AND session.paused_at IS NOT NULL
    GROUP BY session.session_id, session.session_mode, session.review_surah_number,
      session.review_page_limit, session.review_page_number, session.started_at, session.paused_at
    ORDER BY session.paused_at DESC
    LIMIT 20
  `) || [];
  return rows.map(row => Object.assign(row, {
    remaining_count: Math.max(0, Number(row.remaining_count) || 0),
    completed_count: Math.max(0, Number(row.completed_count) || 0),
    surah_name: row.review_surah_number ? surahMetadata(row.review_surah_number).name : null
  }));
}

async function openReviewSessions(userUid) {
  await ensureTables();
  const rows = await global.query(`
    SELECT session.session_id, session.session_mode, session.review_surah_number,
      session.review_page_limit, session.review_page_number,
      ${utcDateColumnSql('session.started_at', 'started_at')},
      ${utcDateColumnSql('session.paused_at', 'paused_at')},
      CASE WHEN session.paused_at IS NULL THEN 1 ELSE 0 END AS is_active,
      SUM(CASE WHEN item.item_state IN ('queued','retry_pending') THEN 1 ELSE 0 END) AS remaining_count,
      SUM(CASE WHEN item.item_state IN ('reviewed','skipped') THEN 1 ELSE 0 END) AS completed_count
    FROM ${SESSION_TABLE} session
    LEFT JOIN ${SESSION_ITEM_TABLE} item
      ON item.session_id=session.session_id AND item.user_uid=session.user_uid
    WHERE session.user_uid=${sql(userUid)} AND session.completed_at IS NULL
    GROUP BY session.session_id, session.session_mode, session.review_surah_number,
      session.review_page_limit, session.review_page_number, session.started_at, session.paused_at
    ORDER BY is_active DESC, COALESCE(session.paused_at,session.started_at) DESC
    LIMIT 20
  `) || [];
  return rows.map(row => Object.assign(row, {
    is_active: Number(row.is_active) === 1,
    remaining_count: Math.max(0, Number(row.remaining_count) || 0),
    completed_count: Math.max(0, Number(row.completed_count) || 0),
    surah_name: row.review_surah_number ? surahMetadata(row.review_surah_number).name : null
  }));
}

async function pauseReviewSession(userUid, sessionId) {
  await ensureTables();
  const normalizedId = (sessionId || '').toString().trim();
  return transaction(async function (q) {
    const rows = await q(`SELECT * FROM ${SESSION_TABLE} WHERE session_id=${sql(normalizedId)} AND user_uid=${sql(userUid)} LIMIT 1 FOR UPDATE`);
    const session = rows[0];
    if (!session) {
      const err = new Error('Review session not found.');
      err.status = 404;
      throw err;
    }
    if (session.completed_at) {
      const err = new Error('This review session has already ended.');
      err.status = 409;
      throw err;
    }
    if (!session.paused_at)
      await q(`UPDATE ${SESSION_TABLE} SET paused_at=NOW() WHERE session_id=${sql(normalizedId)}`);
    return { session_id: normalizedId, paused: true };
  });
}

async function switchReviewSession(q, userUid, normalizedId) {
  const openSessions = await q(`
      SELECT * FROM ${SESSION_TABLE}
      WHERE user_uid=${sql(userUid)} AND completed_at IS NULL
      ORDER BY session_id
      FOR UPDATE
    `) || [];
  const session = openSessions.find(row => row.session_id === normalizedId);
  if (!session) {
    const err = new Error('Review session not found.');
    err.status = 404;
    throw err;
  }
  if (!session.paused_at) return { session_id: normalizedId, resumed: true, switched_from_session_ids: [] };
  const active = openSessions.filter(row => row.session_id !== normalizedId && !row.paused_at);
  if (active.length)
    await q(`
        UPDATE ${SESSION_TABLE} SET paused_at=NOW()
        WHERE user_uid=${sql(userUid)} AND completed_at IS NULL AND paused_at IS NULL
          AND session_id<>${sql(normalizedId)}
      `);
  await q(`
      UPDATE ${SESSION_TABLE}
      SET started_at=DATE_ADD(started_at, INTERVAL TIMESTAMPDIFF(SECOND,paused_at,NOW()) SECOND), paused_at=NULL
      WHERE session_id=${sql(normalizedId)}
    `);
  return { session_id: normalizedId, resumed: true, switched_from_session_ids: active.map(row => row.session_id) };
}

async function resumeReviewSession(userUid, sessionId) {
  await ensureTables();
  const normalizedId = (sessionId || '').toString().trim();
  return transaction(q => switchReviewSession(q, userUid, normalizedId));
}

async function endReviewSession(userUid, sessionId) {
  await ensureTables();
  const normalizedId = (sessionId || '').toString().trim();
  return transaction(async function (q) {
    const rows = await q(`SELECT * FROM ${SESSION_TABLE} WHERE session_id=${sql(normalizedId)} AND user_uid=${sql(userUid)} LIMIT 1 FOR UPDATE`);
    const session = rows[0];
    if (!session) {
      const err = new Error('Review session not found.');
      err.status = 404;
      throw err;
    }
    if (!session.completed_at)
      await q(`UPDATE ${SESSION_TABLE} SET completed_at=NOW(), ended_at=NOW(), paused_at=NULL WHERE session_id=${sql(normalizedId)}`);
    return { session_id: normalizedId, ended: true };
  });
}

async function extendForwardReviewSession(q, userUid, session) {
  if (Number(session.continue_forward) !== 1 || !['page', 'passage', 'surah'].includes(session.session_mode)) return false;
  let scope;
  let nextPage = null;
  if (session.session_mode === 'page') {
    nextPage = Number(session.review_cursor_page || session.review_page_number) + 1;
    if (nextPage > 604) return false;
    scope = await mushafPageRefs(nextPage);
  } else if (session.session_mode === 'passage') {
    const nextRef = nextCanonicalRef(session.review_cursor_ref);
    if (!nextRef) return false;
    scope = await passageReviewScope(nextRef);
  } else {
    const cursor = parseRefString(session.review_cursor_ref) || { surah: Number(session.review_surah_number) };
    const nextSurah = Number(cursor.surah) + 1;
    if (nextSurah > CANONICAL_AYAH_COUNTS.length) return false;
    scope = await surahReviewScope(nextSurah);
    scope.end_ref = scope.refs[scope.refs.length - 1];
  }
  await enrollReviewScope(q, userUid, scope.refs);
  const selected = await selectSurahReviewSessionItems(q, userUid, null, scope.refs);
  const items = selected.items || [];
  if (!items.length) return false;
  const positions = await q(`SELECT COALESCE(MAX(queue_position),0) AS max_position FROM ${SESSION_ITEM_TABLE} WHERE session_id=${sql(session.session_id)} FOR UPDATE`);
  const firstPosition = Math.max(0, Number(positions[0] && positions[0].max_position) || 0) + 1;
  let unitKeys = null;
  if (session.review_unit === 'passage') {
    const catalogs = await Promise.all([QuranTocSubdivisions.quranSectionRangesBySurah(), QuranTocSubdivisions.quranSubsectionRangesBySurah()]);
    unitKeys = passageKeysForItems(items, catalogs[0], catalogs[1]);
  }
  const values = items.map((row, index) => `(${sql(session.session_id)},${sql(userUid)},${Number(row.surah_number)},${Number(row.ayah_number)},${sql(row.lifecycle_state)},${firstPosition + index},${sql(unitKeys && unitKeys[index])})`);
  await q(`INSERT INTO ${SESSION_ITEM_TABLE} (session_id,user_uid,surah_number,ayah_number,source_state,queue_position,unit_key) VALUES ${values.join(',')}`);
  const cursorUpdate = session.session_mode === 'page'
    ? `review_cursor_page=${nextPage}`
    : `review_cursor_ref=${sql(scope.end_ref)}`;
  await q(`UPDATE ${SESSION_TABLE} SET scheduled_limit=scheduled_limit+${items.length}, ${cursorUpdate} WHERE session_id=${sql(session.session_id)}`);
  session.scheduled_limit = Number(session.scheduled_limit) + items.length;
  if (nextPage) session.review_cursor_page = nextPage;
  else session.review_cursor_ref = scope.end_ref;
  return true;
}

async function nextSessionItem(userUid, sessionId, dayStartValue) {
  await ensureTables();
  const result = await transaction(async function (q) {
    const sessions = await q(`
      SELECT *, TIMESTAMPDIFF(SECOND,started_at,NOW()) AS active_elapsed_seconds
      FROM ${SESSION_TABLE}
      WHERE session_id=${sql(sessionId)} AND user_uid=${sql(userUid)}
      LIMIT 1 FOR UPDATE
    `);
    const session = sessions[0];
    if (!session) {
      const err = new Error('Review session not found.');
      err.status = 404;
      throw err;
    }
    if (session.completed_at) return { session, item: null, complete: true };
    if (session.paused_at) {
      const err = new Error('This review session is paused. Resume it from Memorization Progress.');
      err.status = 409;
      throw err;
    }
    const timedOut = Number(session.time_budget_minutes) > 0
      && Number(session.active_elapsed_seconds) >= Number(session.time_budget_minutes) * 60;
    if (timedOut) {
      await q(`UPDATE ${SESSION_TABLE} SET completed_at=NOW() WHERE session_id=${sql(sessionId)}`);
      return { session, item: null, complete: true, time_limit_reached: true };
    }
    // A session is a persisted ordering snapshot, but lifecycle changes remain
    // authoritative. Retire stale items before choosing the next ayah so moving
    // an ayah to an ineligible state in another view cannot strand the
    // session. Custom Surah Review deliberately includes every state except
    // Later, while regular FSRS sessions retain their narrower due queues.
    const eligibleStates = session.session_mode === 'regular'
      ? Array.from(REVIEWABLE_LIFECYCLE_STATES)
      : Array.from(SURAH_REVIEW_LIFECYCLE_STATES);
    await q(`
      UPDATE ${SESSION_ITEM_TABLE} item
      LEFT JOIN ${TABLE} memory
        ON memory.user_uid=item.user_uid
        AND memory.surah_number=item.surah_number
        AND memory.ayah_number=item.ayah_number
      SET item.item_state='skipped', item.current_token=NULL, item.presented_at=NULL
      WHERE item.session_id=${sql(sessionId)} AND item.user_uid=${sql(userUid)}
        AND item.item_state IN ('queued','retry_pending')
        AND (memory.id IS NULL OR memory.lifecycle_state NOT IN (${eligibleStates.map(sql).join(',')}))
    `);
    let items = await q(`
      SELECT item.*
      FROM ${SESSION_ITEM_TABLE} item
      WHERE item.session_id=${sql(sessionId)} AND item.user_uid=${sql(userUid)} AND item.item_state='queued'
      ORDER BY item.surah_number, item.ayah_number, item.queue_position
      LIMIT 1 FOR UPDATE
    `);
    if (!items.length) {
      items = await q(`
        SELECT item.*
        FROM ${SESSION_ITEM_TABLE} item
        WHERE item.session_id=${sql(sessionId)} AND item.user_uid=${sql(userUid)} AND item.item_state='retry_pending'
        ORDER BY item.surah_number, item.ayah_number, item.queue_position
        LIMIT 1 FOR UPDATE
      `);
    }
    if (!items.length && await extendForwardReviewSession(q, userUid, session)) {
      items = await q(`
        SELECT item.*
        FROM ${SESSION_ITEM_TABLE} item
        WHERE item.session_id=${sql(sessionId)} AND item.user_uid=${sql(userUid)} AND item.item_state='queued'
        ORDER BY item.surah_number, item.ayah_number, item.queue_position
        LIMIT 1 FOR UPDATE
      `);
    }
    if (!items.length) {
      await q(`UPDATE ${SESSION_TABLE} SET completed_at=NOW() WHERE session_id=${sql(sessionId)}`);
      return { session, item: null, complete: true };
    }
    const item = items[0];
    let unitItems = [item];
    if (session.review_unit === 'passage' && item.unit_key) {
      unitItems = await q(`
        SELECT * FROM ${SESSION_ITEM_TABLE}
        WHERE session_id=${sql(sessionId)} AND user_uid=${sql(userUid)}
          AND unit_key=${sql(item.unit_key)} AND item_state=${sql(item.item_state)}
        ORDER BY surah_number, ayah_number, queue_position FOR UPDATE
      `);
    }
    let currentToken = unitItems.find(row => row.current_token) && unitItems.find(row => row.current_token).current_token;
    if (!currentToken) currentToken = crypto.randomUUID();
    if (unitItems.some(row => row.current_token !== currentToken)) {
      await q(`UPDATE ${SESSION_ITEM_TABLE} SET current_token=${sql(currentToken)}, presented_at=NOW() WHERE id IN (${unitItems.map(row => Number(row.id)).join(',')})`);
    }
    unitItems.forEach(row => { row.current_token = currentToken; });
    return { session, item: unitItems[0], unitItems, complete: false };
  });
  if (!result.item) return result;
  const unitRefs = result.unitItems.map(item => `${item.surah_number}:${item.ayah_number}`);
  const stateRows = await getMany(userUid, unitRefs);
  const unitAyahs = await metadataForRows(stateRows);
  const ayah = unitAyahs[0];
  Object.assign(ayah, {
    source_state: result.item.source_state,
    retry: result.item.item_state === 'retry_pending',
    attempt_token: result.item.current_token,
    session_id: sessionId
  });
  return {
    session: result.session,
    ayah,
    passage: result.session.review_unit === 'passage' ? {
      refs: unitRefs,
      ayahs: unitAyahs,
      start_ref: unitRefs[0],
      end_ref: unitRefs[unitRefs.length - 1]
    } : null,
    complete: false
  };
}

async function reviewedRefsForSession(userUid, sessionId, dayStartValue) {
  const localDayStart = reviewDayStart(dayStartValue);
  const recentReviewCondition = localDayStart
    ? `memory.last_reviewed_at>=${sql(localDayStart)}`
    : 'memory.last_reviewed_at>=DATE_SUB(NOW(),INTERVAL 24 HOUR)';
  const rows = await global.query(`
    SELECT DISTINCT memory.surah_number, memory.ayah_number
    FROM ${TABLE} memory
    WHERE memory.user_uid=${sql(userUid)} AND ${recentReviewCondition}
      AND NOT EXISTS (
        SELECT 1 FROM ${SESSION_ITEM_TABLE} pending
        WHERE pending.session_id=${sql(sessionId)} AND pending.user_uid=memory.user_uid
          AND pending.surah_number=memory.surah_number AND pending.ayah_number=memory.ayah_number
          AND pending.item_state IN ('queued','retry_pending')
      )
    UNION
    SELECT reviewed.surah_number, reviewed.ayah_number
    FROM ${SESSION_ITEM_TABLE} reviewed
    WHERE reviewed.session_id=${sql(sessionId)} AND reviewed.user_uid=${sql(userUid)}
      AND reviewed.item_state='reviewed' AND reviewed.last_attempt_grade IN ('again','hard','good','easy')
    ORDER BY surah_number, ayah_number
  `) || [];
  return rows
    .map(item => `${Number(item.surah_number)}:${Number(item.ayah_number)}`)
    .filter(value => /^\d+:\d+$/.test(value));
}

async function activeSessionReviewedRefs(userUid, surahValue, ayahValue, dayStartValue) {
  await ensureTables();
  const ref = await assertCanonicalRef(surahValue, ayahValue);
  const sessions = await global.query(`
    SELECT session.session_id
    FROM ${SESSION_TABLE} session
    JOIN ${SESSION_ITEM_TABLE} current_item ON current_item.session_id=session.session_id
      AND current_item.user_uid=session.user_uid
    WHERE session.user_uid=${sql(userUid)} AND session.completed_at IS NULL AND session.paused_at IS NULL
      AND current_item.surah_number=${ref.surah} AND current_item.ayah_number=${ref.ayah}
      AND current_item.item_state IN ('queued','retry_pending')
    ORDER BY session.started_at DESC
    LIMIT 1
  `) || [];
  if (!sessions.length) return [];
  return reviewedRefsForSession(userUid, sessions[0].session_id, dayStartValue);
}

async function undoableSessionReview(userUid, sessionId) {
  const rows = await global.query(`
    SELECT session.review_unit, history.attempt_token, history.surah_number, history.ayah_number, history.grade
    FROM ${SESSION_TABLE} session
    JOIN ${HISTORY_TABLE} history
      ON history.user_uid=session.user_uid AND history.session_id=session.session_id
      AND history.attempt_token=session.undo_attempt_token
    WHERE session.session_id=${sql(sessionId)} AND session.user_uid=${sql(userUid)}
      AND session.undo_attempt_token IS NOT NULL
    LIMIT 1
  `) || [];
  if (!rows.length || rows[0].review_unit === 'passage') return null;
  return {
    attempt_token: rows[0].attempt_token,
    reference: `${Number(rows[0].surah_number)}:${Number(rows[0].ayah_number)}`,
    grade: rows[0].grade
  };
}

async function activeSessionReviewState(userUid, surahValue, ayahValue, dayStartValue) {
  await ensureTables();
  const ref = await assertCanonicalRef(surahValue, ayahValue);
  const rows = await global.query(`
    SELECT session.session_id, session.review_unit, current_item.current_token AS attempt_token, current_item.unit_key
    FROM ${SESSION_TABLE} session
    JOIN ${SESSION_ITEM_TABLE} current_item ON current_item.session_id=session.session_id
      AND current_item.user_uid=session.user_uid
    WHERE session.user_uid=${sql(userUid)} AND session.completed_at IS NULL AND session.paused_at IS NULL
      AND current_item.surah_number=${ref.surah} AND current_item.ayah_number=${ref.ayah}
      AND current_item.item_state IN ('queued','retry_pending')
      AND current_item.current_token IS NOT NULL
    ORDER BY session.started_at DESC
    LIMIT 1
  `) || [];
  if (!rows.length) return null;
  const session = await activeReviewSession(userUid);
  let passage = null;
  if (rows[0].review_unit === 'passage' && rows[0].unit_key) {
    const passageRows = await global.query(`
      SELECT surah_number, ayah_number FROM ${SESSION_ITEM_TABLE}
      WHERE session_id=${sql(rows[0].session_id)} AND user_uid=${sql(userUid)}
        AND unit_key=${sql(rows[0].unit_key)} AND current_token=${sql(rows[0].attempt_token)}
      ORDER BY surah_number, ayah_number, queue_position
    `) || [];
    const refs = passageRows.map(item => `${Number(item.surah_number)}:${Number(item.ayah_number)}`);
    passage = { refs, start_ref: refs[0], end_ref: refs[refs.length - 1] };
  }
  return {
    session_id: rows[0].session_id,
    attempt_token: rows[0].attempt_token,
    passage,
    reviewed_refs: await reviewedRefsForSession(userUid, rows[0].session_id, dayStartValue),
    undoable_review: await undoableSessionReview(userUid, rows[0].session_id),
    session_progress: session && session.session_id === rows[0].session_id ? session : null
  };
}

async function recordSessionReview(userUid, sessionId, surahValue, ayahValue, gradeValue, options) {
  await ensureTables();
  const ref = await assertCanonicalRef(surahValue, ayahValue);
  const grade = (gradeValue || '').toString().trim().toLowerCase();
  if (!REVIEW_GRADES.has(grade)) {
    const err = new Error('Unsupported review result.');
    err.status = 400;
    throw err;
  }
  const attemptToken = (options && options.attemptToken || '').toString();
  return transaction(async function (q) {
    const sessions = await q(`SELECT * FROM ${SESSION_TABLE} WHERE session_id=${sql(sessionId)} AND user_uid=${sql(userUid)} LIMIT 1 FOR UPDATE`);
    if (!sessions.length) {
      const err = new Error('Review session not found.');
      err.status = 404;
      throw err;
    }
    const session = sessions[0];
    const items = await q(`
      SELECT *, ${utcDateColumnSql('presented_at', 'presented_at')}
      FROM ${SESSION_ITEM_TABLE}
      WHERE session_id=${sql(sessionId)} AND user_uid=${sql(userUid)}
        AND surah_number=${ref.surah} AND ayah_number=${ref.ayah}
      LIMIT 1 FOR UPDATE
    `);
    const item = items[0];
    let targetItems = item ? [item] : [];
    if (item && session.review_unit === 'passage' && item.unit_key) {
      targetItems = await q(`
        SELECT *, ${utcDateColumnSql('presented_at', 'presented_at')}
        FROM ${SESSION_ITEM_TABLE}
        WHERE session_id=${sql(sessionId)} AND user_uid=${sql(userUid)}
          AND unit_key=${sql(item.unit_key)} AND current_token=${sql(attemptToken)}
        ORDER BY surah_number, ayah_number, queue_position FOR UPDATE
      `);
    }
    if (item && attemptToken && item.last_attempt_token === attemptToken) {
      return {
        skipped: item.last_attempt_grade === 'skip',
        retry_queued: Boolean(Number(item.last_retry_queued)),
        already_recorded: true,
        recorded_grade: item.last_attempt_grade,
        undoable_review: session.undo_attempt_token === attemptToken && item.last_attempt_grade !== 'skip'
          ? { attempt_token: attemptToken, reference: `${ref.surah}:${ref.ayah}`, grade: item.last_attempt_grade }
          : null
      };
    }
    if (session.completed_at) {
      const err = new Error('This review session is no longer active.');
      err.status = 409;
      throw err;
    }
    if (session.paused_at) {
      const err = new Error('This review session is paused. Resume it before grading this ayah.');
      err.status = 409;
      throw err;
    }
    if (!item || !targetItems.length || targetItems.some(target => !['queued', 'retry_pending'].includes(target.item_state)
      || !attemptToken || target.current_token !== attemptToken)) {
      const err = new Error('This review attempt has already been recorded or is no longer current.');
      err.status = 409;
      throw err;
    }
    if (grade === 'skip') {
      await q(`
        UPDATE ${SESSION_ITEM_TABLE}
        SET item_state='skipped', attempts=attempts+1, current_token=NULL, presented_at=NULL,
          last_attempt_token=${sql(attemptToken)}, last_attempt_grade='skip', last_retry_queued=0
        WHERE id IN (${targetItems.map(target => Number(target.id)).join(',')})
      `);
      return { skipped: true, ayah: null, refs: targetItems.map(target => `${target.surah_number}:${target.ayah_number}`), already_recorded: false };
    }
    const targetRefs = targetItems.map(target => `${Number(target.surah_number)}:${Number(target.ayah_number)}`);
    const rows = await q(`
      SELECT *, ${memoryUtcDateColumns()}
      FROM ${TABLE}
      WHERE user_uid=${sql(userUid)} AND (${targetItems.map(target => `(surah_number=${Number(target.surah_number)} AND ayah_number=${Number(target.ayah_number)})`).join(' OR ')})
      ORDER BY surah_number, ayah_number FOR UPDATE
    `);
    const allowedStates = session.session_mode === 'regular'
      ? REVIEWABLE_LIFECYCLE_STATES
      : SURAH_REVIEW_LIFECYCLE_STATES;
    const memoryByRef = new Map(rows.map(row => [`${Number(row.surah_number)}:${Number(row.ayah_number)}`, row]));
    if (targetItems.some(target => {
      const memory = memoryByRef.get(`${Number(target.surah_number)}:${Number(target.ayah_number)}`);
      return !memory || !allowedStates.has(memory.lifecycle_state);
    })) {
      await q(`
        UPDATE ${SESSION_ITEM_TABLE}
        SET item_state='skipped', current_token=NULL, presented_at=NULL,
          last_attempt_token=${sql(attemptToken)}, last_attempt_grade='skip', last_retry_queued=0
        WHERE id IN (${targetItems.map(target => Number(target.id)).join(',')})
      `);
      return { skipped: true, stale: true, refs: targetRefs, ayah: null, already_recorded: false };
    }
    let retry = false;
    let representativeSchedule = null;
    const reviewResults = [];
    const sessionUpdates = [`undo_attempt_token=${sql(attemptToken)}`];
    const counterIncrements = {};
    for (const target of targetItems) {
      const targetRef = `${Number(target.surah_number)}:${Number(target.ayah_number)}`;
      const existing = memoryByRef.get(targetRef);
      const elapsedDays = elapsedDaysSince(existing.last_reviewed_at || existing.fully_memorized_at);
      const schedule = reviewSchedule(existing, grade, options && options.fsrs);
      representativeSchedule = representativeSchedule || schedule;
      reviewResults.push({
        reference: targetRef,
        interval_days: schedule.interval,
        lifecycle_state: schedule.lifecycle_state,
        next_review_at: schedule.due
      });
      const undoSnapshot = reviewUndoSnapshot(existing, target);
      const memoryResult = await q(`
      UPDATE ${TABLE}
      SET lifecycle_state=${sql(schedule.lifecycle_state)},
        learning_progress=${schedule.learning_progress === undefined ? 'learning_progress' : sql(schedule.learning_progress)},
        learning_last_worked_at=${existing.lifecycle_state === 'learning' ? 'NOW()' : 'learning_last_worked_at'},
        fully_memorized_at=${schedule.graduated ? 'COALESCE(fully_memorized_at,NOW())' : 'fully_memorized_at'},
        stability=${Number(schedule.stability).toFixed(6)},
        difficulty=${Number(schedule.difficulty).toFixed(6)}, last_reviewed_at=NOW(),
        next_review_at=${sql(schedule.due)}, review_count=review_count+1,
        lapse_count=${Number(schedule.lapse_count)}, consecutive_successes=${Number(schedule.consecutive_successes)},
        last_grade=${sql(grade)}, relearning_step=${Number(schedule.relearning_step)},
        fsrs_state=${Number(schedule.fsrs_state)}, fsrs_scheduled_days=${Number(schedule.scheduled_days)},
        fsrs_learning_steps=${Number(schedule.learning_steps)}, fsrs_version=${QuranFsrs.FSRS_VERSION},
        row_version=row_version+1
      WHERE id=${Number(existing.id)} AND row_version=${Number(existing.row_version)}
      `);
      if (!memoryResult.affectedRows) throw conflictError();
      await q(`
      INSERT INTO ${HISTORY_TABLE}
        (user_uid,surah_number,ayah_number,grade,lifecycle_state_before,lifecycle_state_after,scheduled_interval,
         actual_elapsed_time,duration_seconds,mistake_count,prompt_count,session_id,attempt_token,memory_before,session_item_before)
      VALUES (${sql(userUid)},${Number(target.surah_number)},${Number(target.ayah_number)},${sql(grade)},${sql(existing.lifecycle_state)},${sql(schedule.lifecycle_state)},
        ${Number(schedule.interval)},${elapsedDays === null ? 'NULL' : elapsedDays.toFixed(3)},
        ${reviewMetricSql(options && options.durationSeconds)},
        ${reviewMetricSql(options && options.mistakeCount)},
        ${reviewMetricSql(options && options.promptCount)},${sql(sessionId)},${sql(attemptToken)},
        ${sql(JSON.stringify(undoSnapshot.memory))},${sql(JSON.stringify(undoSnapshot.item))})
      `);
      const targetRetry = shouldQueueReviewRetry(grade, target.attempts);
      retry = retry || targetRetry;
      await q(`
      UPDATE ${SESSION_ITEM_TABLE}
      SET item_state=${sql(targetRetry ? 'retry_pending' : 'reviewed')}, attempts=attempts+1,
        current_token=NULL, presented_at=NULL, last_attempt_token=${sql(attemptToken)},
        last_attempt_grade=${sql(grade)}, last_retry_queued=${targetRetry ? 1 : 0}
      WHERE id=${Number(target.id)}
      `);
      if (Number(target.attempts) === 0) {
        const categoryCounter = {
          learning: 'learning_reviewed',
          relearning: 'relearning_reviewed',
          weak: 'weak_reviewed',
          review: 'memorized_reviewed'
        }[target.source_state];
        if (categoryCounter) counterIncrements[categoryCounter] = (counterIncrements[categoryCounter] || 0) + 1;
        if (['weak', 'review'].includes(target.source_state)) counterIncrements.scheduled_reviewed = (counterIncrements.scheduled_reviewed || 0) + 1;
      }
    }
    Object.keys(counterIncrements).forEach(counter => sessionUpdates.push(`${counter}=${counter}+${counterIncrements[counter]}`));
    await q(`UPDATE ${SESSION_TABLE} SET ${sessionUpdates.join(', ')} WHERE session_id=${sql(sessionId)}`);
    return {
      skipped: false,
      retry_queued: retry,
      refs: targetRefs,
      review_results: reviewResults,
      interval_days: representativeSchedule.interval,
      lifecycle_state: representativeSchedule.lifecycle_state,
      already_recorded: false,
      recorded_grade: grade,
      undoable_review: targetRefs.length === 1
        ? { attempt_token: attemptToken, reference: targetRefs[0], refs: targetRefs, grade }
        : null
    };
  }).then(async function (result) {
    if (!result.skipped && (!options || options.includeAyah !== false)) result.ayah = await get(userUid, ref.surah, ref.ayah);
    return result;
  });
}

async function undoSessionReview(userUid, sessionId, attemptTokenValue) {
  await ensureTables();
  const attemptToken = (attemptTokenValue || '').toString().trim();
  if (!/^[0-9a-f-]{36}$/i.test(attemptToken)) {
    const err = new Error('The review grade can no longer be undone.');
    err.status = 409;
    throw err;
  }
  const undone = await transaction(async function (q) {
    const sessions = await q(`
      SELECT * FROM ${SESSION_TABLE}
      WHERE session_id=${sql(sessionId)} AND user_uid=${sql(userUid)}
      LIMIT 1 FOR UPDATE
    `);
    const session = sessions[0];
    if (!session || session.undo_attempt_token !== attemptToken || session.ended_at) {
      const err = new Error('Only the most recent review grade can be undone.');
      err.status = 409;
      throw err;
    }
    const histories = await q(`
      SELECT * FROM ${HISTORY_TABLE}
      WHERE user_uid=${sql(userUid)} AND session_id=${sql(sessionId)} AND attempt_token=${sql(attemptToken)}
      LIMIT 1 FOR UPDATE
    `);
    const history = histories[0];
    const memoryBefore = parseUndoSnapshot(history && history.memory_before);
    const itemBefore = parseUndoSnapshot(history && history.session_item_before);
    if (!history || !memoryBefore || !itemBefore) {
      const err = new Error('This review grade does not have a restorable snapshot.');
      err.status = 409;
      throw err;
    }
    const items = await q(`
      SELECT *, ${utcDateColumnSql('presented_at', 'presented_at')}
      FROM ${SESSION_ITEM_TABLE}
      WHERE session_id=${sql(sessionId)} AND user_uid=${sql(userUid)}
        AND surah_number=${Number(history.surah_number)} AND ayah_number=${Number(history.ayah_number)}
      LIMIT 1 FOR UPDATE
    `);
    const item = items[0];
    if (!item || item.last_attempt_token !== attemptToken) {
      const err = new Error('This review item has changed and can no longer be undone.');
      err.status = 409;
      throw err;
    }
    const memories = await q(`
      SELECT *, ${memoryUtcDateColumns()}
      FROM ${TABLE}
      WHERE user_uid=${sql(userUid)} AND surah_number=${Number(history.surah_number)} AND ayah_number=${Number(history.ayah_number)}
      LIMIT 1 FOR UPDATE
    `);
    const memory = memories[0];
    if (!memory || Number(memory.row_version) !== Number(memoryBefore.row_version) + 1) {
      const err = new Error('This ayah changed after the review and can no longer be undone safely.');
      err.status = 409;
      throw err;
    }
    await q(`
      UPDATE ${TABLE}
      SET lifecycle_state=${sql(memoryBefore.lifecycle_state)}, learning_progress=${sql(memoryBefore.learning_progress)},
        learning_last_worked_at=${sql(undoDate(memoryBefore.learning_last_worked_at))},
        fully_memorized_at=${sql(undoDate(memoryBefore.fully_memorized_at))},
        stability=${Number(memoryBefore.stability) || 0}, difficulty=${Number(memoryBefore.difficulty) || 0},
        last_reviewed_at=${sql(undoDate(memoryBefore.last_reviewed_at))},
        next_review_at=${sql(undoDate(memoryBefore.next_review_at))},
        review_count=${Math.max(0, Number(memoryBefore.review_count) || 0)},
        lapse_count=${Math.max(0, Number(memoryBefore.lapse_count) || 0)},
        consecutive_successes=${Math.max(0, Number(memoryBefore.consecutive_successes) || 0)},
        last_grade=${sql(memoryBefore.last_grade)}, relearning_step=${Math.max(0, Number(memoryBefore.relearning_step) || 0)},
        fsrs_state=${memoryBefore.fsrs_state === null ? 'NULL' : Math.max(0, Number(memoryBefore.fsrs_state) || 0)},
        fsrs_scheduled_days=${Math.max(0, Number(memoryBefore.fsrs_scheduled_days) || 0)},
        fsrs_learning_steps=${Math.max(0, Number(memoryBefore.fsrs_learning_steps) || 0)},
        fsrs_version=${Math.max(1, Number(memoryBefore.fsrs_version) || QuranFsrs.FSRS_VERSION)},
        row_version=row_version+1
      WHERE id=${Number(memory.id)} AND row_version=${Number(memory.row_version)}
    `);
    await q(`
      UPDATE ${SESSION_ITEM_TABLE}
      SET item_state=${sql(itemBefore.item_state)}, attempts=${Math.max(0, Number(itemBefore.attempts) || 0)},
        current_token=${sql(itemBefore.current_token)}, presented_at=${sql(undoDate(itemBefore.presented_at))},
        last_attempt_token=${sql(itemBefore.last_attempt_token)}, last_attempt_grade=${sql(itemBefore.last_attempt_grade)},
        last_retry_queued=${Number(itemBefore.last_retry_queued) ? 1 : 0}
      WHERE id=${Number(item.id)}
    `);
    const sessionUpdates = ['undo_attempt_token=NULL', 'completed_at=NULL'];
    if (Number(itemBefore.attempts) === 0) {
      const categoryCounter = {
        learning: 'learning_reviewed',
        relearning: 'relearning_reviewed',
        weak: 'weak_reviewed',
        review: 'memorized_reviewed'
      }[item.source_state];
      const counters = categoryCounter ? [categoryCounter] : [];
      if (['weak', 'review'].includes(item.source_state)) counters.push('scheduled_reviewed');
      sessionUpdates.push(...counters.map(counter => `${counter}=GREATEST(${counter}-1,0)`));
    }
    await q(`UPDATE ${SESSION_TABLE} SET ${sessionUpdates.join(', ')} WHERE session_id=${sql(sessionId)}`);
    await q(`DELETE FROM ${HISTORY_TABLE} WHERE id=${Number(history.id)}`);
    return {
      surah_number: Number(history.surah_number),
      ayah_number: Number(history.ayah_number),
      attempt_token: itemBefore.current_token,
      undone_grade: history.grade
    };
  });
  const rows = await getMany(userUid, [`${undone.surah_number}:${undone.ayah_number}`]);
  const ayah = (await metadataForRows(rows))[0];
  return Object.assign(undone, { ayah });
}

function utcDayNumber(value) {
  const match = (value || '').toString().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? Math.floor(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86400000) : null;
}

function validatedReviewTimeZone(value) {
  const timezone = (value || '').toString().trim();
  if (!timezone || timezone.length > 64) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    return timezone;
  } catch (_err) {
    return 'UTC';
  }
}

function reviewDateInTimeZone(value, timezone) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date).reduce((result, part) => {
    if (part.type !== 'literal') result[part.type] = part.value;
    return result;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

async function reviewStats(userUid, daysValue, timezoneValue) {
  await ensureTables();
  const days = Math.max(28, Math.min(730, Number(daysValue) || 365));
  const timezone = validatedReviewTimeZone(timezoneValue);
  const today = reviewDateInTimeZone(new Date(), timezone);
  const firstIncludedDay = new Date((utcDayNumber(today) - days + 1) * 86400000).toISOString().slice(0, 10);
  const rows = await global.query(`
    SELECT DATE_FORMAT(CONVERT_TZ(reviewed_at,@@session.time_zone,'+00:00'),'%Y-%m-%dT%H:%i:%sZ') AS reviewed_at_utc,
      duration_seconds
    FROM ${HISTORY_TABLE} FORCE INDEX (history_stats_cover)
    WHERE user_uid=${sql(userUid)} AND reviewed_at>=DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${days + 1} DAY)
    ORDER BY reviewed_at
  `) || [];
  const firstRows = await global.query(`
    SELECT DATE_FORMAT(CONVERT_TZ(MIN(reviewed_at),@@session.time_zone,'+00:00'),'%Y-%m-%dT%H:%i:%sZ') AS first_review_at_utc
    FROM ${HISTORY_TABLE} FORCE INDEX (history_stats_cover)
    WHERE user_uid=${sql(userUid)}
  `) || [];
  const activityByDay = new Map();
  rows.forEach(row => {
    const day = reviewDateInTimeZone(row.reviewed_at_utc, timezone);
    if (!day || day < firstIncludedDay || day > today) return;
    const current = activityByDay.get(day) || { date: day, reviews: 0, seconds: 0 };
    current.reviews += 1;
    current.seconds += Math.max(0, Number(row.duration_seconds) || 0);
    activityByDay.set(day, current);
  });
  const activity = Array.from(activityByDay.values()).sort((left, right) => left.date.localeCompare(right.date));
  const activeDays = new Set(activity.map(day => day.date));
  const todayActivity = activity.find(day => day.date === today) || { reviews: 0, seconds: 0 };
  let longestStreak = 0;
  let runningStreak = 0;
  let previousDay = null;
  activity.forEach(day => {
    const currentDay = utcDayNumber(day.date);
    runningStreak = previousDay !== null && currentDay === previousDay + 1 ? runningStreak + 1 : 1;
    longestStreak = Math.max(longestStreak, runningStreak);
    previousDay = currentDay;
  });
  let currentStreak = 0;
  let cursor = utcDayNumber(today);
  if (!activeDays.has(today)) cursor -= 1;
  while (activeDays.has(new Date(cursor * 86400000).toISOString().slice(0, 10))) {
    currentStreak += 1;
    cursor -= 1;
  }
  const firstRaw = firstRows[0] && firstRows[0].first_review_at_utc;
  const firstDay = firstRaw ? reviewDateInTimeZone(firstRaw, timezone) : null;
  const spanDays = firstDay ? Math.max(1, Math.min(days, utcDayNumber(today) - utcDayNumber(firstDay) + 1)) : 0;
  const totalReviews = activity.reduce((total, day) => total + day.reviews, 0);
  return {
    today,
    timezone,
    days,
    activity,
    studied_today: todayActivity.reviews,
    seconds_today: todayActivity.seconds,
    seconds_per_card_today: todayActivity.reviews ? Math.round(todayActivity.seconds / todayActivity.reviews) : 0,
    daily_average: spanDays ? Math.round((totalReviews / spanDays) * 10) / 10 : 0,
    days_learned_percent: spanDays ? Math.round((activeDays.size / spanDays) * 100) : 0,
    longest_streak: longestStreak,
    current_streak: currentStreak
  };
}

async function optimizeFsrsParameters(userUid) {
  await ensureTables();
  const rows = await global.query(`
    SELECT surah_number, ayah_number,
      ${utcDateColumnSql('reviewed_at', 'reviewed_at')}, grade
    FROM ${HISTORY_TABLE}
    WHERE user_uid=${sql(userUid)}
    ORDER BY surah_number, ayah_number, reviewed_at
    LIMIT 50000
  `) || [];
  return QuranFsrs.optimize(rows);
}

async function nextReview(userUid, excludedRefs, settings, counters) {
  await ensureTables();
  const excluded = normalizeRefs(excludedRefs, 6236);
  const excludedSql = excluded.length
    ? `AND NOT (${excluded.map(ref => `(surah_number=${ref.surah} AND ayah_number=${ref.ayah})`).join(' OR ')})`
    : '';
  const limits = reviewSessionLimits(settings);
  const scheduledLimit = limits.total;
  const learningReviewed = Math.max(0, parseInt(counters && counters.learningReviewed, 10) || 0);
  const scheduledReviewed = Math.max(0, parseInt(counters && counters.scheduledReviewed, 10) || 0);
  const relearningReviewed = Math.max(0, parseInt(counters && counters.relearningReviewed, 10) || 0);
  const weakReviewed = Math.max(0, parseInt(counters && counters.weakReviewed, 10) || 0);
  const memorizedReviewed = Math.max(0, parseInt(counters && counters.memorizedReviewed, 10) || 0);
  const hasCategoryCounters = counters && ['learningReviewed', 'weakReviewed', 'memorizedReviewed']
    .some(key => Object.prototype.hasOwnProperty.call(counters, key));
  const totalReviewed = hasCategoryCounters
    ? learningReviewed + relearningReviewed + weakReviewed + memorizedReviewed
    : scheduledReviewed + relearningReviewed;
  const allowed = [];
  if (totalReviewed < scheduledLimit && learningReviewed < limits.learning) allowed.push("'learning'");
  const weakReviewedTotal = relearningReviewed + weakReviewed;
  if (totalReviewed < scheduledLimit && weakReviewedTotal < limits.weak) allowed.push("'relearning'", "'weak'");
  if (totalReviewed < scheduledLimit && memorizedReviewed < limits.memorized) allowed.push("'review'");
  if (!allowed.length)
    return {
      ayah: null,
      scheduledLimit,
      learningLimit: limits.learning,
      relearningLimit: limits.relearning,
      weakLimit: limits.weak,
      memorizedLimit: limits.memorized,
      limitReached: true
    };
  const rows = await global.query(`
    SELECT *, ${memoryUtcDateColumns()}, next_review_at<=NOW() AS is_due_now
    FROM ${TABLE}
    WHERE user_uid=${sql(userUid)}
      AND lifecycle_state IN (${allowed.join(',')})
      AND ((lifecycle_state='learning' AND (next_review_at IS NULL OR next_review_at<=NOW()))
        OR (lifecycle_state<>'learning' AND next_review_at IS NOT NULL AND next_review_at<=NOW()))
      ${excludedSql}
    ORDER BY
      CASE lifecycle_state WHEN 'learning' THEN 0 WHEN 'relearning' THEN 1 WHEN 'weak' THEN 2 ELSE 3 END,
      next_review_at, surah_number, ayah_number
    LIMIT 1
  `);
  const ayah = rows[0] ? (await metadataForRows([rows[0]]))[0] : null;
  return {
    ayah,
    scheduledLimit,
    learningLimit: limits.learning,
    relearningLimit: limits.relearning,
    weakLimit: limits.weak,
    memorizedLimit: limits.memorized,
    limitReached: !ayah && allowed.length === 0
  };
}

async function tableExists(table) {
  const rows = await global.query(`
    SELECT 1 FROM information_schema.tables
    WHERE table_schema=DATABASE() AND table_name=${sql(table)}
    LIMIT 1
  `) || [];
  return Boolean(rows.length);
}

async function optimizeSchema(options) {
  const apply = Boolean(options && options.apply);
  if (apply) await ensureTables();
  const tables = [TABLE, HISTORY_TABLE, SESSION_TABLE, SESSION_ITEM_TABLE];
  const report = { applied: apply, tables: [], indexes: [] };
  for (const table of tables) {
    if (!await tableExists(table)) {
      report.tables.push({ table, exists: false });
      continue;
    }
    const invalid = await global.query(`
      SELECT COALESCE(SUM(CHAR_LENGTH(user_uid)>128 OR user_uid REGEXP '[^[:ascii:]]'),0) AS invalid_count,
        COALESCE(MAX(CHAR_LENGTH(user_uid)),0) AS max_length
      FROM ${table}
    `) || [];
    if (Number(invalid[0] && invalid[0].invalid_count))
      throw new Error(`${table} contains user_uid values that cannot be represented safely as ASCII VARCHAR(128).`);
    const columns = await global.query(`SHOW FULL COLUMNS FROM ${table} LIKE 'user_uid'`) || [];
    const column = columns[0] || {};
    const needsChange = (column.Type || '').toString().toLowerCase() !== 'varchar(128)'
      || (column.Collation || '').toString().toLowerCase() !== 'ascii_bin';
    if (apply && needsChange)
      await global.query(`ALTER TABLE ${table} MODIFY COLUMN user_uid ${USER_UID_DEFINITION}`);
    report.tables.push({
      table,
      exists: true,
      changed: apply && needsChange,
      needs_change: needsChange,
      previous_type: column.Type || null,
      previous_collation: column.Collation || null,
      max_uid_length: Number(invalid[0] && invalid[0].max_length) || 0
    });
  }
  const existingTables = new Set(report.tables.filter(item => item.exists).map(item => item.table));
  for (const definition of OPTIMIZED_INDEXES) {
    if (!existingTables.has(definition.table)) continue;
    const changed = apply
      ? await ensureIndex(definition.table, definition.name, definition.columns)
      : false;
    const indexes = await global.query(`SHOW INDEX FROM ${definition.table} WHERE Key_name=${sql(definition.name)}`) || [];
    const matches = indexMatches(indexes, definition.columns);
    report.indexes.push({
      table: definition.table,
      index: definition.name,
      columns: definition.columns,
      exists: Boolean(indexes.length),
      changed,
      needs_change: !matches
    });
  }
  if (existingTables.has(SESSION_TABLE)) {
    const removedLegacyIndex = apply ? await dropIndex(SESSION_TABLE, 'user_session') : false;
    if (removedLegacyIndex) report.removed_indexes = [{ table: SESSION_TABLE, index: 'user_session' }];
  }
  if (apply && existingTables.has(HISTORY_TABLE)) {
    const removed = [];
    for (const index of ['daily_history', 'ayah_history']) {
      if (await dropIndex(HISTORY_TABLE, index)) removed.push({ table: HISTORY_TABLE, index });
    }
    if (removed.length) report.removed_indexes = (report.removed_indexes || []).concat(removed);
  }
  if (apply) {
    const analyzedTables = Array.from(existingTables);
    if (analyzedTables.length)
      await global.query(`ANALYZE TABLE ${analyzedTables.join(',')}`);
  }
  return report;
}

async function initializeAssessedStates(fsrsSettings) {
  await ensureTables();
  const results = {};
  for (const state of ['weak', 'review', 'core']) {
    if (state === 'weak') {
      const result = await global.query(`
        UPDATE ${TABLE}
        SET stability=0, difficulty=${SELF_ASSESSED_WEAK_DIFFICULTY}, next_review_at=NULL, fsrs_state=0,
          fsrs_scheduled_days=0, fsrs_learning_steps=0, fsrs_version=${QuranFsrs.FSRS_VERSION},
          row_version=row_version+1
        WHERE lifecycle_state='weak' AND review_count=0 AND last_reviewed_at IS NULL
          AND (fsrs_state<>0 OR stability<>0 OR difficulty<>${SELF_ASSESSED_WEAK_DIFFICULTY} OR next_review_at IS NOT NULL)
      `);
      results[state] = Math.max(0, Number(result && result.affectedRows) || 0);
      continue;
    }
    const assessment = QuranFsrs.initialAssessment(state, fsrsSettings);
    const initializationCondition = state === 'core'
      ? `(fsrs_state IS NULL OR fsrs_state<>${Number(assessment.fsrs_state)}
        OR ABS(stability-${Number(assessment.stability).toFixed(6)})>0.000001
        OR ABS(difficulty-${Number(assessment.difficulty).toFixed(6)})>0.000001
        OR next_review_at IS NOT NULL)`
      : `(review_count=0 AND last_reviewed_at IS NULL AND (fsrs_state IS NULL OR fsrs_state=0))`;
    const result = await global.query(`
      UPDATE ${TABLE}
      SET stability=${Number(assessment.stability).toFixed(6)},
        difficulty=${Number(assessment.difficulty).toFixed(6)},
        next_review_at=${sql(assessment.next_review_at)},
        fsrs_state=${Number(assessment.fsrs_state)},
        fsrs_scheduled_days=${Number(assessment.fsrs_scheduled_days)},
        fsrs_learning_steps=${Number(assessment.fsrs_learning_steps)},
        fsrs_version=${QuranFsrs.FSRS_VERSION},
        fully_memorized_at=COALESCE(fully_memorized_at,NOW()),
        learning_last_worked_at=CASE WHEN lifecycle_state='weak' THEN COALESCE(learning_last_worked_at,NOW()) ELSE learning_last_worked_at END,
        row_version=row_version+1
      WHERE lifecycle_state=${sql(state)} AND ${initializationCondition}
    `);
    results[state] = Math.max(0, Number(result && result.affectedRows) || 0);
  }
  return results;
}

module.exports = {
  HISTORY_TABLE,
  LIFECYCLE_STATES,
  REVIEW_GRADES,
  STATE_DESCRIPTIONS,
  STATE_LABELS,
  TABLE,
  buildProgressGeometry,
  bulkStateTransitionAllowed,
  buildProgressGroupDefinitions,
  buildProgressGroups,
  buildMushafPageRefs,
  buildCoreSurahStatuses,
  buildSurahStateStatuses,
  activeReviewSession,
  activeSessionReviewState,
  activeSessionReviewedRefs,
  endReviewSession,
  enrollReviewScope,
  enrollLearningAyahs,
  collection,
  coreSurahStatuses,
  defaultLearningRefs,
  MAX_AGAIN_GRADES_PER_SESSION_ITEM,
  ensureTables,
  get,
  getMany,
  isCleanCoreRow,
  initializeAssessedStates,
  juzNumbersForRefs,
  markSurahCore,
  nextReview,
  normalizeRefs,
  openReviewSessions,
  orderReviewItemsBySurah,
  diversifyReviewCandidatesBySurah,
  optimizeSchema,
  parseRef,
  progress,
  progressGroups,
  optimizeFsrsParameters,
  pauseReviewSession,
  passageKeysForItems,
  includeEnrolledAyatForSelectedPassages,
  limitRegularSessionPassageCompanions,
  pausedReviewSessions,
  recordLearningActivity,
  recordReview,
  recordSessionReview,
  reviewSchedule,
  reviewSessionRequest,
  reviewUndoSnapshot,
  reviewStats,
  rescheduleForTargetRetention,
  resumeReviewSession,
  shouldQueueReviewRetry,
  selectReviewSessionItems,
  selectSurahReviewSessionItems,
  seedDefaultLearningAyat,
  surahReviewScope,
  setProgressGroupState,
  setMushafPageState,
  setRefsState,
  setSurahState,
  startReviewSession,
  stateUpdateValues,
  switchReviewSession,
  nextSessionItem,
  surahStateStatuses,
  undoSessionReview,
  updateState,
  userStateTransitionAllowed
};
