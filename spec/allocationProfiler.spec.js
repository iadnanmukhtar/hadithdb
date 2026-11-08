const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { start } = require('../lib/AllocationProfiler');

const profile = { head: { selfSize: 0, callFrame: { functionName: '(root)', url: '', lineNumber: -1 },
  children: [{ selfSize: 4096, callFrame: { functionName: 'retainedWork', url: 'file:///app/work.js', lineNumber: 9 }, children: [] }] }, samples: [] };
class FakeSession {
  connect() {}
  disconnect() {}
  post(method, params, callback) { callback(null, method.endsWith('getSamplingProfile') ? { profile } : {}); }
}
const settle = () => new Promise(resolve => setImmediate(resolve));
describe('allocation evidence capture', () => {
  let directory, profiler;
  beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hadith-allocation-')); });
  afterEach(() => {
    profiler?.stop();
    jest.useRealTimers();
    jest.restoreAllMocks();
    profiler = null;
    fs.rmSync(directory, { recursive: true, force: true });
  });
  test('disabled or unselected workers never attach an inspector', () => {
    const Session = jest.fn();
    expect(start({ env: {}, port: '3005', Session })).toBeNull();
    expect(start({ env: { HADITHDB_HEAP_PROFILE_PORTS: '3005' }, port: '3004', Session })).toBeNull();
    expect(Session).not.toHaveBeenCalled();
  });
  test('captures allocation stacks and counters in restricted, rotating files', async () => {
    let time = 1700000000000;
    profiler = start({ env: { HADITHDB_HEAP_PROFILE_PORTS: '3005', HADITHDB_HEAP_PROFILE_DIR: directory },
      port: '3005', Session: FakeSession, now: () => ++time, log: () => {} });
    profiler.observe({ http: { active: 7 }, mysql: { queued: 0 } });
    await settle();
    let filename;
    for (let i = 0; i < 10; i++) filename = await profiler.capture('heap-pressure');
    expect(fs.readdirSync(directory)).toHaveLength(8);
    const data = JSON.parse(fs.readFileSync(filename, 'utf8'));
    expect(data.context.http.active).toBe(7);
    expect(data.profile).toEqual(profile);
    expect(data.topAllocations[0].stack.join('\n')).toContain('retainedWork (file:///app/work.js:10)');
    expect(fs.statSync(directory).mode & 0o777).toBe(0o700);
    expect(fs.statSync(filename).mode & 0o777).toBe(0o600);
  });
  test('disk failures cannot reject into application code', async () => {
    const blocked = path.join(directory, 'file');
    fs.writeFileSync(blocked, 'not a directory');
    profiler = start({ env: { HADITHDB_HEAP_PROFILE_PORTS: '3005', HADITHDB_HEAP_PROFILE_DIR: blocked },
      port: '3005', Session: FakeSession, log: () => {} });
    await settle();
    await expect(profiler.capture('checkpoint')).resolves.toBeNull();
  });
  test('pressure checks respect cooldown and stop at the capture budget', async () => {
    jest.useFakeTimers();
    jest.spyOn(require('node:v8'), 'getHeapStatistics').mockReturnValue({ heap_size_limit: 1 });
    profiler = start({ env: { HADITHDB_HEAP_PROFILE_PORTS: '3005', HADITHDB_HEAP_PROFILE_DIR: directory },
      port: '3005', Session: FakeSession, log: () => {} });
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(30000);
    expect(fs.readdirSync(directory)).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(25000);
    expect(fs.readdirSync(directory)).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(5000);
    expect(fs.readdirSync(directory)).toHaveLength(2);
    await jest.advanceTimersByTimeAsync(300000);
    expect(fs.readdirSync(directory)).toHaveLength(8);
    expect(jest.getTimerCount()).toBe(0);
  });
  test('captures a real V8 sampling profile without opening a debugger port', async () => {
    profiler = start({ env: { HADITHDB_HEAP_PROFILE_PORTS: '3005', HADITHDB_HEAP_PROFILE_DIR: directory },
      port: '3005', log: () => {} });
    await settle();
    const retained = Array.from({ length: 10000 }, (_, i) => ({ i, text: 'allocation-' + i }));
    const filename = await profiler.capture('checkpoint');
    expect(filename).toBeTruthy();
    const data = JSON.parse(fs.readFileSync(filename, 'utf8'));
    expect(data.profile.head.callFrame).toBeDefined();
    expect(data.heapSpaces.length).toBeGreaterThan(0);
    expect(retained.length).toBe(10000);
  });
});
