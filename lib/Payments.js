/* jslint node:true, esversion:9 */
'use strict';

const Stripe = require('stripe');
const createError = require('http-errors');
const debug = require('./Debug')('hadithdb:Payments');
const PaymentConfig = require('./PaymentConfig');
const UserPoints = require('./UserPoints');
const Utils = require('./Utils');

let stripeClient = null;
let stripeClientKey = '';

function currentStripeMode() {
  return PaymentConfig.stripeMode() || PaymentConfig.stripeKeyMode(PaymentConfig.stripeSecretKey()) || '';
}

function stripe() {
  const key = PaymentConfig.stripeSecretKey();
  if (!key)
    throw createError(503, 'Payments are not configured.');
  if (!stripeClient || stripeClientKey !== key) {
    stripeClient = new Stripe(key, { apiVersion: '2026-02-25.clover' });
    stripeClientKey = key;
  }
  return stripeClient;
}

function assertEnabled() {
  if (!PaymentConfig.isEnabled())
    throw createError(503, 'Payments are not enabled.');
}

function adminPricedPackage(pkg) {
  if (!pkg)
    return pkg;
  return Object.assign({}, pkg, {
    amount: PaymentConfig.adminTestAmount(pkg),
    regularAmount: pkg.amount,
    adminTestPrice: true
  });
}

function packageForUser(pkg, user) {
  return user && user.admin === true ? adminPricedPackage(pkg) : pkg;
}

function packagesForUser(user) {
  return PaymentConfig.pointPackages().map(pkg => packageForUser(pkg, user));
}

function publicConfig(options) {
  options = options || {};
  const enabled = PaymentConfig.isEnabled();
  const user = options.user || null;
  return {
    enabled,
    featureEnabled: PaymentConfig.isFeatureEnabled(),
    configured: PaymentConfig.isConfigured(),
    stripeMode: PaymentConfig.stripeMode(),
    liveModeOnly: PaymentConfig.liveModeOnly(),
    publishableKey: enabled ? PaymentConfig.stripePublishableKey() : '',
    currency: PaymentConfig.currency(),
    packages: enabled ? packagesForUser(user) : [],
    autoRechargeDefaults: PaymentConfig.autoRechargeDefaults(),
    contentTranslations: {
      tafsirEnabled: PaymentConfig.contentTranslationEnabledForItemType('tafsir')
    }
  };
}

async function ensureStripeCustomer(user) {
  await UserPoints.ensureUser(user);
  let profile = await UserPoints.profile(user);
  const mode = currentStripeMode();
  if (profile.stripeCustomerId && profile.stripeMode === mode)
    return profile.stripeCustomerId;
  const customer = await stripe().customers.create({
    email: user.email || undefined,
    name: user.name || user.displayName || undefined,
    metadata: {
      userUid: user.uid,
      stripeMode: mode
    }
  });
  profile = await UserPoints.updatePaymentProfile(user, {
    stripeCustomerId: customer.id,
    stripeMode: mode,
    defaultPaymentMethod: '',
    lastPaymentError: ''
  });
  return profile.stripeCustomerId;
}

function paymentMetadata(user, pkg, kind, extra) {
  return Object.assign({
    kind,
    userUid: user.uid,
    userEmail: user.email || '',
    points: String(pkg.points),
    packageId: pkg.id,
    amount: String(pkg.amount),
    regularAmount: pkg.regularAmount ? String(pkg.regularAmount) : String(pkg.amount),
    adminTestPrice: pkg.adminTestPrice ? '1' : '0',
    stripeMode: currentStripeMode()
  }, extra || {});
}

