/* jslint node:true, esversion:9 */
'use strict';

const fs = require('fs');
const path = require('path');
const { homedir } = require('os');

const DEFAULT_SLOW_REQUEST_MS = Number(process.env.HADITHDB_MONITOR_SLOW_REQUEST_MS || 2000);
const DEFAULT_LAG_WARN_MS = Number(process.env.HADITHDB_MONITOR_LAG_WARN_MS || 1000);
const DEFAULT_SAMPLE_MS = Number(process.env.HADITHDB_MONITOR_SAMPLE_MS || 1000);
const DEFAULT_SNAPSHOT_MS = Number(process.env.HADITHDB_MONITOR_SNAPSHOT_MS || 60000);
const MAX_RING_ITEMS = 50;
const MAX_ACTIVE_REQUESTS = 200;
const SNAPSHOT_FILE = process.env.HADITHDB_MONITOR_SNAPSHOT_FILE ||
  path.join(homedir(), '.hadithdb', 'monitor.json');
const REPORT_DIR = process.env.HADITHDB_MONITOR_REPORT_DIR ||
  path.join(homedir(), '.hadithdb', 'reports');

class RingBuffer {
  constructor(limit) {
    this.limit = limit;
    this.items = [];
  }

  push(item) {
    this.items.push(item);
    if (this.items.length > this.limit)
      this.items.shift();
  }

  toJSON() {
    return this.items.slice();
  }
}

class AppMonitor {
  constructor() {
    this.startedAt = new Date();
    this.requestId = 0;
    this.activeRequests = new Map();
    this.recentSlowRequests = new RingBuffer(MAX_RING_ITEMS);
    this.recentErrors = new RingBuffer(MAX_RING_ITEMS);
    this.recentLagEvents = new RingBuffer(MAX_RING_ITEMS);
    this.totals = {
      requests: 0,
      completed: 0,
      status2xx: 0,
      status3xx: 0,
      status4xx: 0,
      status5xx: 0,
      slowRequests: 0,
      requestErrors: 0,
      lagEvents: 0
    };
    this.slowRequestMs = DEFAULT_SLOW_REQUEST_MS;
    this.lagWarnMs = DEFAULT_LAG_WARN_MS;
    this.sampleMs = DEFAULT_SAMPLE_MS;
    this.snapshotMs = DEFAULT_SNAPSHOT_MS;
    this.lastLagMs = 0;
    this.maxLagMs = 0;
    this.lastSnapshotAt = null;
    this.lastSnapshotError = null;
    this._lastTick = Date.now();
    this._startLagSampler();
    this._startSnapshotWriter();
    this._configureProcessReports();
    this._captureProcessEvents();
  }

  middleware() {
    return (req, res, next) => {
      const id = ++this.requestId;
      const startedAtMs = Date.now();
      const entry = {
        id,
        method: req.method,
        url: this._safeUrl(req.originalUrl || req.url),
        startedAt: new Date(startedAtMs).toISOString()
      };
      this.totals.requests += 1;
      if (this.activeRequests.size < MAX_ACTIVE_REQUESTS)
        this.activeRequests.set(id, entry);

      res.on('finish', () => {
        const durationMs = Date.now() - startedAtMs;
        this.activeRequests.delete(id);
        this.totals.completed += 1;
        this._countStatus(res.statusCode);
        if (durationMs >= this.slowRequestMs) {
          this.totals.slowRequests += 1;
          this.recentSlowRequests.push({
            at: new Date().toISOString(),
            method: entry.method,
            url: entry.url,
            statusCode: res.statusCode,
            durationMs
          });
          this.writeSnapshot();
        }
        if (res.statusCode >= 500) {
          this.totals.requestErrors += 1;
          this.recentErrors.push({
            at: new Date().toISOString(),
            method: entry.method,
            url: entry.url,
            statusCode: res.statusCode,
            durationMs
          });
          this.writeSnapshot();
        }
      });
      next();
    };
  }

  recordError(err, req, statusCode) {
    this.recentErrors.push({
      at: new Date().toISOString(),
      method: req && req.method,
      url: req && this._safeUrl(req.originalUrl || req.url),
      statusCode: statusCode || err.status || err.statusCode || 500,
      message: err && err.message,
      name: err && err.name
    });
    this.writeSnapshot();
  }

