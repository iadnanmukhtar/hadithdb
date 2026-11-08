'use strict';

jest.mock('axios', () => ({ get: jest.fn(), post: jest.fn() }));
let SearchHttp;
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
let previousSettings;
beforeEach(() => {
  jest.useFakeTimers();
  jest.resetModules();
  // Use the same mock instance as the freshly loaded client.
  SearchHttp = require('../lib/SearchHttp');
  previousSettings = global.settings;
  global.settings = { search: { maxConcurrency: 1, maxQueue: 2, httpTimeoutMs: 100 } };
});
afterEach(() => {
  global.settings = previousSettings;
  jest.useRealTimers();
});
const mock = () => require('axios');

test('finite defaults and explicit bulk timeout preserve authentication', () => {
  global.settings.search = { username: 'reader', password: 'secret' };
  expect(SearchHttp.axiosConfig()).toMatchObject({ timeout: 10000, auth: { username: 'reader', password: 'secret' } });
  for (const timeout of [0, -1, Infinity, NaN, 'invalid'])
    expect(SearchHttp.axiosConfig({ timeout }).timeout).toBe(10000);
  expect(SearchHttp.axiosConfig({ timeout: 120000 }).timeout).toBe(120000);
});

test('bounds active work, rejects overflow, and advances FIFO after errors', async () => {
  let fail;
  mock().get.mockImplementationOnce(() => new Promise((resolve, reject) => { fail = reject; }))
    .mockResolvedValue({ data: 'ok' });
  const first = SearchHttp.get('/one').catch(error => error);
  const second = SearchHttp.get('/two');
  const third = SearchHttp.get('/three');
  await expect(SearchHttp.get('/overflow')).rejects.toMatchObject({ code: 'ESEARCHBUSY', status: 503 });
  expect(mock().get).toHaveBeenCalledTimes(1);
  fail(new Error('connection failed'));
  expect((await first).message).toBe('connection failed');
  await expect(second).resolves.toEqual({ data: 'ok' });
  await expect(third).resolves.toEqual({ data: 'ok' });
  expect(mock().get.mock.calls.map(call => call[0])).toEqual(['/one', '/two', '/three']);
});

test('queued expiry removes work without ever issuing HTTP', async () => {
  let release;
  mock().get.mockImplementationOnce(() => new Promise(resolve => { release = resolve; })).mockResolvedValue({});
  const first = SearchHttp.get('/active', { timeout: 1000 });
  const queued = SearchHttp.get('/expired').catch(error => error);
  await flush();
  await jest.advanceTimersByTimeAsync(100);
  expect(await queued).toMatchObject({ code: 'ECONNABORTED' });
  release({});
  await first;
  await flush();
  expect(mock().get).toHaveBeenCalledTimes(1);
  await SearchHttp.get('/next');
  expect(mock().get).toHaveBeenCalledTimes(2);
});

test('wall-clock deadline aborts transport and retains slot until transport settles', async () => {
  let release;
  mock().get.mockImplementationOnce(() => new Promise(resolve => { release = resolve; })).mockResolvedValue({});
  const active = SearchHttp.get('/stalled').catch(error => error);
  const next = SearchHttp.get('/next', { timeout: 1000 });
  await flush();
  const config = mock().get.mock.calls[0][1];
  await jest.advanceTimersByTimeAsync(100);
  expect(await active).toMatchObject({ code: 'ECONNABORTED' });
  expect(config.signal.aborted).toBe(true);
  expect(mock().get).toHaveBeenCalledTimes(1);
  release({});
  await next;
  expect(mock().get.mock.calls[1][1].timeout).toBe(900);
});

test('caller cancellation removes queued requests and aborts active requests', async () => {
  mock().get.mockImplementation((url, config) => new Promise((resolve, reject) => {
    config.signal.addEventListener('abort', () => reject(new Error('aborted')));
  }));
  const runningController = new AbortController();
  const queuedController = new AbortController();
  const running = SearchHttp.get('/active', { signal: runningController.signal }).catch(error => error);
  const queued = SearchHttp.get('/queued', { signal: queuedController.signal }).catch(error => error);
  await flush();
  queuedController.abort();
  runningController.abort();
  expect(await queued).toMatchObject({ code: 'ERR_CANCELED' });
  expect(await running).toMatchObject({ code: 'ERR_CANCELED' });
  await flush();
  expect(mock().get).toHaveBeenCalledTimes(1);
  const already = new AbortController();
  already.abort();
  await expect(SearchHttp.get('/never', { signal: already.signal })).rejects.toMatchObject({ code: 'ERR_CANCELED' });
  expect(mock().get).toHaveBeenCalledTimes(1);
});
