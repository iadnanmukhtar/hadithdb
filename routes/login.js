/* jslint node:true, esversion:9 */
'use strict';

const debug = require('debug')('hadithdb:login');
const HomeDir = require('os').homedir();
const express = require('express');
const asyncify = require('express-asyncify').default;
const Arabic = require('../lib/Arabic');
const Hadith = require('../lib/Hadith');

const router = asyncify(express.Router());

router.get('/:userId', async function (req, res, next) {

  res.locals.req = req;
  res.locals.res = res;

  var adminUsers = require(HomeDir + '/.hadithdb/admin-users.json');
  if (adminUsers.find(userId => { return userId === req.params.userId })) {
    debug(`Admin User ${req.params.userId} logged in`);
    await res.cookie('admin', global.settings.admin.key, {
      expires: new Date(Date.now() + 86400000 * 60 * 1)
    });
    await res.cookie('userId', req.params.userId, {
      expires: new Date(Date.now() + 86400000 * 60 * 1)
    });
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

