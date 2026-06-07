/* jslint node:true, esversion:9 */
'use strict';

const MySQL = require('mysql');
const Utils = require('./Utils');

const TABLE = 'user_settings';
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
    SELECT admin
    FROM ${TABLE}
    WHERE user_uid=${userSql}
      OR user_email=${userSql}
    ORDER BY admin DESC, updatedAt DESC
    LIMIT 1
  `);
  return Boolean(rows && rows.length && Number(rows[0].admin) === 1);
}

async function ensureLoginUser(userId) {
  await ensureTable();
  const uidSql = MySQL.escape(userId);
  const settingsSql = MySQL.escape(JSON.stringify(normalizeSettings({})));
  await global.query(`
    INSERT INTO ${TABLE} (user_uid, user_provider, user_name, user_email, settings_json)
    VALUES (${uidSql}, 'google.com', ${uidSql}, ${uidSql}, CAST(${settingsSql} AS JSON))
    ON DUPLICATE KEY UPDATE
      user_name=VALUES(user_name),
      user_email=VALUES(user_email)
  `);
  return isAdminUser(userId);
}

async function saveSettings(user, settings) {
  await ensureTable();
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
  ensureTable,
  ensureLoginUser,
  getSettings,
  isAdminUser,
  normalizeSettings,
  saveSettings
};
