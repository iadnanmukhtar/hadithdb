/* jslint node:true, esversion:9 */
'use strict';

const debug = require('debug')('hadithdb:user-settings');
const express = require('express');
const createError = require('http-errors');
const GoogleAuth = require('../lib/GoogleAuth');
const UserSettings = require('../lib/UserSettings');

const router = express.Router();
const MAX_SETTINGS_BYTES = 65535;

async function verifyGoogle(req, res, next) {
  const optional = req.method === 'GET' && req.query && req.query.optional === '1';
  try {
    const token = GoogleAuth.getBearerToken(req);
    if (!token) {
      if (optional) {
        req.user = null;
        next();
        return;
      }
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    req.user = await GoogleAuth.verifyToken(token);
    next();
  } catch (err) {
    debug(`Auth error: ${err.message}`);
    if (optional) {
      req.user = null;
      next();
      return;
    }
    res.status(401).json({ error: 'Invalid authentication token.' });
  }
}

router.get('/', verifyGoogle, async function (req, res) {
  if (!req.user) {
    res.json({ settings: {} });
    return;
  }
  const settings = await UserSettings.getSettings(req.user.uid);
  res.json({ settings });
});

router.put('/', verifyGoogle, async function (req, res, next) {
  const settings = req.body && req.body.settings;
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    next(createError(400, 'Settings must be a JSON object.'));
    return;
  }
  if (Buffer.byteLength(JSON.stringify(settings), 'utf8') > MAX_SETTINGS_BYTES) {
    next(createError(413, 'Settings payload is too large.'));
    return;
  }
  const saved = await UserSettings.saveSettings(req.user, settings);
  res.json({ settings: saved });
});

module.exports = router;
