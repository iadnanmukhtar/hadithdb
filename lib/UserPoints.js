/* jslint node:true, esversion:9 */
'use strict';

const crypto = require('crypto');
const util = require('util');
const MySQL = require('mysql');
const createError = require('http-errors');
const debug = require('./Debug')('hadithdb:UserPoints');
const PaymentConfig = require('./PaymentConfig');

const BALANCE_TABLE = 'user_point_balances';
const LEDGER_TABLE = 'user_point_ledger';
const PROFILE_TABLE = 'user_payment_profiles';
const TRANSLATION_TABLE = 'user_content_translations';

let ensurePromise = null;

async function ensureTables() {
  if (ensurePromise)
    return ensurePromise;
  ensurePromise = (async function () {
    await global.query(`
      CREATE TABLE IF NOT EXISTS ${BALANCE_TABLE} (
        user_uid varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL,
        balance_points int NOT NULL DEFAULT 0,
        createdAt datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (user_uid)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await global.query(`
      CREATE TABLE IF NOT EXISTS ${LEDGER_TABLE} (
        id bigint NOT NULL AUTO_INCREMENT,
        user_uid varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL,
        delta_points int NOT NULL,
        balance_after int NOT NULL,
        reason varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
        reference_type varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
        reference_id varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
        metadata_json json NULL,
        createdAt datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY ndx_user_point_reference (user_uid, reference_type, reference_id),
        KEY ndx_user_point_ledger_user_created (user_uid, createdAt)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await ensureLedgerReferenceIndex();
    await global.query(`
      CREATE TABLE IF NOT EXISTS ${PROFILE_TABLE} (
        user_uid varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL,
        user_email varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
        stripe_customer_id varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
        stripe_mode varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
        default_payment_method varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
        auto_recharge_enabled tinyint(1) NOT NULL DEFAULT 0,
        auto_recharge_threshold int NOT NULL DEFAULT 0,
        auto_recharge_package_id varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
        last_payment_error text COLLATE utf8mb4_unicode_ci NULL,
        createdAt datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (user_uid),
        UNIQUE KEY ndx_user_payment_stripe_customer (stripe_customer_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await ensurePaymentProfileModeColumn();
    await PaymentConfig.ensureLanguageTable();
    await global.query(`
      CREATE TABLE IF NOT EXISTS ${TRANSLATION_TABLE} (
        id bigint NOT NULL AUTO_INCREMENT,
        user_uid varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL,
        item_type varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
        item_id varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL,
        target_language varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
        mode varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'translate',
        source_hash char(64) COLLATE utf8mb4_unicode_ci NOT NULL,
        content_json json NOT NULL,
        model varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
        points_charged int NOT NULL DEFAULT 0,
        createdAt datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY ndx_user_content_translation (user_uid, item_type, item_id, target_language, mode, source_hash),
        KEY ndx_user_content_translation_item (item_type, item_id, target_language),
        CONSTRAINT fk_user_content_translations_language FOREIGN KEY (target_language) REFERENCES languages(code)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await ensureTableIndex(TRANSLATION_TABLE, 'ndx_user_content_translations_index_latest', '(item_type, mode, target_language, item_id, updatedAt, id)');
    await ensureTranslationLanguageForeignKeys();
  })().catch(err => {
    ensurePromise = null;
    throw err;
  });
  return ensurePromise;
}

async function ensureTableIndex(tableName, indexName, definition) {
  const rows = await global.query(`SHOW INDEX FROM ${tableName} WHERE Key_name=${sql(indexName)}`);
  if (rows && rows.length)
    return;
  await global.query(`ALTER TABLE ${tableName} ADD KEY ${indexName} ${definition}`);
}

async function ensureLedgerReferenceIndex() {
  const targetColumns = ['user_uid', 'reference_type', 'reference_id'];
  const rows = await global.query(`SHOW INDEX FROM ${LEDGER_TABLE} WHERE Key_name='ndx_user_point_reference'`);
  const columns = (rows || [])
    .sort((a, b) => Number(a.Seq_in_index || 0) - Number(b.Seq_in_index || 0))
    .map(row => row.Column_name);
  if (columns.join(',') === targetColumns.join(','))
    return;
  const clauses = [];
  if (columns.length)
    clauses.push('DROP INDEX ndx_user_point_reference');
  clauses.push('ADD UNIQUE KEY ndx_user_point_reference (user_uid, reference_type, reference_id)');
  await global.query(`ALTER TABLE ${LEDGER_TABLE} ${clauses.join(', ')}`);
}

async function ensurePaymentProfileModeColumn() {
  const rows = await global.query(`SHOW COLUMNS FROM ${PROFILE_TABLE} LIKE 'stripe_mode'`);
  if (rows && rows.length)
    return;
  await global.query(`
    ALTER TABLE ${PROFILE_TABLE}
    ADD COLUMN stripe_mode varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER stripe_customer_id
  `);
}

async function foreignKeyExists(tableName, constraintName) {
  const rows = await global.query(`
    SELECT CONSTRAINT_NAME
    FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA=DATABASE()
      AND TABLE_NAME=${sql(tableName)}
      AND CONSTRAINT_NAME=${sql(constraintName)}
      AND CONSTRAINT_TYPE='FOREIGN KEY'
    LIMIT 1
  `);
  return Boolean(rows && rows.length);
}

async function ensureDisabledLanguageReferences(tableName) {
  await global.query(`
    INSERT IGNORE INTO languages (code, label, dir, script, font_class, sort_order, enabled)
    SELECT DISTINCT
      t.target_language,
      UPPER(t.target_language),
      CASE WHEN t.target_language IN ('ar', 'fa', 'he', 'ur') THEN 'rtl' ELSE 'ltr' END,
      '',
      'content-language-latin',
      999,
      0
    FROM ${tableName} t
    LEFT JOIN languages l ON l.code=t.target_language
    WHERE l.code IS NULL
      AND t.target_language REGEXP '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$'
  `);
}

async function ensureTranslationLanguageForeignKey(tableName, constraintName) {
  if (await foreignKeyExists(tableName, constraintName))
    return;
  await ensureDisabledLanguageReferences(tableName);
  const invalidRows = await global.query(`
    SELECT COUNT(*) invalid_count
    FROM ${tableName} t
    LEFT JOIN languages l ON l.code=t.target_language
    WHERE l.code IS NULL
  `);
  const invalidCount = Number(invalidRows && invalidRows[0] && invalidRows[0].invalid_count || 0);
  if (invalidCount > 0) {
    debug.error(`skipping ${constraintName}; ${invalidCount} ${tableName} rows have target_language values missing from languages.code`);
    return;
  }
  await global.query(`
    ALTER TABLE ${tableName}
    ADD CONSTRAINT ${constraintName} FOREIGN KEY (target_language) REFERENCES languages(code)
  `);
}

async function ensureTranslationLanguageForeignKeys() {
  await ensureTranslationLanguageForeignKey(TRANSLATION_TABLE, 'fk_user_content_translations_language');
}

function normalizeUser(user) {
  if (!user || typeof user !== 'object')
    throw createError(401, 'Authentication required.');
  const uid = (user.uid || user.userId || user.email || '').toString();
  if (!uid)
    throw createError(401, 'Authentication required.');
  return {
    uid,
    email: user.email || null,
    name: user.name || user.displayName || user.email || 'User'
  };
}

function sql(value) {
  return MySQL.escape(value);
}

function metadataSql(metadata) {
  return metadata === undefined ? 'NULL' : `CAST(${sql(JSON.stringify(metadata || {}))} AS JSON)`;
}

function getConnection() {
  return new Promise((resolve, reject) => {
    global.dbPool.getConnection((err, connection) => {
      if (err)
        reject(err);
      else
        resolve(connection);
    });
  });
}

function query(connection, statement) {
  const run = util.promisify(connection.query).bind(connection);
  const t0 = Date.now();
  const sql = statement.trim();
  return run(statement).catch(err => {
    debug.error(`mysql transaction query failed ${((Date.now() - t0) / 1000).toFixed(3)} secs ${err.message}\n${err.stack || ''}\n${sql}`);
    throw err;
  });
}

async function transaction(fn) {
  const connection = await getConnection();
  const begin = util.promisify(connection.beginTransaction).bind(connection);
  const commit = util.promisify(connection.commit).bind(connection);
  const rollback = util.promisify(connection.rollback).bind(connection);
  try {
    await begin();
    const result = await fn(statement => query(connection, statement), connection);
    await commit();
    return result;
  } catch (err) {
    try {
      await rollback();
    } catch (rollbackErr) {
      debug.error(`rollback failed: ${rollbackErr.message}\n${rollbackErr.stack || ''}`);
    }
    throw err;
  } finally {
    connection.release();
  }
}

async function insertBalanceRow(q, userUid) {
  await q(`
    INSERT IGNORE INTO ${BALANCE_TABLE} (user_uid, balance_points)
    VALUES (${sql(userUid)}, 0)
  `);
}

async function applyInitialGrant(user) {
  const points = PaymentConfig.initialGrantPoints();
  if (!points)
    return;
  const referenceId = `initial:${user.uid}`;
  await creditPoints(user, points, 'initial_grant', 'initial_grant', referenceId, { source: 'settings.payments.initialGrantPoints' });
}

async function ensureUser(user) {
  user = normalizeUser(user);
  await ensureTables();
  const result = await global.query(`
    INSERT IGNORE INTO ${BALANCE_TABLE} (user_uid, balance_points)
    VALUES (${sql(user.uid)}, 0)
  `);
  await global.query(`
    INSERT INTO ${PROFILE_TABLE} (user_uid, user_email)
    VALUES (${sql(user.uid)}, ${user.email ? sql(user.email) : 'NULL'})
    ON DUPLICATE KEY UPDATE user_email=VALUES(user_email)
  `);
  if (result && result.affectedRows > 0)
    await applyInitialGrant(user);
  return user;
}

async function balance(user) {
  user = await ensureUser(user);
  const rows = await global.query(`
    SELECT balance_points
    FROM ${BALANCE_TABLE}
    WHERE user_uid=${sql(user.uid)}
    LIMIT 1
  `);
  return rows && rows.length ? Number(rows[0].balance_points || 0) : 0;
}

async function profile(user) {
  user = await ensureUser(user);
  const rows = await global.query(`
    SELECT *
    FROM ${PROFILE_TABLE}
    WHERE user_uid=${sql(user.uid)}
    LIMIT 1
  `);
  const defaults = PaymentConfig.autoRechargeDefaults();
  const row = rows && rows[0] ? rows[0] : {};
  return {
    userUid: user.uid,
    stripeCustomerId: row.stripe_customer_id || '',
    stripeMode: row.stripe_mode || '',
    defaultPaymentMethod: row.default_payment_method || '',
    autoRechargeEnabled: Number(row.auto_recharge_enabled) === 1,
    autoRechargeThreshold: Number(row.auto_recharge_threshold || defaults.thresholdPoints),
    autoRechargePackageId: row.auto_recharge_package_id || defaults.packageId || '',
    lastPaymentError: row.last_payment_error || ''
  };
}

async function updatePaymentProfile(user, patch) {
  user = await ensureUser(user);
  patch = patch || {};
  const assignments = [];
  if (patch.stripeCustomerId !== undefined)
    assignments.push(`stripe_customer_id=${patch.stripeCustomerId ? sql(patch.stripeCustomerId) : 'NULL'}`);
  if (patch.stripeMode !== undefined) {
    const mode = ['live', 'test'].includes((patch.stripeMode || '').toString()) ? patch.stripeMode.toString() : '';
    assignments.push(`stripe_mode=${mode ? sql(mode) : 'NULL'}`);
  }
  if (patch.defaultPaymentMethod !== undefined)
    assignments.push(`default_payment_method=${patch.defaultPaymentMethod ? sql(patch.defaultPaymentMethod) : 'NULL'}`);
  if (patch.autoRechargeEnabled !== undefined)
    assignments.push(`auto_recharge_enabled=${patch.autoRechargeEnabled ? 1 : 0}`);
  if (patch.autoRechargeThreshold !== undefined)
    assignments.push(`auto_recharge_threshold=${Math.max(0, Math.floor(Number(patch.autoRechargeThreshold) || 0))}`);
  if (patch.autoRechargePackageId !== undefined)
    assignments.push(`auto_recharge_package_id=${patch.autoRechargePackageId ? sql(patch.autoRechargePackageId) : 'NULL'}`);
  if (patch.lastPaymentError !== undefined)
    assignments.push(`last_payment_error=${patch.lastPaymentError ? sql(patch.lastPaymentError.toString().slice(0, 2000)) : 'NULL'}`);
  if (!assignments.length)
    return profile(user);
  await global.query(`
    INSERT INTO ${PROFILE_TABLE} (user_uid, user_email)
    VALUES (${sql(user.uid)}, ${user.email ? sql(user.email) : 'NULL'})
    ON DUPLICATE KEY UPDATE user_email=VALUES(user_email)
  `);
  await global.query(`
    UPDATE ${PROFILE_TABLE}
    SET ${assignments.join(', ')}
    WHERE user_uid=${sql(user.uid)}
    LIMIT 1
  `);
  return profile(user);
}

async function userByUid(userUid, email) {
  return normalizeUser({ uid: userUid, email: email || null });
}

async function userByStripeCustomerId(customerId) {
  await ensureTables();
  const rows = await global.query(`
    SELECT user_uid, user_email
    FROM ${PROFILE_TABLE}
    WHERE stripe_customer_id=${sql(customerId)}
    LIMIT 1
  `);
  if (!rows || !rows.length)
    return null;
  return userByUid(rows[0].user_uid, rows[0].user_email);
}

async function creditPoints(user, points, reason, referenceType, referenceId, metadata) {
  user = await ensureUser(user);
  points = Math.floor(Number(points));
  if (!Number.isInteger(points) || points <= 0)
    throw createError(400, 'Point credit must be a positive integer.');
  referenceType = (referenceType || 'manual').toString().slice(0, 64);
  referenceId = (referenceId || crypto.randomUUID()).toString().slice(0, 255);
  try {
    return await transaction(async q => {
      await insertBalanceRow(q, user.uid);
      const rows = await q(`
        SELECT balance_points
        FROM ${BALANCE_TABLE}
        WHERE user_uid=${sql(user.uid)}
        FOR UPDATE
      `);
      const before = rows && rows.length ? Number(rows[0].balance_points || 0) : 0;
      const after = before + points;
      await q(`
        INSERT INTO ${LEDGER_TABLE}
          (user_uid, delta_points, balance_after, reason, reference_type, reference_id, metadata_json)
        VALUES
          (${sql(user.uid)}, ${points}, ${after}, ${sql(reason || 'credit')}, ${sql(referenceType)}, ${sql(referenceId)}, ${metadataSql(metadata)})
      `);
      await q(`
        UPDATE ${BALANCE_TABLE}
        SET balance_points=${after}
        WHERE user_uid=${sql(user.uid)}
        LIMIT 1
      `);
      return { credited: true, balance: after, points };
    });
  } catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY')
      return { credited: false, balance: await balance(user), points: 0 };
    throw err;
  }
}

async function debitPoints(user, points, reason, referenceType, referenceId, metadata) {
  user = await ensureUser(user);
  points = Math.floor(Number(points));
  if (!Number.isInteger(points) || points <= 0)
    return { debited: true, balance: await balance(user), points: 0 };
  referenceType = (referenceType || 'content').toString().slice(0, 64);
  referenceId = (referenceId || crypto.randomUUID()).toString().slice(0, 255);
  return transaction(async q => {
    await insertBalanceRow(q, user.uid);
    const rows = await q(`
      SELECT balance_points
      FROM ${BALANCE_TABLE}
      WHERE user_uid=${sql(user.uid)}
      FOR UPDATE
    `);
    const before = rows && rows.length ? Number(rows[0].balance_points || 0) : 0;
    if (before < points)
      throw createError(402, 'Not enough points. Buy more points from My Settings.');
    const after = before - points;
    await q(`
      UPDATE ${BALANCE_TABLE}
      SET balance_points=${after}
      WHERE user_uid=${sql(user.uid)}
      LIMIT 1
    `);
    await q(`
      INSERT INTO ${LEDGER_TABLE}
        (user_uid, delta_points, balance_after, reason, reference_type, reference_id, metadata_json)
      VALUES
        (${sql(user.uid)}, ${-points}, ${after}, ${sql(reason || 'debit')}, ${sql(referenceType)}, ${sql(referenceId)}, ${metadataSql(metadata)})
    `);
    return { debited: true, balance: after, points };
  });
}

async function ledger(user, limit) {
  user = await ensureUser(user);
  limit = Math.min(100, Math.max(1, Math.floor(Number(limit) || 20)));
  return global.query(`
    SELECT delta_points, balance_after, reason, reference_type, metadata_json, createdAt
    FROM ${LEDGER_TABLE}
    WHERE user_uid=${sql(user.uid)}
    ORDER BY id DESC
    LIMIT ${limit}
  `);
}

function hadithIdSql(itemId) {
  const hadithId = parseInt(itemId, 10);
  if (!Number.isInteger(hadithId) || hadithId <= 0)
    throw createError(400, 'Invalid hadith id.');
  return hadithId;
}

function normalizeContentTranslationItem(itemType, itemId) {
  itemType = (itemType || '').toString().trim().toLowerCase();
  if (!/^[a-z0-9_-]{1,32}$/.test(itemType))
    throw createError(400, 'Invalid content type.');
  if (itemType === 'hadith') {
    return {
      itemType,
      itemId: hadithIdSql(itemId).toString()
    };
  }
  itemId = (itemId || '').toString().trim();
  if (!itemId)
    throw createError(400, 'Invalid content id.');
  return { itemType, itemId };
}

async function contentTranslation(user, itemType, itemId, targetLanguage, mode, sourceHash) {
  user = await ensureUser(user);
  const item = normalizeContentTranslationItem(itemType, itemId);
  const rows = await global.query(`
    SELECT *
    FROM ${TRANSLATION_TABLE}
    WHERE user_uid=${sql(user.uid)}
      AND item_type=${sql(item.itemType)}
      AND item_id=${sql(item.itemId)}
      AND target_language=${sql(targetLanguage)}
      AND mode=${sql(mode || 'translate')}
      AND source_hash=${sql(sourceHash)}
    LIMIT 1
  `);
  if (!rows || !rows.length)
    return null;
  const row = rows[0];
  return {
    id: row.id,
    content: typeof row.content_json === 'object' ? row.content_json : JSON.parse(row.content_json || '{}'),
    model: row.model || '',
    pointsCharged: Number(row.points_charged || 0),
    createdAt: row.createdAt
  };
}

async function availableContentTranslations(itemType, itemId, sourceHash) {
  await ensureTables();
  const item = normalizeContentTranslationItem(itemType, itemId);
  const rows = await global.query(`
    SELECT target_language, content_json, model, points_charged, updatedAt
    FROM ${TRANSLATION_TABLE}
    WHERE item_type=${sql(item.itemType)}
      AND item_id=${sql(item.itemId)}
      AND mode='translate'
      AND source_hash=${sql(sourceHash)}
    ORDER BY target_language ASC, id DESC
  `);
  const seen = new Set();
  return (rows || []).filter(row => {
    const code = (row.target_language || '').toString();
    if (!code || seen.has(code))
      return false;
    seen.add(code);
    return true;
  }).map(row => ({
    targetLanguage: row.target_language || '',
    content: typeof row.content_json === 'object' ? row.content_json : JSON.parse(row.content_json || '{}'),
    model: row.model || '',
    pointsCharged: Number(row.points_charged || 0),
    updatedAt: row.updatedAt
  }));
}

async function saveContentTranslation(user, itemType, itemId, targetLanguage, mode, sourceHash, content, model, pointsCharged) {
  user = await ensureUser(user);
  const item = normalizeContentTranslationItem(itemType, itemId);
  await global.query(`
    INSERT INTO ${TRANSLATION_TABLE}
      (user_uid, item_type, item_id, target_language, mode, source_hash, content_json, model, points_charged)
    VALUES
      (${sql(user.uid)}, ${sql(item.itemType)}, ${sql(item.itemId)}, ${sql(targetLanguage)}, ${sql(mode || 'translate')}, ${sql(sourceHash)},
       CAST(${sql(JSON.stringify(content || {}))} AS JSON), ${model ? sql(model) : 'NULL'}, ${Math.max(0, Math.floor(Number(pointsCharged) || 0))})
    ON DUPLICATE KEY UPDATE
      content_json=VALUES(content_json),
      model=VALUES(model),
      points_charged=VALUES(points_charged)
  `);
  return contentTranslation(user, item.itemType, item.itemId, targetLanguage, mode, sourceHash);
}

async function debitAndSaveContentTranslation(user, itemType, itemId, targetLanguage, mode, sourceHash, content, model, points, reason, referenceType, referenceId, metadata) {
  user = await ensureUser(user);
  points = Math.max(0, Math.floor(Number(points) || 0));
  reason = reason || 'content_translation';
  referenceType = (referenceType || 'content_translation').toString().slice(0, 64);
  referenceId = (referenceId || crypto.randomUUID()).toString().slice(0, 255);
  mode = mode || 'translate';
  const item = normalizeContentTranslationItem(itemType, itemId);
  const contentJson = sql(JSON.stringify(content || {}));
  const modelSql = model ? sql(model) : 'NULL';
  return transaction(async q => {
    await insertBalanceRow(q, user.uid);
    const rows = await q(`
      SELECT balance_points
      FROM ${BALANCE_TABLE}
      WHERE user_uid=${sql(user.uid)}
      FOR UPDATE
    `);
    const before = rows && rows.length ? Number(rows[0].balance_points || 0) : 0;
    let after = before;
    let alreadyDebited = false;
    if (points > 0) {
      const existingDebits = await q(`
        SELECT delta_points, balance_after
        FROM ${LEDGER_TABLE}
        WHERE user_uid=${sql(user.uid)}
          AND reference_type=${sql(referenceType)}
          AND reference_id=${sql(referenceId)}
        LIMIT 1
        FOR UPDATE
      `);
      if (existingDebits && existingDebits.length) {
        const existingDelta = Number(existingDebits[0].delta_points || 0);
        if (existingDelta !== -points)
          throw createError(409, 'This translation was already charged with a different point amount.');
        alreadyDebited = true;
      } else {
        if (before < points)
          throw createError(402, 'Not enough points. Buy more points from My Settings.');
        after = before - points;
        await q(`
          UPDATE ${BALANCE_TABLE}
          SET balance_points=${after}
          WHERE user_uid=${sql(user.uid)}
          LIMIT 1
        `);
        await q(`
          INSERT INTO ${LEDGER_TABLE}
            (user_uid, delta_points, balance_after, reason, reference_type, reference_id, metadata_json)
          VALUES
            (${sql(user.uid)}, ${-points}, ${after}, ${sql(reason)}, ${sql(referenceType)}, ${sql(referenceId)}, ${metadataSql(metadata)})
        `);
      }
    }
    await q(`
      INSERT INTO ${TRANSLATION_TABLE}
        (user_uid, item_type, item_id, target_language, mode, source_hash, content_json, model, points_charged)
      VALUES
        (${sql(user.uid)}, ${sql(item.itemType)}, ${sql(item.itemId)}, ${sql(targetLanguage)}, ${sql(mode)}, ${sql(sourceHash)},
         CAST(${contentJson} AS JSON), ${modelSql}, ${points})
      ON DUPLICATE KEY UPDATE
        content_json=VALUES(content_json),
        model=VALUES(model),
        points_charged=VALUES(points_charged)
    `);
    return {
      content,
      model: model || '',
      pointsCharged: points,
      debit: { debited: alreadyDebited !== true, alreadyDebited, balance: alreadyDebited ? before : after, points }
    };
  });
}

module.exports = {
  availableContentTranslations,
  balance,
  contentTranslation,
  creditPoints,
  debitAndSaveContentTranslation,
  debitPoints,
  ensureTables,
  ensureUser,
  ledger,
  profile,
  saveContentTranslation,
  updatePaymentProfile,
  userByStripeCustomerId
};