async function createCheckoutSession(user, req, options) {
  assertEnabled();
  options = options || {};
  const configuredPkg = PaymentConfig.pointPackage(options.packageId) || PaymentConfig.defaultPointPackage();
  const pkg = packageForUser(configuredPkg, user);
  if (!pkg)
    throw createError(400, 'No point package is configured.');
  const customerId = await ensureStripeCustomer(user);
  const autoRecharge = options.autoRecharge === true;
  const metadata = paymentMetadata(user, pkg, 'points_purchase', {
    autoRecharge: autoRecharge ? '1' : '0',
    autoRechargeThreshold: String(options.autoRechargeThreshold || PaymentConfig.autoRechargeDefaults().thresholdPoints)
  });
  const paymentIntentData = {
    metadata
  };
  if (autoRecharge)
    paymentIntentData.setup_future_usage = 'off_session';
  const successUrl = PaymentConfig.checkoutReturnUrl(req, options.returnPath, 'success') || PaymentConfig.checkoutSuccessUrl(req);
  const cancelUrl = PaymentConfig.checkoutReturnUrl(req, options.returnPath, 'cancelled') || PaymentConfig.checkoutCancelUrl(req);
  const session = await stripe().checkout.sessions.create({
    mode: 'payment',
    customer: customerId,
    client_reference_id: user.uid,
    success_url: successUrl,
    cancel_url: cancelUrl,
    locale: 'auto',
    billing_address_collection: 'auto',
    allow_promotion_codes: true,
    metadata,
    payment_intent_data: paymentIntentData,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: pkg.currency || PaymentConfig.currency(),
        unit_amount: pkg.amount,
        product_data: {
          name: `${pkg.label || pkg.points + ' points'} - HadithDB points${pkg.adminTestPrice ? ' (admin test)' : ''}`,
          metadata: {
            packageId: pkg.id,
            points: String(pkg.points)
          }
        }
      }
    }]
  });
  return {
    id: session.id,
    url: session.url
  };
}

function normalizeContentTranslationCheckoutOptions(options) {
  options = options || {};
  const itemType = Utils.trimToEmpty(options.itemType).toLowerCase();
  const itemId = Utils.trimToEmpty(options.itemId);
  const targetLanguage = Utils.trimToEmpty(options.targetLanguage || options.language || options.lang).toLowerCase();
  const mode = Utils.trimToEmpty(options.mode || 'translate').toLowerCase() === 'fix' ? 'fix' : 'translate';
  if (!['hadith', 'tafsir'].includes(itemType) || !itemId || !targetLanguage)
    throw createError(400, 'Invalid translation checkout request.');
  if (!PaymentConfig.contentTranslationEnabledForItemType(itemType))
    throw createError(503, itemType === 'tafsir' ? 'Tafsir translation is disabled.' : 'Content translation is disabled.');
  return {
    itemType,
    itemId,
    targetLanguage,
    mode
  };
}

async function createContentTranslationCheckoutSession(user, req, options) {
  assertEnabled();
  options = options || {};
  const translation = normalizeContentTranslationCheckoutOptions(options);
  const configuredPkg = PaymentConfig.pointPackage(options.packageId) || PaymentConfig.defaultPointPackage();
  const pkg = packageForUser(configuredPkg, user);
  if (!pkg)
    throw createError(400, 'No point package is configured.');
  const customerId = await ensureStripeCustomer(user);
  const autoRecharge = options.autoRecharge === true;
  const metadata = paymentMetadata(user, pkg, 'content_translation_purchase', {
    autoRecharge: autoRecharge ? '1' : '0',
    autoRechargeThreshold: String(options.autoRechargeThreshold || PaymentConfig.autoRechargeDefaults().thresholdPoints),
    itemType: translation.itemType,
    itemId: translation.itemId,
    targetLanguage: translation.targetLanguage,
    mode: translation.mode
  });
  const paymentIntentData = {
    capture_method: 'manual',
    metadata
  };
  if (autoRecharge)
    paymentIntentData.setup_future_usage = 'off_session';
  const successUrl = PaymentConfig.checkoutReturnUrl(req, options.returnPath, 'success') || PaymentConfig.checkoutSuccessUrl(req);
  const cancelUrl = PaymentConfig.checkoutReturnUrl(req, options.returnPath, 'cancelled') || PaymentConfig.checkoutCancelUrl(req);
  const session = await stripe().checkout.sessions.create({
    mode: 'payment',
    customer: customerId,
    client_reference_id: user.uid,
    success_url: successUrl,
    cancel_url: cancelUrl,
    locale: 'auto',
    billing_address_collection: 'auto',
    allow_promotion_codes: true,
    metadata,
    payment_intent_data: paymentIntentData,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: pkg.currency || PaymentConfig.currency(),
        unit_amount: pkg.amount,
        product_data: {
          name: `${pkg.label || pkg.points + ' points'} - HadithDB translation points${pkg.adminTestPrice ? ' (admin test)' : ''}`,
          metadata: {
            packageId: pkg.id,
            points: String(pkg.points)
          }
        }
      }
    }]
  });
  return {
    id: session.id,
    url: session.url
  };
}

async function createBillingPortalSession(user, req) {
  assertEnabled();
  const customerId = await ensureStripeCustomer(user);
  const returnUrl = req.baseUrl && req.baseUrl.indexOf('/quran') === 0
    ? Utils.quranUrl(req, '/quran/settings?payments=1')
    : Utils.urlFor(req, '/settings?payments=1');
  const session = await stripe().billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl
  });
  return {
    url: session.url
  };
}

