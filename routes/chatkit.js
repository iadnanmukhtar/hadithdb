'use strict';

const crypto = require('crypto');
const express = require('express');
const axios = require('axios');
const rateLimit = require('express-rate-limit').default;
const { config } = require('../lib/ChatKitConfig');
const router = express.Router();
const COOKIE = 'hadithdb_chat';
const COOKIE_AGE = 30 * 24 * 60 * 60 * 1000;

function sign(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('hex');
}

function owner(req, res, secret) {
  const cookie = String(req.cookies?.[COOKIE] || '');
  const [id, expires, signature] = cookie.split('.');
  const expected = sign(`${id}.${expires}`, secret);
  if (/^[a-f0-9]{32}$/.test(id || '') && Number(expires) > Date.now() &&
      /^[a-f0-9]{64}$/.test(signature || '') &&
      crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return id;
  const freshId = crypto.randomBytes(16).toString('hex');
  const payload = `${freshId}.${Date.now() + COOKIE_AGE}`;
  res.cookie(COOKIE, `${payload}.${sign(payload, secret)}`, {
    httpOnly: true, secure: req.secure, sameSite: 'strict', path: '/', maxAge: COOKIE_AGE
  });
  return freshId;
}

router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-Robots-Tag', 'noindex, nofollow');
  next();
});

router.get('/config', (req, res) => {
  const settings = config();
  res.json({ enabled: settings.enabled, configured: Boolean(settings.domainKey && settings.secret),
    domainKey: settings.domainKey });
});

router.post('/', rateLimit({
  windowMs: 60000, limit: 30, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many chat requests. Please wait a minute and try again.' }
}), async (req, res) => {
  const settings = config();
  if (!settings.enabled || !settings.secret)
    return res.status(503).json({ error: 'Chat is not available yet. Please try again later.' });
  // Require a same-origin browser request before minting or accepting a guest session.
  if (req.get('Sec-Fetch-Site') === 'cross-site')
    return res.status(403).json({ error: 'Use chat from this website.' });
  try {
    const origin = new URL(req.get('Origin') || '');
    if (origin.origin !== `${req.protocol}://${req.get('host')}`) throw new Error('origin');
  } catch (_) {
    return res.status(403).json({ error: 'Use chat from this website.' });
  }
  if (!req.is('application/json') || !req.body || Array.isArray(req.body))
    return res.status(400).json({ error: 'Invalid chat request.' });
  const body = JSON.stringify(req.body);
  if (Buffer.byteLength(body) > 32768)
    return res.status(413).json({ error: 'This message is too long.' });
  const user = owner(req, res, settings.secret);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const controller = new AbortController();
  res.on('close', () => controller.abort());
  try {
    const upstream = await axios.post(settings.endpoint, body, {
      headers: {
        'Content-Type': 'application/json',
        'X-ChatKit-User': user, 'X-ChatKit-Time': timestamp,
        'X-ChatKit-Signature': sign(`${timestamp}\n${user}\n${body}`, settings.secret)
      },
      responseType: 'stream', timeout: 120000, maxRedirects: 0,
      signal: controller.signal, validateStatus: () => true
    });
    if (upstream.status >= 400) {
      upstream.data.destroy();
      const status = [400, 404, 409, 413, 429].includes(upstream.status) ? upstream.status : 503;
      return res.status(status).json({ error: status === 409
        ? 'A reply is already in progress. Please wait.' : 'Chat could not complete this request. Please try again.' });
    }
    res.set('Content-Type', upstream.headers['content-type'] || 'application/json');
    res.set('X-Accel-Buffering', 'no');
    res.flushHeaders();
    upstream.data.on('error', () => res.destroy());
    upstream.data.pipe(res);
  } catch (_) {
    if (!res.headersSent && !res.destroyed)
      res.status(503).json({ error: 'Chat is temporarily unavailable. Please try again shortly.' });
  }
});

module.exports = router;
