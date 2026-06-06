/* jslint node:true, esversion:9 */
'use strict';

const debug = require('debug')('hadithdb:user-settings');
const express = require('express');
const createError = require('http-errors');
const admin = require('../lib/Firebase');
const UserSettings = require('../lib/UserSettings');

const router = express.Router();
const MAX_SETTINGS_BYTES = 65535;

async function verifyFirebase(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.replace('Bearer ', '') : null;
    if (!token) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    const decoded = await admin.auth().verifyIdToken(token);
    req.user = {
      uid: decoded.uid,
      name: decoded.name || decoded.email || 'User',
      provider: decoded.firebase && decoded.firebase.sign_in_provider ? decoded.firebase.sign_in_provider : 'firebase',
      email: decoded.email || null
    };
    next();
  } catch (err) {
    debug(`Auth error: ${err.message}`);
    res.status(401).json({ error: 'Invalid authentication token.' });
  }
}

router.get('/', verifyFirebase, async function (req, res) {
  const settings = await UserSettings.getSettings(req.user.uid);
  res.json({ settings });
});

router.put('/', verifyFirebase, async function (req, res, next) {
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
