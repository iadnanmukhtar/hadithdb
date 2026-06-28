/* jslint node:true, esversion:9 */
'use strict';

const express = require('express');
const createError = require('http-errors');
const debug = require('../lib/Debug')('hadithdb:ContentTranslationsRoute');
const GoogleAuth = require('../lib/GoogleAuth');
const ContentTranslations = require('../lib/ContentTranslations');
const PaymentConfig = require('../lib/PaymentConfig');
const Payments = require('../lib/Payments');
const UserSettings = require('../lib/UserSettings');
const UserPoints = require('../lib/UserPoints');

const router = express.Router();

async function requireUser(req, res, next) {
  try {
    let user = await GoogleAuth.verifyRequest(req, { allowSession: true });
    if (!user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (user.admin !== true && await UserSettings.isAdminUser(user.uid))
      user = Object.assign({}, user, { admin: true });
    req.user = user;
    next();
  } catch (err) {
    debug.error(`auth error: ${err.message}\n${err.stack || ''}`);
    res.status(401).json({ error: 'Invalid authentication token.' });
  }
}

function requestPayload(req) {
  return {
    itemType: (req.body && (req.body.itemType || req.body.type)) || (req.query && (req.query.itemType || req.query.type)),
    itemId: (req.body && (req.body.itemId || req.body.id)) || (req.query && (req.query.itemId || req.query.id)),
    targetLanguage: (req.body && (req.body.targetLanguage || req.body.language || req.body.lang)) || (req.query && (req.query.targetLanguage || req.query.language || req.query.lang)),
    mode: (req.body && req.body.mode) || (req.query && req.query.mode) || 'translate'
  };
}

function requirePaymentsEnabled(req, res, next) {
  if (!PaymentConfig.isEnabled())
    return next(createError(503, 'Content translation is disabled.'));
  next();
}

router.get('/estimate', requirePaymentsEnabled, requireUser, async function (req, res) {
  const payload = requestPayload(req);
  const estimate = await ContentTranslations.estimate(req.user, payload.itemType, payload.itemId, payload.targetLanguage, payload.mode);
  res.setHeader('Cache-Control', 'no-store');
  res.json(estimate);
});

router.post('/', requirePaymentsEnabled, requireUser, async function (req, res, next) {
  const payload = requestPayload(req);
  try {
    let result;
    try {
      result = await ContentTranslations.translate(req.user, payload.itemType, payload.itemId, payload.targetLanguage, payload.mode);
    } catch (err) {
      if (Number(err.status || err.statusCode) !== 402)
        throw err;
      const recharge = await Payments.maybeAutoRecharge(req.user);
      if (!recharge || recharge.credited !== true)
        throw err;
      result = await ContentTranslations.translate(req.user, payload.itemType, payload.itemId, payload.targetLanguage, payload.mode);
      result.autoRecharge = recharge;
    }
    if (!result.cached && result.points > 0)
      result.autoRecharge = result.autoRecharge || await Payments.maybeAutoRecharge(req.user);
    result.balance = await UserPoints.balance(req.user);
    res.setHeader('Cache-Control', 'no-store');
    res.json(result);
  } catch (err) {
    if (Number(err.status || err.statusCode) === 402) {
      res.status(402).json({ error: 'Not enough points.', message: err.message || 'Not enough points.' });
      return;
    }
    next(err);
  }
});

router.get('/languages', function (req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    enabled: PaymentConfig.isEnabled(),
    pricing: PaymentConfig.isEnabled() ? {
      translatePointsPer1000Words: PaymentConfig.pointsPer1000Words('translate'),
      translateMinimumPoints: PaymentConfig.minimumPoints('translate')
    } : null,
    languages: PaymentConfig.isEnabled() ? ContentTranslations.supportedLanguages() : []
  });
});

module.exports = router;
