/* jslint node:true, esversion:9 */
'use strict';

const debug = require('debug')('hadithdb:login');
const express = require('express');
const GoogleAuth = require('../lib/GoogleAuth');
const LocalAuth = require('../lib/LocalAuth');
const UserSettings = require('../lib/UserSettings');
const Utils = require('../lib/Utils');

const router = express.Router();
const SESSION_MAX_AGE_MS = LocalAuth.SESSION_MAX_AGE_MS;
const LOGIN_CACHE_KEY = 'hadithdb_login_session';

const originFromUrl = (url) => {
  if (!url)
    return null;
  try {
    return new URL(url).origin;
  } catch (err) {
    return null;
  }
};

function sharedCookieDomain(req) {
  try {
    const siteHost = new URL(global.settings.site.url).hostname.toLowerCase();
    const reqHost = (req.hostname || '').toLowerCase();
    if (!siteHost || siteHost === 'localhost' || !siteHost.includes('.'))
      return null;
    if (reqHost === siteHost || reqHost.endsWith(`.${siteHost}`))
      return `.${siteHost}`;
  } catch (err) {
    return null;
  }
  return null;
}

function clearAuthCookie(res, req, name) {
  res.clearCookie(name, { path: '/' });
  const domain = sharedCookieDomain(req);
  if (domain)
    res.clearCookie(name, { path: '/', domain });
}

function csrfError(req) {
  const bodyToken = req.body && req.body.g_csrf_token;
  const cookieToken = req.cookies && req.cookies.g_csrf_token;
  if (!bodyToken)
    return 'g_csrf_token not found in request body';
  if (!cookieToken)
    return 'g_csrf_token not found in cookie';
  if (bodyToken !== cookieToken)
    return 'CSRF token mismatch';
  return null;
}

