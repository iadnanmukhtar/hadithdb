/* jslint node:true, esversion:9 */
'use strict';

const Utils = require('./Utils');

const DEFAULT_CURRENCY = 'usd';
const DEFAULT_ADMIN_TEST_AMOUNT = 50;
const DEFAULT_POINT_PACKAGES = Object.freeze([
  Object.freeze({ id: 'starter', label: 'Starter', points: 1000, amount: 1000 }),
  Object.freeze({ id: 'standard', label: 'Standard', points: 5000, amount: 4500 }),
  Object.freeze({ id: 'bulk', label: 'Bulk', points: 12000, amount: 9600 })
]);

const RTL_LANGUAGE_CODES = new Set(['fa', 'he', 'ps', 'sd', 'ur', 'yi']);

// Broad default coverage for high-speaker languages and major writing systems.
// Arabic is intentionally omitted as a translation target.
const DEFAULT_LANGUAGES = Object.freeze([
  Object.freeze({ code: 'en', label: 'English', dir: 'ltr' }),
  Object.freeze({ code: 'zh-hans', label: 'Chinese (Simplified)', dir: 'ltr' }),
  Object.freeze({ code: 'zh-hant', label: 'Chinese (Traditional)', dir: 'ltr' }),
  Object.freeze({ code: 'hi', label: 'Hindi', dir: 'ltr' }),
  Object.freeze({ code: 'es', label: 'Spanish', dir: 'ltr' }),
  Object.freeze({ code: 'fr', label: 'French', dir: 'ltr' }),
  Object.freeze({ code: 'bn', label: 'Bengali', dir: 'ltr' }),
  Object.freeze({ code: 'pt', label: 'Portuguese', dir: 'ltr' }),
  Object.freeze({ code: 'ru', label: 'Russian', dir: 'ltr' }),
  Object.freeze({ code: 'ur', label: 'Urdu', dir: 'rtl' }),
  Object.freeze({ code: 'id', label: 'Indonesian', dir: 'ltr' }),
  Object.freeze({ code: 'de', label: 'German', dir: 'ltr' }),
  Object.freeze({ code: 'ja', label: 'Japanese', dir: 'ltr' }),
  Object.freeze({ code: 'mr', label: 'Marathi', dir: 'ltr' }),
  Object.freeze({ code: 'te', label: 'Telugu', dir: 'ltr' }),
  Object.freeze({ code: 'tr', label: 'Turkish', dir: 'ltr' }),
  Object.freeze({ code: 'ta', label: 'Tamil', dir: 'ltr' }),
  Object.freeze({ code: 'vi', label: 'Vietnamese', dir: 'ltr' }),
  Object.freeze({ code: 'tl', label: 'Filipino / Tagalog', dir: 'ltr' }),
  Object.freeze({ code: 'ko', label: 'Korean', dir: 'ltr' }),
  Object.freeze({ code: 'fa', label: 'Persian', dir: 'rtl' }),
  Object.freeze({ code: 'ha', label: 'Hausa', dir: 'ltr' }),
  Object.freeze({ code: 'sw', label: 'Swahili', dir: 'ltr' }),
  Object.freeze({ code: 'jv', label: 'Javanese', dir: 'ltr' }),
  Object.freeze({ code: 'it', label: 'Italian', dir: 'ltr' }),
  Object.freeze({ code: 'pa', label: 'Punjabi (Gurmukhi)', dir: 'ltr' }),
  Object.freeze({ code: 'pa-arab', label: 'Punjabi (Shahmukhi)', dir: 'rtl' }),
  Object.freeze({ code: 'gu', label: 'Gujarati', dir: 'ltr' }),
  Object.freeze({ code: 'th', label: 'Thai', dir: 'ltr' }),
  Object.freeze({ code: 'am', label: 'Amharic', dir: 'ltr' }),
  Object.freeze({ code: 'kn', label: 'Kannada', dir: 'ltr' }),
  Object.freeze({ code: 'ml', label: 'Malayalam', dir: 'ltr' }),
  Object.freeze({ code: 'my', label: 'Burmese', dir: 'ltr' }),
  Object.freeze({ code: 'or', label: 'Odia', dir: 'ltr' }),
  Object.freeze({ code: 'si', label: 'Sinhala', dir: 'ltr' }),
  Object.freeze({ code: 'he', label: 'Hebrew', dir: 'rtl' }),
  Object.freeze({ code: 'el', label: 'Greek', dir: 'ltr' }),
  Object.freeze({ code: 'uk', label: 'Ukrainian', dir: 'ltr' }),
  Object.freeze({ code: 'pl', label: 'Polish', dir: 'ltr' }),
  Object.freeze({ code: 'ro', label: 'Romanian', dir: 'ltr' }),
  Object.freeze({ code: 'nl', label: 'Dutch', dir: 'ltr' }),
  Object.freeze({ code: 'ms', label: 'Malay', dir: 'ltr' }),
  Object.freeze({ code: 'yo', label: 'Yoruba', dir: 'ltr' }),
  Object.freeze({ code: 'ig', label: 'Igbo', dir: 'ltr' }),
  Object.freeze({ code: 'ps', label: 'Pashto', dir: 'rtl' }),
  Object.freeze({ code: 'ne', label: 'Nepali', dir: 'ltr' }),
  Object.freeze({ code: 'km', label: 'Khmer', dir: 'ltr' })
]);

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

function languageFromRow(row) {
  if (!row)
    return null;
  if (typeof row === 'string') {
    const code = row.toLowerCase();
    return normalizeLanguage({
      code,
      label: code.toUpperCase(),
      dir: RTL_LANGUAGE_CODES.has(code) || code.endsWith('-arab') ? 'rtl' : 'ltr'
    });
  }
  return normalizeLanguage(row);
}

function normalizeLanguage(row) {
  const code = Utils.trimToEmpty(row && (row.code || row.id || row.lang || '')).toLowerCase();
  if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/.test(code))
    return null;
  const label = Utils.trimToEmpty(row.label || row.name || code.toUpperCase());
  const dir = Utils.trimToEmpty(row.dir || '').toLowerCase() === 'rtl' ? 'rtl' : 'ltr';
  return { code, label, dir };
}

function supportedLanguages() {
  const configured = settings().languages || settings().supportedLanguages || (contentSettings().languages);
  const source = Array.isArray(configured) && configured.length ? configured : DEFAULT_LANGUAGES;
  const deduped = new Map();
  source.map(languageFromRow).filter(Boolean).forEach(language => {
    if (language.code === 'ar')
      return;
    deduped.set(language.code, language);
  });
  if (!deduped.has('en'))
    deduped.set('en', { code: 'en', label: 'English', dir: 'ltr' });
  return Array.from(deduped.values());
}

function supportedLanguage(code) {
  code = Utils.trimToEmpty(code).toLowerCase();
  return supportedLanguages().find(language => language.code === code) || null;
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
  supportedLanguages
};
