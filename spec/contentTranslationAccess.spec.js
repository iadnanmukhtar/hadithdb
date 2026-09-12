'use strict';

const PaymentConfig = require('../lib/PaymentConfig');
const ContentTranslations = require('../lib/ContentTranslations');
const UserPoints = require('../lib/UserPoints');

describe('admin-only content translations', () => {
  const originalSettings = global.settings;
  afterEach(() => {
    global.settings = originalSettings;
    jest.restoreAllMocks();
  });

  test('disables billing while allowing translations without Stripe', () => {
    global.settings = { payments: { content: { adminOnly: true } } };
    expect(PaymentConfig.isEnabled()).toBe(false);
    expect(PaymentConfig.contentTranslationsEnabled()).toBe(true);
    expect(ContentTranslations.estimatePoints({ fields: { body: 'Arabic source text' } }, 'translate')).toBe(0);
  });

  test.each([null, { uid: 'reader' }, { uid: 'reader', admin: false }, { uid: 'reader', admin: 'true' }])('rejects non-admin generation and estimates before database work: %j', async user => {
    global.settings = { payments: { content: { adminOnly: true } } };
    const ensure = jest.spyOn(UserPoints, 'ensureUser');
    await expect(ContentTranslations.translate(user, 'hadith', '1', 'en')).rejects.toMatchObject({ status: 403 });
    await expect(ContentTranslations.estimate(user, 'hadith', '1', 'en')).rejects.toMatchObject({ status: 403 });
    expect(ensure).not.toHaveBeenCalled();
  });

  test('admits an authenticated admin to the translation pipeline', async () => {
    global.settings = { payments: { content: { adminOnly: true } } };
    const sentinel = new Error('Reached database');
    jest.spyOn(UserPoints, 'ensureUser').mockRejectedValue(sentinel);
    await expect(ContentTranslations.translate({ uid: 'admin', admin: true }, 'hadith', '1', 'en')).rejects.toBe(sentinel);
  });

  test('restores existing paid behavior when the flag is off', () => {
    global.settings = { payments: { enabled: true, stripe: { secretKey: 'sk_live_example' }, content: { adminOnly: false } } };
    expect(PaymentConfig.isEnabled()).toBe(true);
    expect(ContentTranslations.estimatePoints({ fields: { body: 'Arabic source text' } }, 'translate')).toBeGreaterThan(0);
  });
});

describe('admin-only translation HTTP endpoints', () => {
  const express = require('express');
  const GoogleAuth = require('../lib/GoogleAuth');
  const UserSettings = require('../lib/UserSettings');
  const originalSettings = global.settings;
  let server;
  let base;

  beforeEach(async () => {
    global.settings = { payments: { content: { adminOnly: true } } };
    jest.spyOn(GoogleAuth, 'verifyRequest').mockResolvedValue({ uid: 'reader' });
    jest.spyOn(UserSettings, 'isAdminUser').mockResolvedValue(false);
    const app = express();
    app.use(express.json());
    app.use('/payments', require('../routes/payments'));
    app.use('/content-translations', require('../routes/contentTranslations'));
    app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));
    server = await new Promise(resolve => {
      const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    base = `http://127.0.0.1:${server.address().port}`;
  });

  afterEach(async () => {
    await new Promise(resolve => server.close(resolve));
    global.settings = originalSettings;
    jest.restoreAllMocks();
  });

  test('blocks a reader POST and disables payment checkout and summary', async () => {
    const response = await fetch(`${base}/content-translations`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemType: 'hadith', itemId: '1', targetLanguage: 'en' })
    });
    expect(response.status).toBe(403);
    expect((await fetch(`${base}/content-translations/estimate?itemType=hadith&itemId=1&targetLanguage=en`)).status).toBe(403);
    expect((await fetch(`${base}/payments/summary`)).status).toBe(503);
    expect((await fetch(`${base}/payments/checkout`, { method: 'POST' })).status).toBe(503);
    const config = await (await fetch(`${base}/payments/config`)).json();
    expect(config.enabled).toBe(false);
    expect(config.packages).toEqual([]);
  });

  test('keeps existing translations publicly readable', async () => {
    jest.spyOn(ContentTranslations, 'available').mockResolvedValue({ translations: [{ code: 'en' }] });
    const response = await fetch(`${base}/content-translations/available?itemType=hadith&itemId=1`);
    expect(response.status).toBe(200);
    expect((await response.json()).translations).toEqual([{ code: 'en' }]);
  });
});
