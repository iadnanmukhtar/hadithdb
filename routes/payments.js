/* jslint node:true, esversion:9 */
'use strict';

const express = require('express');
const createError = require('http-errors');
const debug = require('../lib/Debug')('hadithdb:PaymentsRoute');
const GoogleAuth = require('../lib/GoogleAuth');
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

function requirePaymentsEnabled(req, res, next) {
  if (!PaymentConfig.isEnabled())
    return next(createError(503, 'Payments are disabled.'));
  next();
}

router.get('/config', function (req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.json(Payments.publicConfig());
});

router.get('/summary', requirePaymentsEnabled, requireUser, async function (req, res) {
  const [balance, profile, ledger] = await Promise.all([
    UserPoints.balance(req.user),
    UserPoints.profile(req.user),
    UserPoints.ledger(req.user, 10)
  ]);
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    config: Payments.publicConfig({ user: req.user }),
    balance,
    profile,
    ledger
  });
});

router.post('/checkout', requirePaymentsEnabled, requireUser, async function (req, res) {
  const session = await Payments.createCheckoutSession(req.user, req, {
    packageId: req.body && req.body.packageId,
    autoRecharge: req.body && req.body.autoRecharge === true,
    autoRechargeThreshold: req.body && req.body.autoRechargeThreshold,
    returnPath: req.body && req.body.returnPath
  });
  res.setHeader('Cache-Control', 'no-store');
  res.json(session);
});

router.post('/portal', requirePaymentsEnabled, requireUser, async function (req, res) {
  const session = await Payments.createBillingPortalSession(req.user, req);
  res.setHeader('Cache-Control', 'no-store');
  res.json(session);
});

router.post('/checkout-session/:sessionId', requirePaymentsEnabled, requireUser, async function (req, res) {
  const result = await Payments.reconcileCheckoutSessionForUser(req.user, req.params.sessionId);
  res.setHeader('Cache-Control', 'no-store');
  res.json(result);
});

router.put('/auto-recharge', requirePaymentsEnabled, requireUser, async function (req, res) {
  const result = await Payments.updateAutoRecharge(req.user, req.body || {});
  res.setHeader('Cache-Control', 'no-store');
  res.json(result);
});

router.post('/webhook', requirePaymentsEnabled, async function (req, res, next) {
  let event;
  try {
    event = Payments.constructWebhookEvent(req);
  } catch (err) {
    return next(createError(400, 'Invalid Stripe webhook signature.'));
  }
  try {
    if (event.type === 'checkout.session.completed')
      await Payments.fulfillCheckoutSession(event.data.object);
    else if (event.type === 'payment_intent.succeeded')
      await Payments.fulfillPaymentIntent(event.data.object);
    res.json({ received: true });
  } catch (err) {
    debug.error(`webhook ${event.type} failed: ${err.message}\n${err.stack || ''}`);
    next(err);
  }
});

router.get('/languages', function (req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    defaultLanguage: PaymentConfig.defaultLanguage(),
    languages: PaymentConfig.supportedLanguages()
  });
});

module.exports = router;
