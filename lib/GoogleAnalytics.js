/* jslint node:true, esversion:9 */
'use strict';

const TAG_ID_PATTERN = /^G-[A-Z0-9]+$/;

function validTagId(value) {
  value = (value || '').toString().trim().toUpperCase();
  return TAG_ID_PATTERN.test(value) ? value : '';
}

function configuredTagId(environmentName, settingsName) {
  const googleSettings = global.settings && global.settings.google
    ? global.settings.google
    : {};
  return validTagId(process.env[environmentName]) || validTagId(googleSettings[settingsName]);
}

function siteTagId() {
  return configuredTagId('GOOGLE_ANALYTICS_TAG_ID', 'analyticsTagId');
}

function hostnameFromUrl(value) {
  value = (value || '').toString().trim();
  if (!value)
    return '';
  try {
    return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).hostname.toLowerCase();
  } catch (err) {
    return '';
  }
}

function configuredQuranHostnames() {
  const siteSettings = global.settings && global.settings.site
    ? global.settings.site
    : {};
  return new Set([
    'quran.islamunlocked.com',
    hostnameFromUrl(siteSettings.quranUrl),
    hostnameFromUrl(siteSettings.quranUrlLocal)
  ].filter(Boolean));
}

function isQuranRequest(req) {
  const hostname = (req && req.hostname ? req.hostname : '').toString().toLowerCase();
  const requestPath = (req && (req.path || req.originalUrl || req.url) || '')
    .toString()
    .split(/[?#]/)[0];
  return !!(req && req.quranArea === true)
    || hostname.split('.')[0] === 'quran'
    || configuredQuranHostnames().has(hostname)
    || requestPath.indexOf('/quran') === 0
    || requestPath.indexOf('quran') === 0;
}

function googleAnalyticsTagId(req) {
  if (!isQuranRequest(req))
    return siteTagId();
  return configuredTagId('QURAN_GOOGLE_ANALYTICS_TAG_ID', 'quranAnalyticsTagId') || siteTagId();
}

function injectTagId(html, req) {
  const tagId = googleAnalyticsTagId(req);
  return (html || '').toString()
    .replace(/(googletagmanager\.com\/gtag\/js\?id=)G-[A-Z0-9]+/g, `$1${tagId}`)
    .replace(/(gtag\(\s*['"]config['"]\s*,\s*['"])G-[A-Z0-9]+(['"]\s*\))/g, `$1${tagId}$2`);
}

module.exports = {
  googleAnalyticsTagId,
  injectTagId,
  isQuranRequest,
  validTagId
};
