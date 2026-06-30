/* jslint node:true, esversion:9 */
'use strict';

const MySQL = require('mysql');
const debug = require('./Debug')('hadithdb:PaymentConfig');
const Utils = require('./Utils');

const DEFAULT_CURRENCY = 'usd';
const DEFAULT_ADMIN_TEST_AMOUNT = 50;
const DEFAULT_POINT_PACKAGES = Object.freeze([
  Object.freeze({ id: 'starter', label: 'Starter', points: 1000, amount: 1000 }),
  Object.freeze({ id: 'standard', label: 'Standard', points: 5000, amount: 4500 }),
  Object.freeze({ id: 'bulk', label: 'Bulk', points: 12000, amount: 9600 })
]);

const LANGUAGE_TABLE = 'languages';
const RTL_LANGUAGE_CODES = new Set(['ar', 'fa', 'he', 'ur']);

const DEFAULT_LANGUAGES = Object.freeze([
  Object.freeze({ code: 'ar', label: 'Arabic', dir: 'rtl', script: 'Arabic', fontClass: 'content-language-arabic' }),
  Object.freeze({ code: 'bn', label: 'Bengali', dir: 'ltr', script: 'Bengali', fontClass: 'content-language-bengali' }),
  Object.freeze({ code: 'yue', label: 'Chinese (Cantonese)', dir: 'ltr', script: 'Han', fontClass: 'content-language-cjk' }),
  Object.freeze({ code: 'zh', label: 'Chinese (Mandarin)', dir: 'ltr', script: 'Han', fontClass: 'content-language-cjk' }),
  Object.freeze({ code: 'wuu', label: 'Chinese (Wu)', dir: 'ltr', script: 'Han', fontClass: 'content-language-cjk' }),
  Object.freeze({ code: 'en', label: 'English', dir: 'ltr', script: 'Latin', fontClass: 'content-language-latin' }),
  Object.freeze({ code: 'fr', label: 'French', dir: 'ltr', script: 'Latin', fontClass: 'content-language-latin' }),
  Object.freeze({ code: 'de', label: 'German', dir: 'ltr', script: 'Latin', fontClass: 'content-language-latin' }),
  Object.freeze({ code: 'gu', label: 'Gujarati', dir: 'ltr', script: 'Gujarati', fontClass: 'content-language-gujarati' }),
  Object.freeze({ code: 'ha', label: 'Hausa', dir: 'ltr', script: 'Latin', fontClass: 'content-language-latin' }),
  Object.freeze({ code: 'he', label: 'Hebrew', dir: 'rtl', script: 'Hebrew', fontClass: 'content-language-hebrew' }),
  Object.freeze({ code: 'hi', label: 'Hindi', dir: 'ltr', script: 'Devanagari', fontClass: 'content-language-devanagari' }),
  Object.freeze({ code: 'id', label: 'Indonesian', dir: 'ltr', script: 'Latin', fontClass: 'content-language-latin' }),
  Object.freeze({ code: 'it', label: 'Italian', dir: 'ltr', script: 'Latin', fontClass: 'content-language-latin' }),
  Object.freeze({ code: 'ja', label: 'Japanese', dir: 'ltr', script: 'Japanese', fontClass: 'content-language-japanese' }),
  Object.freeze({ code: 'kn', label: 'Kannada', dir: 'ltr', script: 'Kannada', fontClass: 'content-language-kannada' }),
  Object.freeze({ code: 'ko', label: 'Korean', dir: 'ltr', script: 'Hangul', fontClass: 'content-language-korean' }),
  Object.freeze({ code: 'ml', label: 'Malayalam', dir: 'ltr', script: 'Malayalam', fontClass: 'content-language-malayalam' }),
  Object.freeze({ code: 'mr', label: 'Marathi', dir: 'ltr', script: 'Devanagari', fontClass: 'content-language-devanagari' }),
  Object.freeze({ code: 'pcm', label: 'Nigerian Pidgin', dir: 'ltr', script: 'Latin', fontClass: 'content-language-latin' }),
  Object.freeze({ code: 'fa', label: 'Persian', dir: 'rtl', script: 'Arabic', fontClass: 'content-language-persian' }),
  Object.freeze({ code: 'pt', label: 'Portuguese', dir: 'ltr', script: 'Latin', fontClass: 'content-language-latin' }),
  Object.freeze({ code: 'pa', label: 'Punjabi', dir: 'ltr', script: 'Gurmukhi', fontClass: 'content-language-gurmukhi' }),
  Object.freeze({ code: 'ru', label: 'Russian', dir: 'ltr', script: 'Cyrillic', fontClass: 'content-language-cyrillic' }),
  Object.freeze({ code: 'es', label: 'Spanish', dir: 'ltr', script: 'Latin', fontClass: 'content-language-latin' }),
  Object.freeze({ code: 'ta', label: 'Tamil', dir: 'ltr', script: 'Tamil', fontClass: 'content-language-tamil' }),
  Object.freeze({ code: 'te', label: 'Telugu', dir: 'ltr', script: 'Telugu', fontClass: 'content-language-telugu' }),
  Object.freeze({ code: 'th', label: 'Thai', dir: 'ltr', script: 'Thai', fontClass: 'content-language-thai' }),
  Object.freeze({ code: 'tr', label: 'Turkish', dir: 'ltr', script: 'Latin', fontClass: 'content-language-latin' }),
  Object.freeze({ code: 'ur', label: 'Urdu', dir: 'rtl', script: 'Arabic', fontClass: 'content-language-urdu' }),
  Object.freeze({ code: 'vi', label: 'Vietnamese', dir: 'ltr', script: 'Latin', fontClass: 'content-language-latin' })
]);

