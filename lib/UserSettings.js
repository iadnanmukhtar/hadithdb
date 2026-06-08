/* jslint node:true, esversion:9 */
'use strict';

const MySQL = require('mysql');
const crypto = require('crypto');
const Utils = require('./Utils');

const TABLE = 'user_settings';
const SESSIONS_TABLE = 'user_sessions';
let ensured = false;

async function ensureTable() {
  if (ensured) return;
  await global.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      user_uid varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL,
      user_provider varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
      user_name varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
      user_email varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
      admin tinyint(1) NOT NULL DEFAULT 0,
      settings_json json NOT NULL,
      createdAt datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (user_uid),
      KEY ndx_user_email (user_email)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  const adminColumn = await global.query(`
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME='${TABLE}'
      AND COLUMN_NAME='admin'
    LIMIT 1
  `);
  if (!adminColumn || adminColumn.length < 1) {
    await global.query(`
      ALTER TABLE ${TABLE}
      ADD COLUMN admin tinyint(1) NOT NULL DEFAULT 0 AFTER user_email
    `);
  }
  await global.query(`
    CREATE TABLE IF NOT EXISTS ${SESSIONS_TABLE} (
      session_token_hash varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
      user_uid varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL,
      createdAt datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expiresAt datetime NOT NULL,
      lastSeenAt datetime DEFAULT NULL,
      PRIMARY KEY (session_token_hash),
      KEY ndx_user_sessions_user (user_uid),
      KEY ndx_user_sessions_expires (expiresAt)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  ensured = true;
}

function parseSettings(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (err) {
    return {};
  }
}

function isOwnerEmail(email) {
  const ownerEmail = global.settings && global.settings.site && global.settings.site.email;
  return !!(email && ownerEmail && email.toLowerCase() === ownerEmail.toLowerCase());
}

function normalizeIdArray(ids, max = 500) {
  if (!Array.isArray(ids)) return [];
  return Array.from(new Set(ids
    .map(id => parseInt(id, 10))
    .filter(id => Number.isInteger(id) && id > 0)))
    .slice(0, max);
}

function normalizeAliasArray(aliases, max = 200) {
  if (!Array.isArray(aliases)) return [];
  return Array.from(new Set(aliases
    .map(alias => (alias || '').toString().trim())
    .filter(alias => /^[A-Za-z0-9_-]+$/.test(alias))))
    .slice(0, max);
}

function normalizeSettings(settings) {
  const source = settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {};
  const normalized = { ...source };
  const bookmarks = source.bookmarks && typeof source.bookmarks === 'object' && !Array.isArray(source.bookmarks)
    ? source.bookmarks
    : {};
  normalized.bookmarks = {
    hadiths: normalizeIdArray(bookmarks.hadiths),
    headings: normalizeIdArray(bookmarks.headings)
  };
  const tafsirs = source.tafsirs && typeof source.tafsirs === 'object' && !Array.isArray(source.tafsirs)
    ? source.tafsirs
    : {};
  const order = tafsirs.order && typeof tafsirs.order === 'object' && !Array.isArray(tafsirs.order)
    ? tafsirs.order
    : {};
  normalized.tafsirs = {
    disabledAliases: normalizeAliasArray(tafsirs.disabledAliases),
    order: {
      en: normalizeAliasArray(order.en),
      ar: normalizeAliasArray(order.ar)
    }
  };
  return normalized;
}

async function getSettings(userUid) {
  await ensureTable();
  const uid = Utils.escSQL(userUid);
  const rows = await global.query(`
    SELECT settings_json
    FROM ${TABLE}
    WHERE user_uid='${uid}'
    LIMIT 1
  `);
  if (!rows || !rows.length) return {};
  return normalizeSettings(parseSettings(rows[0].settings_json));
}

async function isAdminUser(userId) {
  await ensureTable();
  if (!userId) return false;
  const userSql = MySQL.escape(userId);
  const rows = await global.query(`
    SELECT admin, user_email
    FROM ${TABLE}
    WHERE user_uid=${userSql}
      OR user_email=${userSql}
    ORDER BY admin DESC, updatedAt DESC
    LIMIT 1
  `);
  return Boolean(rows && rows.length && (Number(rows[0].admin) === 1 || isOwnerEmail(rows[0].user_email)));
}

async function getLoginUser(userId) {
  await ensureTable();
  if (!userId) return null;
  const userSql = MySQL.escape(userId);
  const rows = await global.query(`
    SELECT user_uid, user_provider, user_name, user_email, admin
    FROM ${TABLE}
    WHERE user_uid=${userSql}
      OR user_email=${userSql}
    ORDER BY user_uid=${userSql} DESC, admin DESC, updatedAt DESC
    LIMIT 1
  `);
  if (!rows || !rows.length) return null;
  const row = rows[0];
  const admin = Number(row.admin) === 1 || isOwnerEmail(row.user_email);
  return {
    uid: row.user_uid,
    provider: row.user_provider || 'google.com',
    name: row.user_name || row.user_email || 'User',
    email: row.user_email || null,
    admin
  };
}

function hashSessionToken(token) {
  return crypto.createHash('sha256').update(token || '').digest('hex');
}

async function createLoginSession(userId, maxAgeMs) {
  await ensureTable();
  if (!userId) throw new Error('Missing user id');
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHashSql = MySQL.escape(hashSessionToken(token));
  const uidSql = MySQL.escape(userId);
  const expiresAt = new Date(Date.now() + maxAgeMs);
  const expiresSql = MySQL.escape(expiresAt.toISOString().slice(0, 19).replace('T', ' '));
  await global.query(`DELETE FROM ${SESSIONS_TABLE} WHERE expiresAt <= NOW()`);
  await global.query(`
    INSERT INTO ${SESSIONS_TABLE} (session_token_hash, user_uid, expiresAt)
    VALUES (${tokenHashSql}, ${uidSql}, ${expiresSql})
  `);
  return token;
}

async function clearLoginSession(token) {
  await ensureTable();
  if (!token) return;
  const tokenHashSql = MySQL.escape(hashSessionToken(token));
  await global.query(`
    DELETE FROM ${SESSIONS_TABLE}
    WHERE session_token_hash=${tokenHashSql}
    LIMIT 1
  `);
}

async function getLoginUserBySession(token) {
  await ensureTable();
  if (!token) return null;
  const tokenHashSql = MySQL.escape(hashSessionToken(token));
  const rows = await global.query(`
    SELECT u.user_uid, u.user_provider, u.user_name, u.user_email, u.admin
    FROM ${SESSIONS_TABLE} s
      JOIN ${TABLE} u ON u.user_uid=s.user_uid
    WHERE s.session_token_hash=${tokenHashSql}
      AND s.expiresAt > NOW()
    LIMIT 1
  `);
  if (!rows || !rows.length) return null;
  await global.query(`
    UPDATE ${SESSIONS_TABLE}
    SET lastSeenAt=NOW()
    WHERE session_token_hash=${tokenHashSql}
    LIMIT 1
  `);
  const row = rows[0];
  const admin = Number(row.admin) === 1 || isOwnerEmail(row.user_email);
  return {
    uid: row.user_uid,
    provider: row.user_provider || 'google.com',
    name: row.user_name || row.user_email || 'User',
    email: row.user_email || null,
    admin
  };
}

function normalizeUser(user) {
  if (typeof user === 'string') {
    return {
      uid: user,
      provider: 'google.com',
      name: user,
      email: user
    };
  }
  return {
    uid: user && user.uid,
    provider: user && user.provider ? user.provider : 'google.com',
    name: user && user.name ? user.name : (user && user.email ? user.email : 'User'),
    email: user && user.email ? user.email : null
  };
}

async function mergeLegacyEmailRow(user) {
  if (!user.email) return;
  const uidSql = MySQL.escape(user.uid);
  const emailSql = MySQL.escape(user.email);
  const legacyRows = await global.query(`
    SELECT user_uid, admin, settings_json
    FROM ${TABLE}
    WHERE user_uid<>${uidSql}
      AND (user_uid=${emailSql} OR user_email=${emailSql})
    ORDER BY admin DESC, updatedAt DESC
  `);
  if (!legacyRows || !legacyRows.length) return;
  const currentRows = await global.query(`
    SELECT user_uid, admin, settings_json
    FROM ${TABLE}
    WHERE user_uid=${uidSql}
    LIMIT 1
  `);
  if (!currentRows || !currentRows.length) {
    const sourceUidSql = MySQL.escape(legacyRows[0].user_uid);
    await global.query(`
      UPDATE ${TABLE}
      SET user_uid=${uidSql},
          user_provider=${MySQL.escape(user.provider)},
          user_name=${MySQL.escape(user.name)},
          user_email=${emailSql}
      WHERE user_uid=${sourceUidSql}
      LIMIT 1
    `);
    if (legacyRows.length > 1) {
      const duplicateUidsSql = legacyRows
        .slice(1)
        .map(row => MySQL.escape(row.user_uid))
        .join(',');
      await global.query(`DELETE FROM ${TABLE} WHERE user_uid IN (${duplicateUidsSql})`);
    }
    return;
  }
  const adminValue = legacyRows.some(row => Number(row.admin) === 1) ? 1 : 0;
  const legacySettings = legacyRows
    .map(row => normalizeSettings(parseSettings(row.settings_json)))
    .find(settings => JSON.stringify(settings) !== JSON.stringify(normalizeSettings({}))) || normalizeSettings({});
  const legacySettingsSql = MySQL.escape(JSON.stringify(legacySettings));
  await global.query(`
    UPDATE ${TABLE}
    SET admin=GREATEST(admin, ${adminValue}),
        user_provider=${MySQL.escape(user.provider)},
        user_name=${MySQL.escape(user.name)},
        user_email=${emailSql},
        settings_json=CASE
          WHEN JSON_LENGTH(settings_json)=0 THEN CAST(${legacySettingsSql} AS JSON)
          ELSE settings_json
        END
    WHERE user_uid=${uidSql}
    LIMIT 1
  `);
  const legacyUidsSql = legacyRows.map(row => MySQL.escape(row.user_uid)).join(',');
  await global.query(`DELETE FROM ${TABLE} WHERE user_uid IN (${legacyUidsSql})`);
}

async function ensureLoginUser(loginUser) {
  await ensureTable();
  const user = normalizeUser(loginUser);
  if (!user.uid) throw new Error('Missing Google user id');
  await mergeLegacyEmailRow(user);
  const uidSql = MySQL.escape(user.uid);
  const providerSql = MySQL.escape(user.provider);
  const nameSql = MySQL.escape(user.name);
  const emailSql = user.email ? MySQL.escape(user.email) : 'NULL';
  const settingsSql = MySQL.escape(JSON.stringify(normalizeSettings({})));
  await global.query(`
    INSERT INTO ${TABLE} (user_uid, user_provider, user_name, user_email, settings_json)
    VALUES (${uidSql}, ${providerSql}, ${nameSql}, ${emailSql}, CAST(${settingsSql} AS JSON))
    ON DUPLICATE KEY UPDATE
      user_provider=VALUES(user_provider),
      user_name=VALUES(user_name),
      user_email=VALUES(user_email)
  `);
  if (isOwnerEmail(user.email)) {
    await global.query(`
      UPDATE ${TABLE}
      SET admin=1
      WHERE user_uid=${uidSql}
      LIMIT 1
    `);
  }
  return isAdminUser(user.uid);
}

async function saveSettings(user, settings) {
  await ensureTable();
  user = normalizeUser(user);
  if (!user.uid) throw new Error('Missing Google user id');
  await mergeLegacyEmailRow(user);
  const normalized = normalizeSettings(settings);
  const settingsSql = MySQL.escape(JSON.stringify(normalized));
  const uidSql = MySQL.escape(user.uid);
  const providerSql = user.provider ? MySQL.escape(user.provider) : 'NULL';
  const nameSql = user.name ? MySQL.escape(user.name) : 'NULL';
  const emailSql = user.email ? MySQL.escape(user.email) : 'NULL';
  await global.query(`
    INSERT INTO ${TABLE} (user_uid, user_provider, user_name, user_email, settings_json)
    VALUES (${uidSql}, ${providerSql}, ${nameSql}, ${emailSql}, CAST(${settingsSql} AS JSON))
    ON DUPLICATE KEY UPDATE
      user_provider=VALUES(user_provider),
      user_name=VALUES(user_name),
      user_email=VALUES(user_email),
      settings_json=VALUES(settings_json)
  `);
  return normalized;
}

module.exports = {
  clearLoginSession,
  createLoginSession,
  ensureTable,
  ensureLoginUser,
  getLoginUserBySession,
  getLoginUser,
  getSettings,
  isAdminUser,
  normalizeSettings,
  saveSettings
};