async function updateAutoRecharge(user, options) {
  options = options || {};
  const defaults = PaymentConfig.autoRechargeDefaults();
  const enabled = options.enabled === true || options.enabled === 'true' || options.enabled === 1 || options.enabled === '1';
  const pkg = PaymentConfig.pointPackage(options.packageId) || PaymentConfig.pointPackage(defaults.packageId) || PaymentConfig.defaultPointPackage();
  const threshold = Math.max(0, Math.floor(Number(options.thresholdPoints !== undefined ? options.thresholdPoints : defaults.thresholdPoints) || 0));
  const profile = await UserPoints.profile(user);
  if (enabled && (!profile.defaultPaymentMethod || profile.stripeMode !== currentStripeMode())) {
    return {
      profile,
      requiresCheckout: true,
      checkoutPackageId: pkg ? pkg.id : ''
    };
  }
  const nextProfile = await UserPoints.updatePaymentProfile(user, {
    autoRechargeEnabled: enabled,
    autoRechargeThreshold: threshold,
    autoRechargePackageId: pkg ? pkg.id : '',
    lastPaymentError: ''
  });
  return {
    profile: nextProfile,
    requiresCheckout: false
  };
}

async function savePaymentMethodFromSession(user, session) {
  if (!session || !session.payment_intent)
    return;
  let paymentIntent = session.payment_intent;
  if (typeof paymentIntent === 'string')
    paymentIntent = await stripe().paymentIntents.retrieve(paymentIntent);
  const paymentMethod = typeof paymentIntent.payment_method === 'string'
    ? paymentIntent.payment_method
    : (paymentIntent.payment_method && paymentIntent.payment_method.id);
  if (!paymentMethod)
    return;
  await UserPoints.updatePaymentProfile(user, {
    stripeCustomerId: typeof session.customer === 'string' ? session.customer : (session.customer && session.customer.id),
    stripeMode: currentStripeMode(),
    defaultPaymentMethod: paymentMethod,
    lastPaymentError: ''
  });
}

async function fulfillCheckoutSession(session) {
  assertEnabled();
  if (!session || session.payment_status !== 'paid')
    return { credited: false, reason: 'not_paid' };
  const metadata = session.metadata || {};
  if (metadata.kind !== 'points_purchase')
    return { credited: false, reason: 'not_points_purchase' };
  const userUid = metadata.userUid || session.client_reference_id;
  const points = Math.floor(Number(metadata.points));
  if (!userUid || !Number.isInteger(points) || points <= 0)
    throw new Error('Invalid Stripe checkout metadata.');
  const user = { uid: userUid, email: metadata.userEmail || null };
  const result = await UserPoints.creditPoints(user, points, 'stripe_checkout', 'stripe_checkout_session', session.id, {
    packageId: metadata.packageId,
    stripeCustomerId: typeof session.customer === 'string' ? session.customer : (session.customer && session.customer.id),
    paymentIntent: typeof session.payment_intent === 'string' ? session.payment_intent : (session.payment_intent && session.payment_intent.id)
  });
  await UserPoints.updatePaymentProfile(user, {
    stripeCustomerId: typeof session.customer === 'string' ? session.customer : (session.customer && session.customer.id),
    stripeMode: currentStripeMode(),
    lastPaymentError: ''
  });
  if (metadata.autoRecharge === '1') {
    await savePaymentMethodFromSession(user, session);
    await UserPoints.updatePaymentProfile(user, {
      autoRechargeEnabled: true,
      autoRechargeThreshold: Number(metadata.autoRechargeThreshold || PaymentConfig.autoRechargeDefaults().thresholdPoints),
      autoRechargePackageId: metadata.packageId || PaymentConfig.autoRechargeDefaults().packageId
    });
  }
  return result;
}

async function fulfillPaymentIntent(paymentIntent) {
  assertEnabled();
  const metadata = paymentIntent && paymentIntent.metadata || {};
  if (metadata.kind !== 'auto_recharge' || paymentIntent.status !== 'succeeded')
    return { credited: false, reason: 'not_auto_recharge' };
  const points = Math.floor(Number(metadata.points));
  const userUid = metadata.userUid;
  if (!userUid || !Number.isInteger(points) || points <= 0)
    throw new Error('Invalid Stripe payment intent metadata.');
  const user = { uid: userUid, email: metadata.userEmail || null };
  const result = await UserPoints.creditPoints(user, points, 'stripe_auto_recharge', 'stripe_payment_intent', paymentIntent.id, {
    packageId: metadata.packageId,
    stripeCustomerId: typeof paymentIntent.customer === 'string' ? paymentIntent.customer : (paymentIntent.customer && paymentIntent.customer.id)
  });
  await UserPoints.updatePaymentProfile(user, {
    stripeCustomerId: typeof paymentIntent.customer === 'string' ? paymentIntent.customer : (paymentIntent.customer && paymentIntent.customer.id),
    stripeMode: currentStripeMode(),
    defaultPaymentMethod: typeof paymentIntent.payment_method === 'string' ? paymentIntent.payment_method : undefined,
    lastPaymentError: ''
  });
  return result;
}

