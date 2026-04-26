/* jslint node:true, esversion:9 */
'use strict';

const debug = require('debug')('hadithdb:login');
const HomeDir = require('os').homedir();
const express = require('express');

const router = express.Router();

router.get('/logout', async function (req, res) {
  res.clearCookie('admin', { path: '/' });
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

  var adminUsers = require(HomeDir + '/.hadithdb/admin-users.json');
  if (adminUsers.find(userId => { return userId === req.params.userId })) {
    debug(`Admin User ${req.params.userId} logged in`);
    await res.cookie('admin', global.settings.admin.key);
    await res.cookie('userId', req.params.userId);
  } else {
    res.clearCookie('admin', { path: '/' });
    res.clearCookie('editMode', { path: '/' });
    await res.cookie('userId', req.params.userId);
  }
  res.status(200);
  res.end(JSON.stringify({
    status: 200,
    userId: req.params.userId,
    refresh: true,
    message: 'User logged in'
  }));
  return;

});

module.exports = router;
