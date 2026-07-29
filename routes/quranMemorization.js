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
  const settings = await UserSettings.getSettings(req.user.uid);
  const reviewLimit = settings.memorization.reviewLimit;
  const reviewed = Math.max(0, parseInt(req.query.reviewed, 10) || 0);
  const hasPages = await QuranMemorization.hasActivePages(req.user.uid);
  const excludedPages = (req.query.exclude || '').toString().split(',').slice(0, 604);
  if (reviewed >= reviewLimit) {
    const hardPage = await QuranMemorization.nextDue(req.user.uid, excludedPages, settings, { hardOnly: true });
    if (hardPage) {
      res.json({ page: hardPage, hasPages, limitReached: false, reviewLimit });
      return;
    }
    res.json({ page: null, hasPages, limitReached: true, reviewLimit });
    return;
  }
  const page = await QuranMemorization.nextDue(req.user.uid, excludedPages, settings);
  res.json({ page, hasPages, limitReached: false, reviewLimit });
});

router.use(function (err, req, res, next) {
  debug.error(`${req.method} ${req.originalUrl}: ${err.message}\n${err.stack || ''}`);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: err.message || 'Unable to load memorization progress.' });
});

module.exports = router;
