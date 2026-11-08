'use strict';
jest.mock('axios', () => ({ post: jest.fn() }));
jest.mock('../lib/Debug', () => {
  const debug = Object.assign(jest.fn(), { error: jest.fn(), slow: jest.fn() });
  return () => debug;
});
const axios = require('axios');
const Index = require('../lib/Index');
const debug = require('../lib/Debug')();
let previousSettings;
beforeEach(() => {
  previousSettings = global.settings;
  jest.useFakeTimers();
  jest.clearAllMocks();
  global.settings = { search: { domain: 'http://es.test', queryTimeoutMs: 5000 } };
  axios.post.mockResolvedValue({ status: 200, data: { hits: { total: { value: 0 }, hits: [] } } });
});
afterEach(() => { global.settings = previousSettings; jest.useRealTimers(); });
test.each([
  [5000, undefined, '5s', 10000],
  [5000, 30000, '5s', 30000],
  [20000, 10000, '20s', 25000],
  [5500, 10000, '6s', 11000],
  [undefined, 15000, undefined, 15000]
])('query limit %s and HTTP setting %s keep transport headroom', async (queryTimeoutMs, httpTimeoutMs, queryLimit, httpDeadline) => {
  Object.assign(global.settings.search, { queryTimeoutMs, httpTimeoutMs });
  await Index.docsFromQuery('toc', { match_all: {} }, 0, 1);
  const [, payload, config] = axios.post.mock.calls[0];
  expect(JSON.parse(payload).timeout).toBe(queryLimit);
  expect(config.timeout).toBe(httpDeadline);
});
test('HTTP timeouts log the HTTP budget once at the Index layer', async () => {
  axios.post.mockRejectedValue(Object.assign(new Error('Elasticsearch HTTP deadline exceeded'), { code: 'ECONNABORTED' }));
  await expect(Index.docsFromQuery('toc', { match_all: {} }, 0, 1)).rejects.toMatchObject({ status: 503 });
  expect(debug.error).toHaveBeenCalledTimes(1);
  expect(debug.error.mock.calls[0][0]).toContain('timeoutMs=10000');
  expect(debug.error.mock.calls[0][0]).toContain('queryTimeoutMs=5000');
});