let languageEnsurePromise = null;
let languageLoadPromise = null;
let languageCache = null;
let languageMap = new Map();

function settings() {
  const root = global.settings || {};
  return root.payments && typeof root.payments === 'object' ? root.payments : {};
}

function contentSettings() {
  const payments = settings();
  return payments.content && typeof payments.content === 'object' ? payments.content : {};
}

function stripeSettings() {
  const payments = settings();
  return payments.stripe && typeof payments.stripe === 'object' ? payments.stripe : {};
}

function rawStripeSecretKey() {
  const stripe = stripeSettings();
  return Utils.trimToEmpty(stripe.secretKey || stripe.secret_key || settings().stripeSecretKey || '');
}

function rawStripePublishableKey() {
  const stripe = stripeSettings();
  return Utils.trimToEmpty(stripe.publishableKey || stripe.publishable_key || settings().stripePublishableKey || '');
}

function stripeWebhookSecret() {
  const stripe = stripeSettings();
  return Utils.trimToEmpty(stripe.webhookSecret || stripe.webhook_secret || settings().stripeWebhookSecret || '');
}

function booleanSetting(value) {
  if (value === true)
    return true;
  if (value === false || value === undefined || value === null)
    return false;
  if (typeof value === 'number')
    return value === 1;
  value = Utils.trimToEmpty(value).toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(value);
}

function isFeatureEnabled() {
  return booleanSetting(settings().enabled);
}

function configuredStripeMode() {
  const stripe = stripeSettings();
  const mode = Utils.trimToEmpty(stripe.mode || settings().stripeMode || settings().mode || '').toLowerCase();
  if (['live', 'production', 'prod'].includes(mode))
    return 'live';
  if (['test', 'sandbox', 'development', 'dev'].includes(mode))
    return 'test';
  return '';
}

function liveModeOnly() {
  const stripe = stripeSettings();
  const configured = stripe.liveModeOnly !== undefined ? stripe.liveModeOnly : settings().liveModeOnly;
  return configuredStripeMode() === 'live' || booleanSetting(configured);
}

function stripeMode() {
  if (liveModeOnly())
    return 'live';
  return configuredStripeMode();
}

function stripeKeyMode(key) {
  key = Utils.trimToEmpty(key);
  if (/^(?:sk|pk|rk)_live_/.test(key))
    return 'live';
  if (/^(?:sk|pk|rk)_test_/.test(key))
    return 'test';
  return key ? 'unknown' : '';
}

