/* jslint node:true, esversion:9 */
'use strict';

const express = require('express');
const Utils = require('../lib/Utils');

const router = express.Router();

const originFromUrl = (url) => {
  if (!url)
    return null;
  try {
    return new URL(url).origin;
  } catch (err) {
    return null;
  }
};

const userSettingsCacheBridgeHtml = (req) => {
  const site = global.settings && global.settings.site ? global.settings.site : {};
  const allowedOrigins = Array.from(new Set([
    originFromUrl(Utils.hadithBaseUrl(req)),
    originFromUrl(Utils.quranBaseUrl(req)),
    originFromUrl(site.url),
    originFromUrl(site.quranUrl),
    originFromUrl(site.urlLocal),
    originFromUrl(site.quranUrlLocal),
    Utils.requestOrigin(req)
  ].filter(Boolean)));
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>User Settings Cache Bridge</title></head>
<body>
<script>
(function () {
  'use strict';
  var ALLOWED_ORIGINS = ${JSON.stringify(allowedOrigins)};
  var USER_SETTINGS_CACHE_PREFIX = 'hadithdb_user_settings:';
  var LEGACY_USER_SETTINGS_CACHE_PREFIX = 'hadithUserSettings:';
  var USER_SETTINGS_CACHE_MAX_AGE_MS = 60 * 60 * 1000;
  var settingsCacheStore = function () {
    try {
      return window.sessionStorage || null;
    } catch (err) {
      return null;
    }
  };
  var clearLegacySettingsCache = function (key, legacyKey) {
    try { if (key) localStorage.removeItem(key); } catch (_err) {}
    try { if (legacyKey) localStorage.removeItem(legacyKey); } catch (_err) {}
  };
  var settingsUserId = function (user) {
    if (!user || typeof user !== 'object') return '';
    return (user.uid || user.userId || user.email || user.username || '').toString();
  };
  var settingsCacheKey = function (user) {
    var id = settingsUserId(user);
    return id ? USER_SETTINGS_CACHE_PREFIX + id : '';
  };
  var legacySettingsCacheKey = function (user) {
    var id = settingsUserId(user);
    return id ? LEGACY_USER_SETTINGS_CACHE_PREFIX + id : '';
  };
  var readSettings = function (user) {
    var key = settingsCacheKey(user);
    var legacyKey = legacySettingsCacheKey(user);
    if (!key) return null;
    var store = settingsCacheStore();
    if (!store) return null;
    clearLegacySettingsCache(key, legacyKey);
    try {
      var raw = store.getItem(key);
      if (!raw) return null;
      var payload = JSON.parse(raw);
      if (payload && payload.__hadithdbUserSettingsCache === 1) {
        if (!Number.isFinite(payload.cachedAt) || Date.now() - payload.cachedAt > USER_SETTINGS_CACHE_MAX_AGE_MS) {
          store.removeItem(key);
          return null;
        }
        return payload.settings || {};
      }
      store.removeItem(key);
    } catch (err) {
      try { store.removeItem(key); } catch (_err) {}
    }
    return null;
  };
  var writeSettings = function (user, settings) {
    var key = settingsCacheKey(user);
    if (!key) return false;
    var store = settingsCacheStore();
    if (!store) return false;
    try {
      clearLegacySettingsCache(key, legacySettingsCacheKey(user));
      store.setItem(key, JSON.stringify({
        __hadithdbUserSettingsCache: 1,
        cachedAt: Date.now(),
        settings: settings || {}
      }));
      return true;
    } catch (err) {
      return false;
    }
  };
  window.addEventListener('message', function (event) {
    var data = event.data || {};
    if (!data || data.type !== 'hadithUserSettingsCacheBridge' || ALLOWED_ORIGINS.indexOf(event.origin) < 0)
      return;
    var response = {
      type: 'hadithUserSettingsCacheBridgeResponse',
      requestId: data.requestId || '',
      action: data.action || ''
    };
    if (data.action === 'read') {
      response.settings = readSettings(data.user);
    } else if (data.action === 'write') {
      response.ok = writeSettings(data.user, data.settings);
      response.settings = response.ok ? readSettings(data.user) : null;
    } else if (data.action === 'clear') {
      var key = settingsCacheKey(data.user);
      var legacyKey = legacySettingsCacheKey(data.user);
      var store = settingsCacheStore();
      if (key && store) store.removeItem(key);
      clearLegacySettingsCache(key, legacyKey);
      response.ok = true;
    } else {
      response.ok = false;
    }
    event.source.postMessage(response, event.origin);
  });
})();
</script>
</body>
</html>`;
};

router.get('/cache-bridge', function (req, res) {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.type('html').send(userSettingsCacheBridgeHtml(req));
});

router.get('/', async function (req, res, next) {
  try {
    res.locals.req = req;
    res.locals.res = res;
    const settingsPath = req.baseUrl || '/settings';
    const isQuranSettings = settingsPath === '/quran/settings' || settingsPath.indexOf('/quran/settings/') === 0;
    res.render('settings', {
      results: [],
      page: {
        menu: 'My Settings',
        title_en: `${isQuranSettings ? 'Quran' : global.settings.site.shortName} | My Settings`,
        subtitle_en: 'Account settings',
        subtitle: null,
        canonical: settingsPath,
        alternate: settingsPath,
        feed: null,
        context: isQuranSettings ? { quranSearchProxy: true } : {}
      }
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
