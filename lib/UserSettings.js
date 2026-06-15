/* jslint node:true, esversion:9 */
'use strict';

const MySQL = require('mysql');
const Utils = require('./Utils');

const TABLE = 'user_settings';

async function ensureTable() {
  return;
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

function normalizeTafsirBookmarkArray(refs, max = 200) {
  if (!Array.isArray(refs)) return [];
  return Array.from(new Set(refs
    .map(ref => (ref || '').toString().trim())
    .filter(ref => /^[A-Za-z0-9_-]+:[0-9]{1,3}:[0-9]{1,3}$/.test(ref))))
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
    headings: normalizeIdArray(bookmarks.headings),
    tafsirs: normalizeTafsirBookmarkArray(bookmarks.tafsirs)
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
  if (!userId) return null;
  const userSql = MySQL.escape(userId);
  const rows = await global.query(`
    SELECT user_uid, user_email, admin
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
    provider: 'google.com',
    name: row.user_email || 'User',
    email: row.user_email || null,
    photo: null,
    admin
  };
}

function normalizeUser(user) {
  if (typeof user === 'string') {
    return {
      uid: user,
      provider: 'google.com',
      email: user,
    };
  }
  return {
    uid: user && user.uid,
    provider: 'google.com',
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
  const user = normalizeUser(loginUser);
  if (!user.uid) throw new Error('Missing Google user id');
  await mergeLegacyEmailRow(user);
  const uidSql = MySQL.escape(user.uid);
  const emailSql = user.email ? MySQL.escape(user.email) : 'NULL';
  const settingsSql = MySQL.escape(JSON.stringify(normalizeSettings({})));
  await global.query(`
    INSERT INTO ${TABLE} (user_uid, user_email, settings_json)
    VALUES (${uidSql}, ${emailSql}, CAST(${settingsSql} AS JSON))
    ON DUPLICATE KEY UPDATE
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
  user = normalizeUser(user);
  if (!user.uid) throw new Error('Missing Google user id');
  await mergeLegacyEmailRow(user);
  const normalized = normalizeSettings(settings);
  const settingsSql = MySQL.escape(JSON.stringify(normalized));
  const uidSql = MySQL.escape(user.uid);
  const emailSql = user.email ? MySQL.escape(user.email) : 'NULL';
  await global.query(`
    INSERT INTO ${TABLE} (user_uid, user_email, settings_json)
    VALUES (${uidSql}, ${emailSql}, CAST(${settingsSql} AS JSON))
    ON DUPLICATE KEY UPDATE
      user_email=VALUES(user_email),
      settings_json=VALUES(settings_json)
  `);
  return normalized;
}

module.exports = {
  ensureTable,
  ensureLoginUser,
  getLoginUser,
  getSettings,
  isAdminUser,
  normalizeSettings,
  saveSettings
};
