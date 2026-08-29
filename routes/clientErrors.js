'use strict';

const express = require('express');
const Debug = require('../lib/Debug');

const debug = Debug('hadithdb:ClientToast');
const router = express.Router();
const MAX_REPORTS_PER_MINUTE = 20;
const buckets = new Map();

function bounded(value, maxLength) {
  return (value === undefined || value === null ? '' : value.toString())
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, maxLength);
}

function reportPath(value) {
  value = bounded(value, 500);
  if (!value.startsWith('/'))
    return '';
  return value.split(/[?#]/)[0];
}

function allowReport(req, now) {
  const key = bounded(req.ip || req.socket && req.socket.remoteAddress || 'unknown', 100);
  const minute = Math.floor(now / 60000);
  const bucket = buckets.get(key);
  if (!bucket || bucket.minute !== minute) {
    buckets.set(key, { minute, count: 1 });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= MAX_REPORTS_PER_MINUTE;
}

router.post('/', function logClientToastError(req, res) {
  if (!allowReport(req, Date.now()))
    return res.status(204).end();
  const title = bounded(req.body && req.body.title, 200) || 'Error';
  const message = bounded(req.body && req.body.message, 1200) || 'No toast message supplied';
  const path = reportPath(req.body && req.body.path) || bounded(req.path, 500);
  debug.error(`Browser toast error: ${title}: ${message}${path ? ` path=${path}` : ''}`);
  return res.status(204).end();
});

module.exports = router;
module.exports.bounded = bounded;
module.exports.reportPath = reportPath;
