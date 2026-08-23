'use strict';

const express = require('express');
const { mountInfiniteScrollApiRoutes } = require('../lib/InfiniteScrollApiRoutes');

describe('infinite-scroll API route mounts', () => {
  let server;
  let baseUrl;

  beforeAll(done => {
    const app = express();
    const blogRouter = express.Router();
    const tafsirRouter = express.Router();
    const searchRouter = express.Router();

    blogRouter.get('/', (req, res) => {
      res.send('<main data-blog-infinite="1"></main>');
    });
    tafsirRouter.get('/:tafsir/quran\::surah\::start', (req, res) => {
      res.send('<main data-reader-infinite="tafsir"></main>');
    });
    searchRouter.get('/bukhari/1/2', (req, res) => {
      res.send('<main data-reader-infinite="hadith-section"></main>');
    });
    searchRouter.get('/quran/4/5', (req, res) => {
      res.send('<main data-quran-infinite-passage="1"></main>');
    });
    searchRouter.get('/quran/page/2', (req, res) => {
      res.send(`<main data-quran-mushaf-reader data-memorize="${Object.prototype.hasOwnProperty.call(req.query, 'memorize')}"></main>`);
    });
    searchRouter.get('/', (req, res) => {
      res.send('<main data-search-infinite="1" data-search-scope="hadith"></main>');
    });
    searchRouter.get('/quran', (req, res) => {
      res.send('<main data-search-infinite="1" data-search-scope="quran"></main>');
    });

    mountInfiniteScrollApiRoutes(app, { blogRouter, tafsirRouter, searchRouter });
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      done();
    });
  });

  afterAll(done => {
    server.close(done);
  });

  test.each([
    ['/api/blog', 'data-blog-infinite="1"'],
    ['/api/bukhari/1/2', 'data-reader-infinite="hadith-section"'],
    ['/quran/api/4/5', 'data-quran-infinite-passage="1"'],
    ['/quran/api/page/2', 'data-quran-mushaf-reader'],
    ['/quran/api/tafsir/maududi/quran:4:29', 'data-reader-infinite="tafsir"'],
    ['/api/?q=faith&o=100', 'data-search-scope="hadith"'],
    ['/quran/api/?q=mercy&o=100', 'data-search-scope="quran"']
  ])('serves %s through its infinite-scroll router', async (path, marker) => {
    const response = await fetch(`${baseUrl}${path}`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain(marker);
  });

  test('preserves the Memorize query string while rewriting the Quran API path', async () => {
    const response = await fetch(`${baseUrl}/quran/api/page/2?memorize`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('data-memorize="true"');
  });
});
