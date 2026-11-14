'use strict';

const v8 = require('node:v8');
const { PerformanceObserver, constants } = require('node:perf_hooks');
const AllocationProfiler = require('./AllocationProfiler');

// Fixed-size counters only: never retain requests, URLs, response bodies or SQL.
function start({ intervalMs = 30000, log = line => console.error(line), axios } = {}) {
  // Disable the diagnostics entirely, including timers, hooks and allocation profiling.
  if (/^(false|0|off)$/i.test((process.env.MEMORY_LOG || '').trim())) {
    return { attach() {}, sample() {}, stop() {} };
  }
  const allocationProfiler = AllocationProfiler.start({ log });
  const http = { active: 0, peak: 0, completed: 0, closedEarly: 0 };
  const outbound = { active: 0, peak: 0, completed: 0, failed: 0 };
  const gc = { count: 0, major: 0, durationMs: 0 };
  let lastMajor = null;
  const observer = new PerformanceObserver(list => {
    for (const entry of list.getEntries()) {
      gc.count++;
      gc.durationMs += entry.duration;
      if (entry.detail.kind === constants.NODE_PERFORMANCE_GC_MAJOR) {
        gc.major++;
        // This is sampled after notification, not an exact post-GC heap floor.
        lastMajor = { uptimeSeconds: Math.round(process.uptime()), heapUsed: process.memoryUsage().heapUsed };
      }
    }
  });
  observer.observe({ entryTypes: ['gc'] });
  const attached = new WeakSet();
  function attach(server) {
    if (attached.has(server)) return;
    attached.add(server);
    server.prependListener('request', (req, res) => {
      http.active++;
      http.peak = Math.max(http.peak, http.active);
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        http.active--;
        http.completed++;
        if (!res.writableFinished) http.closedEarly++;
        res.removeListener('finish', finish);
        res.removeListener('close', finish);
      };
      res.once('finish', finish);
      res.once('close', finish);
    });
  }
  const marker = '__hadithdbMemoryTracked';
  let requestInterceptor, responseInterceptor;
  if (axios) {
    requestInterceptor = axios.interceptors.request.use(config => {
      config[marker] = true;
      outbound.active++;
      outbound.peak = Math.max(outbound.peak, outbound.active);
      return config;
    });
    const finish = (config, failed) => {
      if (!config || !config[marker]) return;
      delete config[marker];
      outbound.active--;
      outbound.completed++;
      if (failed) outbound.failed++;
    };
    responseInterceptor = axios.interceptors.response.use(response => {
      finish(response.config, false);
      return response;
    }, error => {
      finish(error.config, true);
      return Promise.reject(error);
    });
  }
  function sample() {
    const memory = process.memoryUsage();
    const pool = global.dbPool;
    const utils = global.utils;
    const size = value => value instanceof Map || value instanceof Set ? value.size : Array.isArray(value) ? value.length : null;
    const caches = {};
    for (const name of ['books', 'bookCatalog', 'booksByModel', 'commentaries', 'commentariesByAlias', 'tafsirFirstPassages'])
      caches[name] = size(global[name]);
    const row = {
      timestamp: new Date().toISOString(), pid: process.pid, port: process.env.PORT,
      uptimeSeconds: Math.round(process.uptime()), memory,
      heapLimit: v8.getHeapStatistics().heap_size_limit,
      http: { ...http }, outbound: { ...outbound }, gc: { ...gc }, lastMajor,
      mysql: pool ? { total: pool._allConnections?.length, free: pool._freeConnections?.length, queued: pool._connectionQueue?.length, acquiring: pool._acquiringConnections?.length } : null,
      cacheMaintenance: Boolean(utils?.CACHE_MAINTENANCE_PENDING), caches,
      modules: Object.keys(require.cache).length
    };
    allocationProfiler?.observe(row);
    log('hadithdb:Memory ' + JSON.stringify(row));
    http.peak = http.active;
    outbound.peak = outbound.active;
    return row;
  }
  const timer = setInterval(sample, intervalMs);
  timer.unref();
  sample();
  return { attach, sample, stop() {
    clearInterval(timer);
    allocationProfiler?.stop();
    observer.disconnect();
    if (axios) {
      axios.interceptors.request.eject(requestInterceptor);
      axios.interceptors.response.eject(responseInterceptor);
    }
  } };
}
module.exports = { start };
