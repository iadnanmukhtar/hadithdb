'use strict';

const express = require('express');
const HttpRange = require('../lib/HttpRange');
const searchRouter = require('../routes/search');

describe('HTTP range errors', () => {
  test('describes the available length for an unsatisfied Quran range', () => {
    const error = HttpRange.notSatisfiable('quran-pages', 604, 'Mushaf page 605 is out of range');

    expect(error.status).toBe(416);
    expect(error.message).toBe('Mushaf page 605 is out of range');
    expect(error.headers).toEqual({
      'Accept-Ranges': 'quran-pages',
      'Content-Range': 'quran-pages */604'
    });
  });
});

describe('Hadith route status errors', () => {
  let server;
  let baseUrl;
  let originalBooks;
  let originalSurahs;

  beforeAll(done => {
    originalBooks = global.books;
    originalSurahs = global.surahs;
    global.books = [
      { alias: 'tabarani', hidden: 0 },
      { alias: 'quran', hidden: 0 }
    ];
    global.surahs = [{ num: 2, ayahs: 286 }];

    const app = express();
    app.use(searchRouter);
    app.use((err, req, res, next) => {
      res.status(err.status || 500).send(err.message);
    });
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      done();
    });
  });

  afterAll(done => {
    global.books = originalBooks;
    global.surahs = originalSurahs;
    server.close(done);
  });

  test.each([
    ['/tabarani/10/0', 'Hadith section tabarani/10/0 not found'],
    ['/tabarani/10/0/1', 'Hadith section tabarani/10/0 not found'],
    ['/tabarani/10/1/0', 'Hadith subsection tabarani/10/1/0 not found']
  ])('returns Gone for the numeric missing Hadith heading %s', async (path, message) => {
    const response = await fetch(`${baseUrl}${path}`);

    expect(response.status).toBe(410);
    expect(await response.text()).toBe(message);
  });

  test.each([
    '/tabarani/10/not-a-section',
    '/tabarani/10/1/not-a-subsection'
  ])('retains Bad Request for the malformed Hadith heading %s', async path => {
    const response = await fetch(`${baseUrl}${path}`);

    expect(response.status).toBe(400);
  });

  test.each([
    '/removed-book',
    '/removed-book/random',
    '/removed-book.json',
    '/removed-book:0',
    '/removed-book/10',
    '/removed-book/10/0',
    '/removed-book/10/0/1',
    '/removed-book/10/not-a-section',
    '/removed-book/10/1/not-a-subsection'
  ])('returns Not Found whenever the book alias does not exist: %s', async path => {
    const response = await fetch(`${baseUrl}${path}`);

    expect(response.status).toBe(404);
  });

  test('does not apply the Hadith zero-heading rule to Quran routes', async () => {
    const response = await fetch(`${baseUrl}/quran/2/0`);

    expect(response.status).toBe(400);
  });
});