function assertCheckoutSessionId(sessionId) {
  sessionId = Utils.trimToEmpty(sessionId);
  if (!/^cs_(?:test|live)_/.test(sessionId))
    throw createError(400, 'Invalid checkout session id.');
  return sessionId;
}

async function retrieveCheckoutSession(sessionId) {
  return stripe().checkout.sessions.retrieve(assertCheckoutSessionId(sessionId), {
    expand: ['payment_intent']
  });
}

function paymentIntentFromSession(session) {
  return session && typeof session.payment_intent === 'object' ? session.payment_intent : null;
}

async function contentTranslationCheckoutDetails(user, sessionId, expected, allowedStatuses) {
  assertEnabled();
  user = await UserPoints.ensureUser(user);
  expected = expected || {};
  const session = await retrieveCheckoutSession(sessionId);
  const metadata = session.metadata || {};
  const sessionUserUid = metadata.userUid || session.client_reference_id || '';
  if (sessionUserUid !== user.uid)
    throw createError(403, 'Checkout session does not belong to this user.');
  if (metadata.kind !== 'content_translation_purchase')
    throw createError(400, 'Checkout session is not for a content translation.');
  const expectedTranslation = normalizeContentTranslationCheckoutOptions({
    itemType: expected.itemType || metadata.itemType,
    itemId: expected.itemId || metadata.itemId,
    targetLanguage: expected.targetLanguage || metadata.targetLanguage,
    mode: expected.mode || metadata.mode
  });
  if (metadata.itemType !== expectedTranslation.itemType
    || metadata.itemId !== expectedTranslation.itemId
    || metadata.targetLanguage !== expectedTranslation.targetLanguage
    || (metadata.mode || 'translate') !== expectedTranslation.mode) {
    throw createError(403, 'Checkout session does not match this translation.');
  }
  const paymentIntent = paymentIntentFromSession(session);
  if (!paymentIntent)
    throw createError(400, 'Checkout session is missing a payment authorization.');
  allowedStatuses = Array.isArray(allowedStatuses) && allowedStatuses.length ? allowedStatuses : ['requires_capture', 'succeeded'];
  if (!allowedStatuses.includes(paymentIntent.status))
    throw createError(402, `Payment authorization is ${paymentIntent.status || 'not ready'}.`);
  return {
    session,
    paymentIntent,
    metadata,
    points: Math.max(0, Math.floor(Number(metadata.points) || 0))
  };
}

async function creditContentTranslationCheckout(user, details, paymentIntent) {
  const session = details.session;
  const metadata = details.metadata || {};
  const points = details.points;
  if (!Number.isInteger(points) || points <= 0)
    throw new Error('Invalid Stripe translation checkout metadata.');
  paymentIntent = paymentIntent || details.paymentIntent;
  const result = await UserPoints.creditPoints(user, points, 'stripe_translation_checkout', 'stripe_translation_checkout_session', session.id, {
    packageId: metadata.packageId,
    stripeCustomerId: typeof session.customer === 'string' ? session.customer : (session.customer && session.customer.id),
    paymentIntent: paymentIntent && paymentIntent.id
  });
  await UserPoints.updatePaymentProfile(user, {
    stripeCustomerId: typeof session.customer === 'string' ? session.customer : (session.customer && session.customer.id),
    stripeMode: currentStripeMode(),
    lastPaymentError: ''
  });
  if (metadata.autoRecharge === '1') {
    await savePaymentMethodFromSession(user, Object.assign({}, session, { payment_intent: paymentIntent }));
    await UserPoints.updatePaymentProfile(user, {
      autoRechargeEnabled: true,
      autoRechargeThreshold: Number(metadata.autoRechargeThreshold || PaymentConfig.autoRechargeDefaults().thresholdPoints),
      autoRechargePackageId: metadata.packageId || PaymentConfig.autoRechargeDefaults().packageId
    });
  }
  return Object.assign({}, result, {
    sessionId: session.id,
    paymentIntent: paymentIntent && paymentIntent.id
  });
}