function stripeKeyAllowed(key) {
  const keyMode = stripeKeyMode(key);
  if (!keyMode || keyMode === 'unknown')
    return false;
  const mode = stripeMode();
  if (mode)
    return keyMode === mode;
  return true;
}

function stripeSecretKey() {
  const key = rawStripeSecretKey();
  return stripeKeyAllowed(key) ? key : '';
}

function stripePublishableKey() {
  const key = rawStripePublishableKey();
  return stripeKeyAllowed(key) ? key : '';
}

function isConfigured() {
  return Boolean(stripeSecretKey());
}

function isEnabled() {
  return isFeatureEnabled() && isConfigured();
}

function enabledSetting(value, defaultValue) {
  if (value === undefined || value === null)
    return defaultValue;
  return booleanSetting(value);
}

function tafsirTranslationsEnabled() {
  const content = contentSettings();
  const configured = content.tafsirTranslationsEnabled !== undefined
    ? content.tafsirTranslationsEnabled
    : content.tafsirTranslationEnabled;
  return enabledSetting(configured, true);
}

function contentTranslationEnabledForItemType(itemType) {
  itemType = Utils.trimToEmpty(itemType).toLowerCase();
  if (itemType === 'tafsir')
    return tafsirTranslationsEnabled();
  return true;
}

function currency() {
  return Utils.trimToEmpty(settings().currency || DEFAULT_CURRENCY).toLowerCase();
}

function stripeMinimumChargeAmount(currencyCode) {
  currencyCode = Utils.trimToEmpty(currencyCode || currency()).toLowerCase();
  if (currencyCode === 'usd')
    return 50;
  return 50;
}

function normalizePackage(row) {
  if (!row || typeof row !== 'object')
    return null;
  const id = Utils.trimToEmpty(row.id || row.packageId || '').replace(/[^A-Za-z0-9_-]+/g, '-');
  const points = Math.floor(Number(row.points));
  const amount = Math.floor(Number(row.amount || row.unitAmount || row.unit_amount));
  if (!id || !Number.isInteger(points) || points <= 0 || !Number.isInteger(amount) || amount < 50)
    return null;
  return {
    id,
    label: Utils.trimToEmpty(row.label || row.name || `${points.toLocaleString()} points`),
    points,
    amount,
    currency: Utils.trimToEmpty(row.currency || currency()).toLowerCase()
  };
}

function pointPackages() {
  const configured = settings().packages || settings().pointPackages || settings().pointsPackages;
  const source = Array.isArray(configured) && configured.length ? configured : DEFAULT_POINT_PACKAGES;
  const rows = source.map(normalizePackage).filter(Boolean);
  return rows.length ? rows : DEFAULT_POINT_PACKAGES.map(normalizePackage).filter(Boolean);
}

function pointPackage(id) {
  id = Utils.trimToEmpty(id);
  return pointPackages().find(pkg => pkg.id === id) || null;
}

function defaultPointPackage() {
  const preferred = Utils.trimToEmpty(settings().defaultPackageId || settings().default_package_id || '');
  return pointPackage(preferred) || pointPackages()[0] || null;
}

function adminTestAmount(pkg) {
  const admin = settings().admin && typeof settings().admin === 'object' ? settings().admin : {};
  const configured = settings().adminTestAmount !== undefined
    ? settings().adminTestAmount
    : (settings().admin_test_amount !== undefined
      ? settings().admin_test_amount
      : (admin.testAmount !== undefined ? admin.testAmount : admin.test_amount));
  const amount = Math.floor(Number(configured !== undefined ? configured : DEFAULT_ADMIN_TEST_AMOUNT));
  const minimum = stripeMinimumChargeAmount(pkg && pkg.currency || currency());
  if (!Number.isInteger(amount) || amount <= 0)
    return minimum;
  return Math.max(amount, minimum);
}

function sql(value) {
  return MySQL.escape(value);
}