const loginCacheBridgeHtml = (req) => {
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
<head><meta charset="utf-8"><title>Login Cache Bridge</title></head>
<body>
<script>
(function () {
  'use strict';
  var ALLOWED_ORIGINS = ${JSON.stringify(allowedOrigins)};
  var LOGIN_CACHE_KEY = ${JSON.stringify(LOGIN_CACHE_KEY)};
  var normalizeUser = function (user) {
    if (!user || typeof user !== 'object') return null;
    var uid = (user.uid || user.userId || user.email || '').toString();
    if (!uid) return null;
    return {
      uid: uid,
      provider: user.provider || 'google.com',
      name: user.name || user.displayName || user.email || 'User',
      email: user.email || null,
      photo: user.photo || user.photoURL || null,
      admin: Boolean(user.admin)
    };
  };
  var normalizeSession = function (session) {
    var user = normalizeUser(session && (session.user || session));
    if (!session || !session.loggedIn || !user) return null;
    if (isSessionExpired(session)) return null;
    return {
      __hadithdbLoginSessionCache: 1,
      cachedAt: Number.isFinite(session.cachedAt) ? session.cachedAt : Date.now(),
      loggedIn: true,
      token: session.token || null,
      user: user
    };
  };
  var decodeTokenPayload = function (token) {
    try {
      var parts = String(token || '').split('.');
      if (parts.length < 2) return null;
      var normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      normalized += '='.repeat((4 - normalized.length % 4) % 4);
      return JSON.parse(decodeURIComponent(atob(normalized).split('').map(function (c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      }).join('')));
    } catch (err) {
      return null;
    }
  };
  var isSessionExpired = function (session) {
    var tokenPayload = decodeTokenPayload(session && session.token);
    if (!session || !session.token || !tokenPayload || !Number.isFinite(tokenPayload.exp)) return true;
    if (tokenPayload.exp * 1000 <= Date.now()) return true;
    var cachedAt = Number(session.cachedAt || 0);
    return !Number.isFinite(cachedAt) || cachedAt <= 0 || Date.now() - cachedAt > ${SESSION_MAX_AGE_MS};
  };
  var readSession = function () {
    try {
      var raw = localStorage.getItem(LOGIN_CACHE_KEY);
      if (!raw) return null;
      var payload = JSON.parse(raw);
      if (!payload || (payload.__hadithdbLoginSessionCache !== 1 && payload.__hadithLoginSessionCache !== 1))
        throw new Error('Unexpected login session cache payload');
      var session = normalizeSession(payload);
      if (!session)
        throw new Error('Missing login session user');
      return {
        status: 200,
        loggedIn: true,
        token: session.token || null,
        userId: session.user.uid,
        admin: Boolean(session.user.admin),
        user: session.user,
        cached: true
      };
    } catch (err) {
      try { localStorage.removeItem(LOGIN_CACHE_KEY); } catch (_err) {}
      return null;
    }
  };
  var writeSession = function (session) {
    var payload = normalizeSession(session);
    if (!payload) return false;
    try {
      localStorage.setItem(LOGIN_CACHE_KEY, JSON.stringify(payload));
      return true;
    } catch (err) {
      return false;
    }
  };
  window.addEventListener('message', function (event) {
    var data = event.data || {};
    if (!data || data.type !== 'hadithdbLoginSessionCacheBridge' || ALLOWED_ORIGINS.indexOf(event.origin) < 0)
      return;
    var response = {
      type: 'hadithdbLoginSessionCacheBridgeResponse',
      requestId: data.requestId || '',
      action: data.action || ''
    };
    if (data.action === 'read') {
      response.session = readSession();
    } else if (data.action === 'write') {
      response.ok = writeSession(data.session);
      response.session = response.ok ? readSession() : null;
    } else if (data.action === 'clear') {
      try { localStorage.removeItem(LOGIN_CACHE_KEY); } catch (_err) {}
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
  res.setHeader('Cache-Control', 'no-store');
  res.type('html').send(loginCacheBridgeHtml(req));
});

async function createLoginResponse(req, res, user) {
  var adminUser = await UserSettings.ensureLoginUser(user);
  const loginUser = {
    uid: user.uid,
    provider: user.provider || 'google.com',
    name: user.name,
    email: user.email,
    photo: user.photo,
    admin: adminUser
  };
  const localToken = LocalAuth.signUser(loginUser);
  clearAuthCookie(res, req, 'admin');
  clearAuthCookie(res, req, 'adminUser');
  clearAuthCookie(res, req, 'adminChecked');
  if (adminUser) {
    debug(`Admin User ${user.email} logged in`);
  } else {
    clearAuthCookie(res, req, 'editMode');
  }
  res.status(200);
  res.end(JSON.stringify({
    status: 200,
    userId: user.uid,
    email: user.email,
    name: user.name,
    provider: user.provider || 'google.com',
    photo: user.photo,
    admin: adminUser,
    token: localToken,
    user: loginUser,
    refresh: true,
    message: 'User logged in'
  }));
}

router.get('/logout', async function (req, res) {
  clearAuthCookie(res, req, 'admin');
  clearAuthCookie(res, req, 'adminUser');
  clearAuthCookie(res, req, 'adminChecked');
  clearAuthCookie(res, req, 'userId');
  clearAuthCookie(res, req, 'editMode');
  res.status(200);
  res.end(JSON.stringify({
    status: 200,
    refresh: true,
    message: 'User logged out'
  }));
});

router.get('/session', async function (req, res) {
  let user = null;
  let admin = false;
  try {
    user = await GoogleAuth.verifyRequest(req);
    if (user)
      admin = user.admin === true || await UserSettings.isAdminUser(user.uid);
  } catch (err) {
    user = null;
    admin = false;
  }
  res.json({
    status: 200,
    loggedIn: Boolean(user),
    userId: user ? user.uid : null,
    admin,
    user: user ? {
      uid: user.uid,
      provider: user.provider,
      name: user.name,
      email: user.email,
      photo: user.photo,
      admin
    } : null
  });
});

router.post('/google', async function (req, res) {
  const csrfMessage = csrfError(req);
  if (csrfMessage) {
    res.status(400).json({ status: 400, message: csrfMessage });
    return;
  }

  const token = req.body && req.body.credential;
  if (!token) {
    res.status(401).json({ status: 401, message: 'Authentication required' });
    return;
  }

  let user;
  try {
    user = await GoogleAuth.verifyToken(token);
  } catch (err) {
    res.status(401).json({ status: 401, message: 'Invalid authentication token' });
    return;
  }

  await createLoginResponse(req, res, user);
});

router.get('/:userId', async function (req, res, next) {

  res.locals.req = req;
  res.locals.res = res;

  const requestedUserId = (req.params.userId || '').trim();
  let user;
  try {
    user = await GoogleAuth.verifyRequest(req);
  } catch (err) {
    res.status(401).json({ status: 401, message: 'Invalid authentication token' });
    return;
  }
  if (!user) {
    res.status(401).json({ status: 401, message: 'Authentication required' });
    return;
  }

  if (!user.email || (user.email.toLowerCase() !== requestedUserId.toLowerCase() && user.uid !== requestedUserId)) {
    res.status(403).json({ status: 403, message: 'Authenticated Google user does not match requested login user' });
    return;
  }

  await createLoginResponse(req, res, user);
  return;

});

module.exports = router;
