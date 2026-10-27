'use strict';

const express = require('express');
const http = require('http');
const decodeRequestPath = require('../lib/DecodeRequestPath');

describe('application request path decoding', () => {
  let server;

  beforeAll(done => {
    const app = express();
    app.use(decodeRequestPath);
    app.get('/quran/tafsir/:tafsir/quran\\::surah\\::ayah', (req, res) => {
      res.json({ params: req.params, query: req.query, originalUrl: req.originalUrl });
    });
    app.get('/bukhari\\::id', (req, res) => res.json(req.params));
    app.all('/api/value/:value', (req, res) => {
      res.json({ value: req.params.value, path: req.path, query: req.query });
    });
    app.use((error, req, res, next) => res.status(error.status || 500).json({ message: error.message }));
    server = app.listen(0, '127.0.0.1', done);
    server.once('error', done);
  });

  afterAll(done => {
    if (server.listening)
      server.close(done);
    else
      done();
  });

  function request(path, method = 'GET') {
    return new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path, method }, res => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
      });
      req.on('error', reject);
      req.end();
    });
  }

  test.each(['quran%3A3%3A54', 'quran%3a3%3a54', 'quran:3:54'])('matches tafsir routes for %s', async reference => {
    const path = `/quran/tafsir/mokhtasar/${reference}?ref=quran%3A3%3A54&literal=%253A`;
    const response = await request(path);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      params: { tafsir: 'mokhtasar', surah: '3', ayah: '54' },
      query: { ref: 'quran:3:54', literal: '%3A' },
      originalUrl: path
    });
  });

  test('decodes fixed route names and hadith references across the app', async () => {
    expect(await request('/%62ukhari%3A1')).toEqual({ status: 200, body: { id: '1' } });
  });

  test.each(['GET', 'POST', 'PUT', 'DELETE'])('decodes API paths for %s', async method => {
    const response = await request('/%61pi/value/name%3A1', method);
    expect(response.status).toBe(200);
    expect(response.body.value).toBe('name:1');
  });

  test.each([
    ['a%2Fb', 'a/b', 'a%2Fb'],
    ['a%3Fb', 'a?b', 'a%3Fb'],
    ['a%23b', 'a#b', 'a%23b'],
    ['a%5Cb', 'a\\b', 'a%5Cb'],
    ['%253A', '%3A', '%253A'],
    ['100%25', '100%', '100%25'],
    ['two%20words', 'two words', 'two%20words'],
    ['%0D%0A', '\r\n', '%0D%0A'],
    [encodeURIComponent('تفسير'), 'تفسير', 'تفسير']
  ])('preserves parameter meaning for %s', async (encoded, value, normalized) => {
    const response = await request(`/api/value/${encoded}?q=a%26b%3Dc&plus=a+b`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ value, path: `/api/value/${normalized}`, query: { q: 'a&b=c', plus: 'a b' } });
  });

  test.each(['%', '%2', '%GG', '%C3%28', '%FF'])('returns 400 for malformed encoding %s', async encoded => {
    expect(await request(`/api/value/${encoded}`)).toEqual({
      status: 400, body: { message: 'Malformed URL path encoding' }
    });
  });
});
