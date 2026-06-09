/* jslint node:true, esversion:9 */
'use strict';

const debug = require('debug')('hadithdb:login');
const express = require('express');
const GoogleAuth = require('../lib/GoogleAuth');
const UserSettings = require('../lib/UserSettings');

const router = express.Router();
const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 90;
const SESSION_COOKIE_OPTIONS = {
  path: '/',
  maxAge: SESSION_MAX_AGE_MS,
  sameSite: 'lax'
};
const AUTH_SESSION_COOKIE = 'hadithSession';
const AUTH_SESSION_COOKIE_OPTIONS = {
  ...SESSION_COOKIE_OPTIONS,
  httpOnly: true
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

function cookieOptions(req, baseOptions) {
  const domain = sharedCookieDomain(req);
  return domain ? { ...baseOptions, domain } : baseOptions;
}

function clearAuthCookie(res, req, name) {
  res.clearCookie(name, { path: '/' });
  const domain = sharedCookieDomain(req);
  if (domain)
    res.clearCookie(name, { path: '/', domain });
}

router.get('/logout', async function (req, res) {
  await UserSettings.clearLoginSession(req.cookies && req.cookies[AUTH_SESSION_COOKIE]);
  clearAuthCookie(res, req, 'admin');
  clearAuthCookie(res, req, 'adminUser');
  clearAuthCookie(res, req, 'adminChecked');
  clearAuthCookie(res, req, AUTH_SESSION_COOKIE);
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
  const user = req.loginSessionChecked
    ? req.loginUser
    : await UserSettings.getLoginUserBySession(req.cookies && req.cookies[AUTH_SESSION_COOKIE]);
  const admin = user ? user.admin : false;
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
      admin
    } : null
  });
});

router.get('/:userId', async function (req, res, next) {

  res.locals.req = req;
  res.locals.res = res;

  const requestedUserId = (req.params.userId || '').trim();
  const token = GoogleAuth.getBearerToken(req);
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

  if (!user.email || (user.email.toLowerCase() !== requestedUserId.toLowerCase() && user.uid !== requestedUserId)) {
    res.status(403).json({ status: 403, message: 'Authenticated Google user does not match requested login user' });
    return;
  }

  var adminUser = await UserSettings.ensureLoginUser(user);
  const sessionToken = await UserSettings.createLoginSession(user.uid, SESSION_MAX_AGE_MS);
  clearAuthCookie(res, req, 'admin');
  clearAuthCookie(res, req, 'adminUser');
  clearAuthCookie(res, req, 'adminChecked');
  await res.cookie(AUTH_SESSION_COOKIE, sessionToken, cookieOptions(req, AUTH_SESSION_COOKIE_OPTIONS));
  if (adminUser) {
    debug(`Admin User ${user.email} logged in`);
    await res.cookie('userId', user.uid, cookieOptions(req, SESSION_COOKIE_OPTIONS));
  } else {
    clearAuthCookie(res, req, 'editMode');
    await res.cookie('userId', user.uid, cookieOptions(req, SESSION_COOKIE_OPTIONS));
  }
  res.status(200);
  res.end(JSON.stringify({
    status: 200,
    userId: user.uid,
    email: user.email,
    admin: adminUser,
    refresh: true,
    message: 'User logged in'
  }));
  return;

});

module.exports = router;