function languageFromRow(row) {
  if (!row)
    return null;
  if (typeof row === 'string') {
    const code = row.toLowerCase();
    return normalizeLanguage({
      code,
      label: code.toUpperCase(),
      dir: RTL_LANGUAGE_CODES.has(code) ? 'rtl' : 'ltr'
    });
  }
  return normalizeLanguage(row);
}

function normalizeLanguage(row) {
  const code = Utils.trimToEmpty(row && (row.code || row.id || row.lang || '')).toLowerCase();
  if (!/^[a-z]{2,3}$/.test(code))
    return null;
  const label = Utils.trimToEmpty(row.label || row.name || code.toUpperCase());
  const dir = Utils.trimToEmpty(row.dir || '').toLowerCase() === 'rtl' || RTL_LANGUAGE_CODES.has(code) ? 'rtl' : 'ltr';
  const script = Utils.trimToEmpty(row.script || row.writingScript || row.writing_script || '');
  const fontClass = Utils.trimToEmpty(row.fontClass || row.font_class || '').replace(/[^A-Za-z0-9_-]+/g, '-');
  return {
    code,
    label,
    dir,
    script,
    fontClass: fontClass || 'content-language-latin'
  };
}

function languageCompare(a, b) {
  const aLabel = Utils.trimToEmpty(a && a.label || a && a.code || '');
  const bLabel = Utils.trimToEmpty(b && b.label || b && b.code || '');
  const labelCompare = aLabel.localeCompare(bLabel, undefined, { sensitivity: 'base' });
  if (labelCompare !== 0)
    return labelCompare;
  return Utils.trimToEmpty(a && a.code || '').localeCompare(Utils.trimToEmpty(b && b.code || ''));
}

function setLanguageCache(rows) {
  const allowed = new Set(DEFAULT_LANGUAGES.map(language => language.code));
  const deduped = new Map();
  (Array.isArray(rows) ? rows : DEFAULT_LANGUAGES).map(languageFromRow).filter(Boolean).forEach(language => {
    if (allowed.has(language.code))
      deduped.set(language.code, Object.freeze(language));
  });
  if (!deduped.has('en'))
    deduped.set('en', Object.freeze(languageFromRow(DEFAULT_LANGUAGES.find(language => language.code === 'en'))));
  languageCache = Object.freeze(Array.from(deduped.values()).sort(languageCompare));
  languageMap = new Map(languageCache.map(language => [language.code, language]));
  return languageCache;
}

async function ensureLanguageColumn(columnName, definition) {
  const rows = await global.query(`SHOW COLUMNS FROM ${LANGUAGE_TABLE} LIKE ${sql(columnName)}`);
  if (rows && rows.length)
    return;
  await global.query(`ALTER TABLE ${LANGUAGE_TABLE} ADD COLUMN ${definition}`);
}

