'use strict';

const express = require('express');
const LocalAuth = require('../lib/LocalAuth');
const Books = require('../lib/Books');
const Utils = require('../lib/Utils');

describe('book download access', () => {
  let server, origin;
  const original = { settings: global.settings, books: global.books, query: global.query };

  beforeAll(async () => {
    global.settings = { site: {}, sessionSecret: 'fixture-secret', bookDownloads: { adminOnly: true } };
    global.books = [{ id: 1, alias: 'sample', hidden: 0, type: 'hadith' }];
    global.query = jest.fn().mockResolvedValue([]);
    jest.spyOn(Books, 'ensureBookContentLastmodColumn').mockResolvedValue();
    jest.spyOn(Utils, 'diskCacheEnabled').mockReturnValue(false);
    jest.spyOn(require('../lib/UserSettings'), 'isAdminUser').mockImplementation(async uid => uid === 'admin');
    const app = express();
    app.use(require('cookie-parser')());
    app.use('/admin', require('../routes/admin'));
    app.use('/sharh', require('../routes/sharh'));
    app.use('/quran/tafsir', require('../routes/tafsirs'));
    app.use(require('../routes/search'));
    server = await new Promise(resolve => {
      const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    origin = 'http://127.0.0.1:' + server.address().port;
  });

  afterAll(async () => {
    await new Promise(resolve => server.close(resolve));
    Object.assign(global, original);
    jest.restoreAllMocks();
  });

  const bearer = uid => ({ Authorization: 'Bearer ' + LocalAuth.signUser({ uid }) });

  test.each(['/sample.json', '/sample.epub', '/sample?json', '/sample?download&epub',
    '/sharh/sample.epub', '/quran/translation.json', '/quran/tafsir/sample.epub'])(
    'requires verified admin membership before loading %s', async path => {
      global.query.mockClear();
      const guest = await fetch(origin + path, { headers: { Cookie: 'editMode=1; admin=1' } });
      expect(guest.status).toBe(401);
      const member = await fetch(origin + path, { headers: bearer('member') });
      expect(member.status).toBe(403);
      expect(member.headers.get('cache-control')).toContain('no-store');
      expect(global.query).not.toHaveBeenCalled();
    });

  test('admin bearer and scoped browser session can download the same attachment', async () => {
    const api = await fetch(origin + '/sample.json', { headers: bearer('admin') });
    expect(api.status).toBe(200);
    const session = await fetch(origin + '/admin/session', { method: 'POST', headers: bearer('admin') });
    expect(session.status).toBe(200);
    const cookie = session.headers.get('set-cookie').split(';')[0];
    const browser = await fetch(origin + '/admin/downloads/sample.json', { headers: { Cookie: cookie } });
    expect(browser.status).toBe(200);
    expect(browser.headers.get('content-disposition')).toContain('hadithunlocked_sample.json');
    expect(browser.headers.get('cache-control')).toContain('no-store');
    expect(await browser.json()).toEqual(await api.json());
  });

  test('public access is the default when the flag is absent', async () => {
    delete global.settings.bookDownloads;
    try {
      const publicBook = await fetch(origin + '/sample.json');
      expect(publicBook.status).toBe(200);
      expect(publicBook.headers.get('content-disposition')).toContain('attachment');
    } finally {
      global.settings.bookDownloads = { adminOnly: true };
    }
  });
});