async function validateContentTranslationCheckout(user, sessionId, expected) {
  const details = await contentTranslationCheckoutDetails(user, sessionId, expected, ['requires_capture', 'succeeded']);
  return {
    sessionId: details.session.id,
    paymentIntent: details.paymentIntent.id,
    status: details.paymentIntent.status,
    points: details.points
  };
}

async function captureContentTranslationCheckout(user, sessionId, expected) {
  const details = await contentTranslationCheckoutDetails(user, sessionId, expected, ['requires_capture', 'succeeded']);
  let paymentIntent = details.paymentIntent;
  if (paymentIntent.status === 'requires_capture') {
    paymentIntent = await stripe().paymentIntents.capture(paymentIntent.id);
    if (!paymentIntent || paymentIntent.status !== 'succeeded')
      throw createError(402, 'Unable to complete payment authorization.');
  }
  return creditContentTranslationCheckout(user, details, paymentIntent);
}

async function cancelContentTranslationCheckout(user, sessionId, expected) {
  let details;
  try {
    details = await contentTranslationCheckoutDetails(user, sessionId, expected, ['requires_capture', 'succeeded', 'canceled']);
  } catch (err) {
    if (Number(err.status || err.statusCode) === 402)
      return { canceled: false };
    throw err;
  }
  const paymentIntent = details.paymentIntent;
  if (paymentIntent.status !== 'requires_capture')
    return { canceled: false, status: paymentIntent.status };
  const canceled = await stripe().paymentIntents.cancel(paymentIntent.id, {
    cancellation_reason: 'requested_by_customer'
  });
  return {
    canceled: canceled && canceled.status === 'canceled',
    status: canceled && canceled.status
  };
}

async function reconcileCheckoutSessionForUser(user, sessionId) {
  assertEnabled();
  const session = await retrieveCheckoutSession(sessionId);
  const metadata = session.metadata || {};
  const sessionUserUid = metadata.userUid || session.client_reference_id || '';
  if (sessionUserUid !== user.uid)
    throw createError(403, 'Checkout session does not belong to this user.');
  return fulfillCheckoutSession(session);
}

async function maybeAutoRecharge(user) {
  if (!PaymentConfig.isEnabled())
    return null;
  const profile = await UserPoints.profile(user);
  if (!profile.autoRechargeEnabled || !profile.stripeCustomerId || !profile.defaultPaymentMethod || profile.stripeMode !== currentStripeMode())
    return null;
  const currentBalance = await UserPoints.balance(user);
  if (currentBalance > profile.autoRechargeThreshold)
    return null;
  const configuredPkg = PaymentConfig.pointPackage(profile.autoRechargePackageId) || PaymentConfig.defaultPointPackage();
  const pkg = packageForUser(configuredPkg, user);
  if (!pkg)
    return null;
  const metadata = paymentMetadata(user, pkg, 'auto_recharge');
  try {
    const paymentIntent = await stripe().paymentIntents.create({
      amount: pkg.amount,
      currency: pkg.currency || PaymentConfig.currency(),
      customer: profile.stripeCustomerId,
      payment_method: profile.defaultPaymentMethod,
      off_session: true,
      confirm: true,
      description: `${pkg.label || pkg.points + ' points'} - HadithDB auto recharge`,
      metadata
    });
    if (paymentIntent.status === 'succeeded')
      return fulfillPaymentIntent(paymentIntent);
    return { credited: false, status: paymentIntent.status };
  } catch (err) {
    debug.error(`auto recharge failed user=${user.uid}: ${err.message}\n${err.stack || ''}`);
    await UserPoints.updatePaymentProfile(user, {
      lastPaymentError: err.message || 'Auto recharge failed.'
    });
    return { credited: false, error: err.message };
  }
}

function constructWebhookEvent(req) {
  const secret = PaymentConfig.stripeWebhookSecret();
  if (!secret)
    throw createError(503, 'Stripe webhook secret is not configured.');
  const signature = req.headers['stripe-signature'];
  const body = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
  return stripe().webhooks.constructEvent(body, signature, secret);
}

module.exports = {
  cancelContentTranslationCheckout,
  constructWebhookEvent,
  createBillingPortalSession,
  createCheckoutSession,
  createContentTranslationCheckoutSession,
  captureContentTranslationCheckout,
  fulfillCheckoutSession,
  fulfillPaymentIntent,
  maybeAutoRecharge,
  publicConfig,
  reconcileCheckoutSessionForUser,
  validateContentTranslationCheckout,
  updateAutoRecharge
};
