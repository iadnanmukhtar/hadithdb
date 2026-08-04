'use strict';

const express = require('express');
const translationsRouter = require('../routes/translations');

describe('Quran translation routes', () => {
  let server;
  let baseUrl;
  let originalSurahs;

  beforeAll(done => {
    originalSurahs = global.surahs;
    global.surahs = [{ num: 2, ayahs: 286 }];
    const app = express();
    app.use('/quran/translations', translationsRouter);
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      done();
    });
  });

  afterAll(done => {
    global.surahs = originalSurahs;
    server.close(done);
  });

  test('redirects slash references to the canonical Quran reference', async () => {
    const response = await fetch(`${baseUrl}/quran/translations/2/255?lang=en&view=compact`, {
      redirect: 'manual'
    });

    expect(response.status).toBe(301);
    expect(response.headers.get('location')).toBe('/quran/translations/quran:2:255?view=compact');
  });
});
