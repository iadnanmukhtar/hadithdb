'use strict';
const express = require('express');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const { Readable } = require('stream');
jest.mock('axios', () => ({ post: jest.fn() }));
const axios = require('axios');

describe('guest ChatKit proxy', () => {
  let server, base;
  const original = global.settings;
  beforeAll(async () => {
    global.settings = { openAI: { chatkit: { secret: 'test-secret', domainKey: 'public-test-key' } } };
    const app = express();
    app.use(express.json({ limit: '1mb' }), cookieParser());
    app.use('/api/chatkit', require('../routes/chatkit'));
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  afterAll(async () => {
    global.settings = original;
    await new Promise(resolve => server.close(resolve));
  });
  beforeEach(() => {
    axios.post.mockReset().mockImplementation(async () => ({ status: 200,
      headers: { 'content-type': 'text/event-stream' }, data: Readable.from(['data: {"ok":true}\n\n']) }));
  });
  const payload = { type: 'threads.list', params: {} };
  function post(body = payload, headers = {}) {
    return fetch(`${base}/api/chatkit`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: base, ...headers }, body: JSON.stringify(body) });
  }
  test('exposes only publishable configuration', async () => {
    const response = await fetch(`${base}/api/chatkit/config`);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ enabled: true, configured: true, domainKey: 'public-test-key' });
  });
  test('rejects cross-origin requests before creating a session or contacting the service', async () => {
    const response = await post(payload, { Origin: 'https://untrusted.example' });
    expect(response.status).toBe(403);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(axios.post).not.toHaveBeenCalled();
  });
  test('signs the guest identity and exact body and streams without buffering', async () => {
    const response = await post();
    expect(response.status).toBe(200);
    expect(response.headers.get('x-accel-buffering')).toBe('no');
    expect(await response.text()).toContain('data:');
    const cookie = response.headers.get('set-cookie');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    const [, body, options] = axios.post.mock.calls[0];
    const h = options.headers;
    expect(h['X-ChatKit-Signature']).toBe(crypto.createHmac('sha256', 'test-secret')
      .update(`${h['X-ChatKit-Time']}\n${h['X-ChatKit-User']}\n${body}`).digest('hex'));
    const again = await post(payload, { Cookie: cookie.split(';')[0] });
    await again.text();
    expect(axios.post.mock.calls[1][2].headers['X-ChatKit-User']).toBe(h['X-ChatKit-User']);
    const forged = await post(payload, { Cookie: cookie.split(';')[0].replace(/.$/, 'x') });
    await forged.text();
    expect(axios.post.mock.calls[2][2].headers['X-ChatKit-User']).not.toBe(h['X-ChatKit-User']);
  });
  test('limits input and hides internal service failures', async () => {
    expect((await post({ text: 'x'.repeat(33000) })).status).toBe(413);
    expect(axios.post).not.toHaveBeenCalled();
    axios.post.mockRejectedValueOnce(new Error('secret internal error'));
    const response = await post();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('secret');
  });
});
