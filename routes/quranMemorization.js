/* jslint node:true, esversion:9 */
'use strict';

const express = require('express');
const debug = require('../lib/Debug')('hadithdb:QuranMemorization');
const GoogleAuth = require('../lib/GoogleAuth');
const QuranMemorization = require('../lib/QuranMemorization');
const UserSettings = require('../lib/UserSettings');

const router = express.Router();

router.use(function (req, res, next) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  next();
});

router.use(async function (req, res, next) {
  try {
    req.user = await GoogleAuth.verifyRequest(req, { allowSession: true });
    if (!req.user) return res.status(401).json({ error: 'Please sign in to save memorization progress.' });
    next();
  } catch (err) {
    res.status(401).json({ error: 'Please sign in to save memorization progress.' });
  }
});

router.get('/pages', async function (req, res) {
  const pages = await QuranMemorization.list(req.user.uid);
  res.json({ pages });
});

router.get('/pages/:page', async function (req, res) {
  const page = await QuranMemorization.get(req.user.uid, req.params.page);
  res.json({ page });
});

router.put('/pages/:page', async function (req, res) {
  const settings = await UserSettings.getSettings(req.user.uid);
  const page = await QuranMemorization.save(req.user.uid, req.params.page, req.body && req.body.status, settings, {
    reviewed: !req.body || req.body.reviewed !== false
  });
  res.json({ page });
});

router.get('/next', async function (req, res) {
  const [page, hasPages] = await Promise.all([
    QuranMemorization.nextDue(req.user.uid, req.query.exclude),
    QuranMemorization.hasActivePages(req.user.uid)
  ]);
  res.json({ page, hasPages });
});

router.use(function (err, req, res, next) {
  debug.error(`${req.method} ${req.originalUrl}: ${err.message}\n${err.stack || ''}`);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: err.message || 'Unable to load memorization progress.' });
});

module.exports = router;
