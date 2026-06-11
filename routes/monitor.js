/* jslint node:true, esversion:9 */
'use strict';

const axios = require('axios');
const express = require('express');
const createError = require('http-errors');
const AppMonitor = require('../lib/AppMonitor');

const router = express.Router();
const DEPENDENCY_TIMEOUT_MS = Number(process.env.HADITHDB_MONITOR_DEPENDENCY_TIMEOUT_MS || 3000);

router.use(function requireAdminOrLocal(req, res, next) {
  if (req.admin || isLocalRequest(req)) {
    next();
    return;
  }
  next(createError(403, 'Monitor is available only to admins or local requests.'));
});

router.get('/', async function (req, res, next) {
  try {
    const payload = AppMonitor.snapshot({
      includeHandles: req.query && req.query.handles === '1'
    });
    if (req.query && req.query.check === '1')
      payload.dependencies = await dependencyChecks();
    res.setHeader('Cache-Control', 'no-store');
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

async function dependencyChecks() {
  const checks = {};
  checks.mysql = await timeCheck(async () => {
    await global.query('SELECT 1 AS ok');
    return { ok: true };
  });
  checks.elasticsearch = await timeCheck(async () => {
    const url = `${String(global.settings.search.domain).replace(/\/$/, '')}/_cluster/health`;
    const response = await axios.get(url, { timeout: DEPENDENCY_TIMEOUT_MS });
    return {
      ok: response.status === 200,
      status: response.data && response.data.status,
      pendingTasks: response.data && response.data.number_of_pending_tasks
    };
  });
  return checks;
}

async function timeCheck(fn) {
  const startedAt = Date.now();
  try {
    const result = await fn();
    return Object.assign({
      ok: true,
      durationMs: Date.now() - startedAt
    }, result);
  } catch (err) {
    return {
      ok: false,
      durationMs: Date.now() - startedAt,
      message: err.message
    };
  }
}

function isLocalRequest(req) {
  const ip = req.ip || req.connection && req.connection.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

module.exports = router;