  snapshot(options) {
    options = options || {};
    const memory = process.memoryUsage();
    const activeRequests = Array.from(this.activeRequests.values()).map(item => ({
      id: item.id,
      method: item.method,
      url: item.url,
      startedAt: item.startedAt,
      ageMs: Date.now() - Date.parse(item.startedAt)
    }));
    activeRequests.sort((a, b) => b.ageMs - a.ageMs);

    const data = {
      status: this._status(),
      pid: process.pid,
      node: process.version,
      startedAt: this.startedAt.toISOString(),
      uptimeSec: Math.round(process.uptime()),
      now: new Date().toISOString(),
      memory: {
        rssMb: bytesToMb(memory.rss),
        heapUsedMb: bytesToMb(memory.heapUsed),
        heapTotalMb: bytesToMb(memory.heapTotal),
        externalMb: bytesToMb(memory.external),
        arrayBuffersMb: bytesToMb(memory.arrayBuffers || 0)
      },
      eventLoop: {
        lastLagMs: Math.round(this.lastLagMs),
        maxLagMs: Math.round(this.maxLagMs),
        lagWarnMs: this.lagWarnMs
      },
      requests: {
        active: activeRequests.length,
        activeOldest: activeRequests.slice(0, 10),
        totals: Object.assign({}, this.totals),
        slowRequestMs: this.slowRequestMs
      },
      recent: {
        slowRequests: this.recentSlowRequests.toJSON(),
        errors: this.recentErrors.toJSON(),
        lagEvents: this.recentLagEvents.toJSON()
      },
      snapshotFile: {
        path: SNAPSHOT_FILE,
        lastWrittenAt: this.lastSnapshotAt,
        lastError: this.lastSnapshotError
      },
      processReport: {
        directory: REPORT_DIR,
        signal: process.report && process.report.signal
      }
    };

    if (options.includeHandles)
      data.processHandles = getProcessHandles();
    return data;
  }

  writeSnapshot() {
    const payload = JSON.stringify(this.snapshot(), null, 2);
    fs.mkdir(path.dirname(SNAPSHOT_FILE), { recursive: true }, (mkdirErr) => {
      if (mkdirErr) {
        this.lastSnapshotError = mkdirErr.message;
        return;
      }
      fs.writeFile(SNAPSHOT_FILE, payload, (writeErr) => {
        if (writeErr) {
          this.lastSnapshotError = writeErr.message;
          return;
        }
        this.lastSnapshotAt = new Date().toISOString();
        this.lastSnapshotError = null;
      });
    });
  }

  _startLagSampler() {
    setInterval(() => {
      const now = Date.now();
      const lagMs = Math.max(0, now - this._lastTick - this.sampleMs);
      this._lastTick = now;
      this.lastLagMs = lagMs;
      if (lagMs > this.maxLagMs)
        this.maxLagMs = lagMs;
      if (lagMs >= this.lagWarnMs) {
        this.totals.lagEvents += 1;
        this.recentLagEvents.push({
          at: new Date().toISOString(),
          lagMs: Math.round(lagMs),
          activeRequests: this.activeRequests.size,
          memory: {
            rssMb: bytesToMb(process.memoryUsage().rss),
            heapUsedMb: bytesToMb(process.memoryUsage().heapUsed)
          }
        });
        this.writeSnapshot();
      }
    }, this.sampleMs).unref();
  }

  _startSnapshotWriter() {
    setInterval(() => {
      this.writeSnapshot();
    }, this.snapshotMs).unref();
  }

  _captureProcessEvents() {
    process.on('unhandledRejection', (reason) => {
      this.recentErrors.push({
        at: new Date().toISOString(),
        type: 'unhandledRejection',
        message: reason && reason.message ? reason.message : String(reason)
      });
      this.writeSnapshot();
    });
    process.on('uncaughtExceptionMonitor', (err) => {
      this.recentErrors.push({
        at: new Date().toISOString(),
        type: 'uncaughtException',
        message: err && err.message,
        name: err && err.name
      });
      this.writeSnapshot();
    });
  }

  _configureProcessReports() {
    if (!process.report)
      return;
    try {
      fs.mkdirSync(REPORT_DIR, { recursive: true });
      process.report.directory = REPORT_DIR;
      process.report.reportOnFatalError = true;
      process.report.reportOnSignal = true;
      process.report.reportOnUncaughtException = true;
      process.report.signal = process.env.HADITHDB_MONITOR_REPORT_SIGNAL || 'SIGUSR2';
    } catch (err) {
      this.lastSnapshotError = `process report setup failed: ${err.message}`;
    }
  }

  _countStatus(statusCode) {
    if (statusCode >= 500)
      this.totals.status5xx += 1;
    else if (statusCode >= 400)
      this.totals.status4xx += 1;
    else if (statusCode >= 300)
      this.totals.status3xx += 1;
    else if (statusCode >= 200)
      this.totals.status2xx += 1;
  }

  _safeUrl(url) {
    if (!url)
      return '';
    return String(url).replace(/([?&](?:token|key|password|secret|authorization)=)[^&]+/ig, '$1[redacted]');
  }

  _status() {
    if (this.lastLagMs >= this.lagWarnMs || this.activeRequests.size >= MAX_ACTIVE_REQUESTS)
      return 'degraded';
    return 'ok';
  }
}

function bytesToMb(value) {
  return Math.round((value / 1024 / 1024) * 10) / 10;
}

function getProcessHandles() {
  if (typeof process._getActiveHandles !== 'function')
    return [];
  return process._getActiveHandles().map(handle => {
    const name = handle && handle.constructor && handle.constructor.name;
    return name || typeof handle;
  }).reduce((counts, name) => {
    counts[name] = (counts[name] || 0) + 1;
    return counts;
  }, {});
}

module.exports = new AppMonitor();