async function ensureLanguageTable() {
  if (languageEnsurePromise)
    return languageEnsurePromise;
  languageEnsurePromise = (async function () {
    await global.query(`
      CREATE TABLE IF NOT EXISTS ${LANGUAGE_TABLE} (
        code varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
        label varchar(96) COLLATE utf8mb4_unicode_ci NOT NULL,
        dir varchar(3) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'ltr',
        script varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
        font_class varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'content-language-latin',
        sort_order int NOT NULL DEFAULT 0,
        enabled tinyint(1) NOT NULL DEFAULT 1,
        createdAt datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (code),
        KEY ndx_languages_enabled_label (enabled, label)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await ensureLanguageColumn('label', "label varchar(96) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' AFTER code");
    await ensureLanguageColumn('dir', "dir varchar(3) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'ltr' AFTER label");
    await ensureLanguageColumn('script', "script varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' AFTER dir");
    await ensureLanguageColumn('font_class', "font_class varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'content-language-latin' AFTER script");
    await ensureLanguageColumn('sort_order', 'sort_order int NOT NULL DEFAULT 0 AFTER font_class');
    await ensureLanguageColumn('enabled', 'enabled tinyint(1) NOT NULL DEFAULT 1 AFTER sort_order');
    await ensureLanguageColumn('createdAt', 'createdAt datetime NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER enabled');
    await ensureLanguageColumn('updatedAt', 'updatedAt datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER createdAt');
    const values = DEFAULT_LANGUAGES.map((language, index) => `(
        ${sql(language.code)},
        ${sql(language.label)},
        ${sql(language.dir)},
        ${sql(language.script)},
        ${sql(language.fontClass)},
        ${index},
        1
      )`).join(',');
    await global.query(`
      INSERT INTO ${LANGUAGE_TABLE} (code, label, dir, script, font_class, sort_order, enabled)
      VALUES ${values}
      ON DUPLICATE KEY UPDATE
        label=VALUES(label),
        dir=VALUES(dir),
        script=VALUES(script),
        font_class=VALUES(font_class),
        sort_order=VALUES(sort_order),
        enabled=1,
        updatedAt=CURRENT_TIMESTAMP
    `);
    await global.query(`
      UPDATE ${LANGUAGE_TABLE}
      SET enabled=0
      WHERE code NOT IN (${DEFAULT_LANGUAGES.map(language => sql(language.code)).join(',')})
    `);
  })().catch(err => {
    languageEnsurePromise = null;
    throw err;
  });
  return languageEnsurePromise;
}

async function loadLanguages(options) {
  options = options || {};
  if (languageLoadPromise && options.force !== true)
    return languageLoadPromise;
  languageLoadPromise = (async function () {
    await ensureLanguageTable();
    const rows = await global.query(`
      SELECT code, label, dir, script, font_class AS fontClass
      FROM ${LANGUAGE_TABLE}
      WHERE enabled=1
      ORDER BY label ASC, code ASC
    `);
    return setLanguageCache(rows);
  })().catch(err => {
    languageLoadPromise = null;
    debug.error(`load languages failed: ${err.message}\n${err.stack || ''}`);
    return supportedLanguages();
  });
  return languageLoadPromise;
}

function supportedLanguages() {
  if (!languageCache)
    setLanguageCache(DEFAULT_LANGUAGES);
  return languageCache.slice();
}

function supportedLanguage(code) {
  code = Utils.trimToEmpty(code).toLowerCase();
  if (!languageCache)
    setLanguageCache(DEFAULT_LANGUAGES);
  return languageMap.get(code) || null;
}

function languageMetadata(code) {
  return supportedLanguage(code);
}

function defaultLanguage() {
  const preferred = Utils.trimToEmpty(settings().defaultLanguage || contentSettings().defaultLanguage || 'en').toLowerCase();
  return supportedLanguage(preferred) ? preferred : 'en';
}

function pointsPer1000Words(mode) {
  const content = contentSettings();
  const key = mode === 'fix' ? 'fixPointsPer1000Words' : 'translatePointsPer1000Words';
  const legacyKey = mode === 'fix' ? 'fixPointsPer1000Chars' : 'translatePointsPer1000Chars';
  const configured = content[key] !== undefined
    ? content[key]
    : (content.pointsPer1000Words !== undefined
      ? content.pointsPer1000Words
      : (content[legacyKey] !== undefined ? content[legacyKey] : content.pointsPer1000Chars));
  const value = Number(configured !== undefined ? configured : 25);
  return Number.isFinite(value) && value > 0 ? value : 25;
}

function minimumPoints(mode) {
  const content = contentSettings();
  const key = mode === 'fix' ? 'fixMinimumPoints' : 'translateMinimumPoints';
  const configured = content[key] !== undefined ? content[key] : content.minimumPoints;
  const value = Number(configured !== undefined ? configured : 5);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 5;
}

function initialGrantPoints() {
  const value = Number(settings().initialGrantPoints || 0);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function autoRechargeDefaults() {
  const auto = settings().autoRecharge && typeof settings().autoRecharge === 'object' ? settings().autoRecharge : {};
  const threshold = Number(auto.thresholdPoints !== undefined ? auto.thresholdPoints : 100);
  const pkg = pointPackage(auto.packageId) || defaultPointPackage();
  return {
    enabled: auto.enabled !== false,
    thresholdPoints: Number.isFinite(threshold) && threshold >= 0 ? Math.floor(threshold) : 100,
    packageId: pkg ? pkg.id : ''
  };
}

function paymentRedirectUrl(req, path, useQuranBase) {
  path = Utils.trimToEmpty(path);
  if (/^https?:\/\//i.test(path))
    return path;
  if (path.charAt(0) !== '/')
    path = `/${path}`;
  const baseUrl = Utils.trimToEmpty(useQuranBase ? Utils.quranBaseUrl(req) : Utils.hadithBaseUrl(req))
    || Utils.trimToEmpty(Utils.requestOrigin(req));
  if (!baseUrl)
    return path;
  return `${baseUrl.replace(/\/+$/, '')}${path}`;
}

function checkoutSuccessUrl(req) {
  const configured = Utils.trimToEmpty(settings().successUrl || settings().checkoutSuccessUrl || '');
  const useQuranBase = Boolean(req.baseUrl && req.baseUrl.indexOf('/quran') === 0);
  if (configured)
    return paymentRedirectUrl(req, configured, useQuranBase);
  const path = useQuranBase ? '/quran/settings' : '/settings';
  const separator = path.includes('?') ? '&' : '?';
  const target = `${path}${separator}payment=success&session_id={CHECKOUT_SESSION_ID}`;
  return paymentRedirectUrl(req, target, useQuranBase);
}

function checkoutCancelUrl(req) {
  const configured = Utils.trimToEmpty(settings().cancelUrl || settings().checkoutCancelUrl || '');
  const useQuranBase = Boolean(req.baseUrl && req.baseUrl.indexOf('/quran') === 0);
  if (configured)
    return paymentRedirectUrl(req, configured, useQuranBase);
  const path = useQuranBase ? '/quran/settings?payment=cancelled' : '/settings?payment=cancelled';
  return paymentRedirectUrl(req, path, useQuranBase);
}

function checkoutReturnUrl(req, returnPath, status) {
  returnPath = Utils.trimToEmpty(returnPath);
  if (!returnPath || returnPath.charAt(0) !== '/' || returnPath.startsWith('//') || /[\r\n]/.test(returnPath) || /^\/\\/.test(returnPath))
    return '';
  let parsed;
  try {
    parsed = new URL(returnPath, 'https://hadithdb.local');
  } catch (_err) {
    return '';
  }
  const params = parsed.searchParams;
  params.set('translation_payment', status === 'success' ? 'success' : 'cancelled');
  if (status === 'success')
    params.set('session_id', '{CHECKOUT_SESSION_ID}');
  parsed.search = params.toString().replace(/%7BCHECKOUT_SESSION_ID%7D/gi, '{CHECKOUT_SESSION_ID}');
  const target = `${parsed.pathname}${parsed.search || ''}${parsed.hash || ''}`;
  const useQuranBase = Boolean(req.baseUrl && req.baseUrl.indexOf('/quran') === 0) || target.indexOf('/quran') === 0;
  return paymentRedirectUrl(req, target, useQuranBase);
}

setLanguageCache(DEFAULT_LANGUAGES);

module.exports = {
  adminTestAmount,
  autoRechargeDefaults,
  checkoutCancelUrl,
  checkoutReturnUrl,
  checkoutSuccessUrl,
  currency,
  defaultLanguage,
  defaultPointPackage,
  initialGrantPoints,
  isConfigured,
  isEnabled,
  isFeatureEnabled,
  ensureLanguageTable,
  languageMetadata,
  loadLanguages,
  minimumPoints,
  pointPackage,
  pointPackages,
  pointsPer1000Words,
  liveModeOnly,
  stripePublishableKey,
  stripeSecretKey,
  stripeKeyMode,
  stripeMode,
  stripeWebhookSecret,
  supportedLanguage,
  supportedLanguages,
  tafsirTranslationsEnabled,
  contentTranslationEnabledForItemType
};
