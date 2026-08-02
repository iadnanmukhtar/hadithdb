/* jslint node:true, esversion:9 */
'use strict';

const MySQL = require('mysql');
const Utils = require('./Utils');
const PaymentConfig = require('./PaymentConfig');
const QuranFsrs = require('./QuranFsrs');

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

function normalizeMushafBookmarkPage(page) {
  const parsed = parseInt(page, 10);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 604 ? parsed : null;
}

function normalizeReviewLimit(value) {
  const parsed = parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 200 ? parsed : 10;
}

function normalizeReviewOrder(value) {
  const order = (value || '').toString().trim();
  return ['due_first', 'quran_order', 'random'].includes(order)
    ? order
    : 'due_first';
}

function normalizeReviewCategoryLimit(value, fallback, maximum) {
  const parsed = parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= maximum ? parsed : fallback;
}

function normalizeReviewTimeBudget(value) {
  const parsed = parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 240 ? parsed : 0;
}

function normalizeQuranScript(value) {
  value = Utils.trimToEmpty(value).toLowerCase();
  return ['uthmani', 'indo-pak', 'warsh'].includes(value) ? value : 'uthmani';
}

function normalizeQuranHelpTours(value) {
  const allowed = new Set(['mushaf', 'memorize', 'review', 'study', 'tafsir']);
  return Array.from(new Set((Array.isArray(value) ? value : [])
    .map(mode => Utils.trimToEmpty(mode).toLowerCase())
    .filter(mode => allowed.has(mode))));
}

function normalizeSettings(settings) {
  const source = settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {};
  const normalized = { ...source };
  const quran = source.quran && typeof source.quran === 'object' && !Array.isArray(source.quran)
    ? source.quran
    : {};
  normalized.quran = {
    ...quran,
    script: normalizeQuranScript(quran.script),
    dismissedHelpTours: normalizeQuranHelpTours(quran.dismissedHelpTours)
  };
  const bookmarks = source.bookmarks && typeof source.bookmarks === 'object' && !Array.isArray(source.bookmarks)
    ? source.bookmarks
    : {};
  normalized.bookmarks = {
    hadiths: normalizeIdArray(bookmarks.hadiths),
    headings: normalizeIdArray(bookmarks.headings),
    tafsirs: normalizeTafsirBookmarkArray(bookmarks.tafsirs),
    mushafPage: normalizeMushafBookmarkPage(bookmarks.mushafPage)
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
  const translations = source.translations && typeof source.translations === 'object' && !Array.isArray(source.translations)
    ? source.translations
    : {};
  const translationDisabledAliases = normalizeAliasArray(translations.disabledAliases);
  const translationDisabled = new Set(translationDisabledAliases);
  normalized.translations = {
    disabledAliases: translationDisabledAliases,
    order: normalizeAliasArray(translations.order).filter(alias => !translationDisabled.has(alias)),
    preferredAlias: normalizeAliasArray([translations.preferredAlias], 1)[0] || ''
  };
  const audio = source.audio && typeof source.audio === 'object' && !Array.isArray(source.audio)
    ? source.audio
    : {};
  normalized.audio = {
    disabledReciters: normalizeAliasArray(audio.disabledReciters),
    preferredReciter: normalizeAliasArray([audio.preferredReciter], 1)[0] || 'juhani'
  };
  const memorization = source.memorization && typeof source.memorization === 'object' && !Array.isArray(source.memorization)
    ? source.memorization
    : {};
  normalized.memorization = {
    schemaVersion: 1,
    reviewLimit: normalizeReviewLimit(memorization.reviewLimit),
    learningLimit: normalizeReviewCategoryLimit(memorization.learningLimit, 3, 50),
    relearningLimit: normalizeReviewCategoryLimit(memorization.relearningLimit, 4, 50),
    weakLimit: normalizeReviewCategoryLimit(memorization.weakLimit, 3, 50),
    memorizedLimit: normalizeReviewCategoryLimit(memorization.memorizedLimit, 10, 200),
    reviewTimeBudgetMinutes: normalizeReviewTimeBudget(memorization.reviewTimeBudgetMinutes),
    reviewOrder: normalizeReviewOrder(memorization.reviewOrder),
    fsrs: QuranFsrs.normalizeSettings(memorization.fsrs)
  };
  const profile = source.profile && typeof source.profile === 'object' && !Array.isArray(source.profile)
    ? source.profile
    : {};
  const preferredLanguage = Utils.trimToEmpty(profile.preferredLanguage || profile.language || '').toLowerCase();
  normalized.profile = {
    ...profile,
    preferredLanguage: PaymentConfig.supportedLanguage(preferredLanguage)
      ? preferredLanguage
      : PaymentConfig.defaultLanguage()
  };
  return normalized;
}

function defaultMemorizationSettings() {
  return normalizeSettings({}).memorization;
}

async function initializeMemorizationSettings(options) {
  const dryRun = Boolean(options && options.dryRun);
  const rows = await global.query(`SELECT COUNT(*) AS count FROM ${TABLE}`) || [];
  const users = Math.max(0, Number(rows[0] && rows[0].count) || 0);
  if (dryRun) return { users, updated: 0 };
  const defaultsSql = MySQL.escape(JSON.stringify(defaultMemorizationSettings()));
  const result = await global.query(`
    UPDATE ${TABLE}
    SET settings_json=JSON_SET(
      COALESCE(settings_json, JSON_OBJECT()),
      '$.memorization',
      CAST(${defaultsSql} AS JSON)
    )
  `);
  return { users, updated: Math.max(0, Number(result && result.affectedRows) || 0) };
}

async function getSettings(userUid) {
  const uid = Utils.escSQL(userUid);
  const rows = await global.query(`
    SELECT settings_json
    FROM ${TABLE}
    WHERE user_uid='${uid}'
    LIMIT 1
  `);
  if (!rows || !rows.length) return normalizeSettings({});
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
  defaultMemorizationSettings,
  getLoginUser,
  getSettings,
  initializeMemorizationSettings,
  isAdminUser,
  normalizeSettings,
  saveSettings
};
