'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const v8 = require('node:v8');
const inspector = require('node:inspector');

const PREFIX = /^allocation-\d+-\d+\.json$/;
const MAX_FILES = 8;
const MAX_FILE_BYTES = 4 * 1024 * 1024;

function summarize(profile) {
  const entries = [];
  function visit(node, parents) {
    const frame = node.callFrame;
    const name = `${frame.functionName || '(anonymous)'} (${frame.url || '(native)'}:${frame.lineNumber + 1})`;
    const stack = [...parents, name].slice(-16);
    if (node.selfSize > 0) entries.push({ sampledBytes: node.selfSize, stack });
    for (const child of node.children || []) visit(child, stack);
  }
  visit(profile.head, []);
  return entries.sort((a, b) => b.sampledBytes - a.sampledBytes).slice(0, 20);
}

function start({ env = process.env, port = process.env.PORT, log = line => console.error(line),
  Session = inspector.Session, now = Date.now } = {}) {
  const ports = (env.HADITHDB_HEAP_PROFILE_PORTS || '').split(',').map(value => value.trim());
  if (!port || !ports.includes(String(port))) return null;
  const directory = env.HADITHDB_HEAP_PROFILE_DIR || path.join(os.homedir(), '.hadithdb', 'allocation-profiles');
  const session = new Session();
  let ready = false, stopped = false, pending = false, captures = 0, lastCapture = 0;
  const startedAt = now();
  let latestContext = null;
  let timer;
  const post = (method, params = {}) => new Promise((resolve, reject) => {
    session.post(method, params, (error, result) => error ? reject(error) : resolve(result));
  });
  function report(message) { log(`hadithdb:Allocation ${message}`); }
  function stop() {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    ready = false;
    // Disconnecting removes inspector state, including allocation sampling.
    session.disconnect();
  }
  async function capture(reason) {
    if (!ready || stopped || pending) return null;
    pending = true;
    try {
      const { profile } = await post('HeapProfiler.getSamplingProfile');
      if (stopped) return null;
      const timestamp = now();
      const artifact = {
        format: 'hadithdb-allocation-v1', timestamp: new Date(timestamp).toISOString(),
        pid: process.pid, port: String(port), reason,
        samplingIntervalBytes: 128 * 1024,
        context: latestContext, memory: process.memoryUsage(),
        heapSpaces: v8.getHeapSpaceStatistics(), topAllocations: summarize(profile), profile
      };
      const data = JSON.stringify(artifact);
      if (Buffer.byteLength(data) > MAX_FILE_BYTES) {
        report('capture skipped: profile exceeds 4 MiB artifact budget');
        lastCapture = timestamp;
        return null;
      }
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      fs.chmodSync(directory, 0o700);
      const filename = path.join(directory, `allocation-${timestamp}-${process.pid}.json`);
      // This directory is dedicated to these artifacts. Rotate across worker restarts.
      // One selected worker normally owns it; simultaneous workers may skip on races.
      const existing = fs.readdirSync(directory).filter(name => PREFIX.test(name)).sort();
      while (existing.length >= MAX_FILES) {
        try { fs.unlinkSync(path.join(directory, existing.shift())); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      fs.writeFileSync(filename, data, { mode: 0o600, flag: 'wx' });
      captures++;
      lastCapture = timestamp;
      report(JSON.stringify({ event: 'captured', reason, pid: process.pid, file: filename,
        heapUsed: artifact.memory.heapUsed, topAllocationBytes: artifact.topAllocations[0]?.sampledBytes || 0 }));
      return filename;
    } catch (error) {
      // Disk/profiler errors must not bring down the application or spam every tick.
      lastCapture = now();
      report(`capture failed: ${error.code || error.name || 'Error'}`);
      return null;
    } finally { pending = false; }
  }
  function tick() {
    if (!ready || stopped) return;
    const elapsed = now() - startedAt;
    if (elapsed >= 15 * 60 * 1000 || captures >= MAX_FILES) {
      report('sampling stopped: bounded capture window complete');
      stop();
      return;
    }
    if (elapsed < 30000 || (lastCapture && now() - lastCapture < 30000)) return;
    const heapUsed = process.memoryUsage().heapUsed;
    // Save evidence before the 384 MiB old-space limit, not during fatal OOM.
    const pressure = heapUsed >= Math.min(256 * 1024 * 1024, v8.getHeapStatistics().heap_size_limit * 0.60);
    if (pressure || captures === 0 || now() - lastCapture >= 120000)
      void capture(pressure ? 'heap-pressure' : 'checkpoint');
  }
  try {
    session.connect();
    // Collected objects are excluded: the profile attributes surviving allocations.
    void post('HeapProfiler.startSampling', { samplingInterval: 128 * 1024,
      includeObjectsCollectedByMajorGC: false, includeObjectsCollectedByMinorGC: false
    }).then(() => {
      if (stopped) return;
      ready = true;
      report(JSON.stringify({ event: 'sampling-started', pid: process.pid, port: String(port), directory }));
    }).catch(error => {
      report(`sampling unavailable: ${error.code || error.name || 'Error'}`);
      stop();
    });
    timer = setInterval(tick, 5000);
    timer.unref();
  } catch (error) {
    report(`sampling unavailable: ${error.code || error.name || 'Error'}`);
    stop();
  }
  return { observe(context) { latestContext = context; }, capture, stop };
}
module.exports = { start, summarize };
