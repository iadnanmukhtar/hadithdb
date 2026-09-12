'use strict';
const express = require('express');
jest.mock('axios', () => ({ post: jest.fn() }));
const axios = require('axios');

describe('retired website ChatKit endpoint', () => {
  let server, base;
  const original = global.settings;
  beforeAll(async () => {
    // Even old production settings must not reactivate API-funded chat.
    global.settings = { openAI: { key: 'private-test-key', chatkit: {
      enabled: true, secret: 'private-test-secret', domainKey: 'public-test-key'
    } } };
    const app = express();
    app.use(express.json());
    const route = require('../routes/chatkit');
    app.use('/api/chatkit', route);
    app.use('/quran/api/chatkit', route);
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  afterAll(async () => {
    global.settings = original;
    await new Promise(resolve => server.close(resolve));
  });
  test.each(['/api/chatkit', '/quran/api/chatkit'])('disables cached clients at %s', async endpoint => {
    const response = await fetch(`${base}${endpoint}/config`);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ enabled: false, configured: false, domainKey: '', handoffEnabled: true });
  });
  test('hides the handoff when disabled or missing', async () => {
    const settings = global.settings;
    try {
      for (const value of [false, undefined]) {
        global.settings = { openAI: { chatkit: { enabled: value } } };
        const response = await fetch(`${base}/api/chatkit/config`);
        expect((await response.json()).handoffEnabled).toBe(false);
      }
    } finally { global.settings = settings; }
  });
  test.each(['/api/chatkit', '/quran/api/chatkit'])('never forwards requests at %s', async endpoint => {
    const response = await fetch(`${base}${endpoint}`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: base },
      body: JSON.stringify({ type: 'threads.create', params: {} }) });
    expect(response.status).toBe(410);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(await response.text()).not.toContain('private-test');
    expect(axios.post).not.toHaveBeenCalled();
  });
});
