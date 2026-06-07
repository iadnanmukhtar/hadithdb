/* jslint node:true, esversion:9 */
'use strict';

const debug = require('debug')('hadithdb:login');
const express = require('express');
const GoogleAuth = require('../lib/GoogleAuth');
const UserSettings = require('../lib/UserSettings');

const router = express.Router();

router.get('/logout', async function (req, res) {
  res.clearCookie('admin', { path: '/' });
  res.clearCookie('adminUser', { path: '/' });
  res.clearCookie('adminChecked', { path: '/' });
  res.clearCookie('userId', { path: '/' });
  res.clearCookie('editMode', { path: '/' });
  res.status(200);
  res.end(JSON.stringify({
    status: 200,
    refresh: true,
    message: 'User logged out'
  }));
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
  res.clearCookie('admin', { path: '/' });
  res.clearCookie('adminUser', { path: '/' });
  res.clearCookie('adminChecked', { path: '/' });
  if (adminUser) {
    debug(`Admin User ${user.email} logged in`);
    await res.cookie('userId', user.uid);
  } else {
    res.clearCookie('editMode', { path: '/' });
    await res.cookie('userId', user.uid);
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
