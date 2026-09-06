'use strict';

const express = require('express');
const Index = require('../lib/Index');
const proxyRouter = require('../routes/proxy');

describe('local tafsir proxy lookup', () => {
  let server;
  let baseUrl;
  let originalDocsFromQuery;
  let originalQuery;
  let originalDbPool;
  let originalSurahs;

  beforeAll(done => {
    originalDocsFromQuery = Index.docsFromQuery;
    originalQuery = global.query;
    originalDbPool = global.dbPool;
    originalSurahs = global.surahs;
    global.surahs = [{ num: 5, ayahs: 120 }];
    global.dbPool = { escape: value => `'${String(value).replace(/'/g, "''")}'` };

    const app = express();
    app.use('/quran/api/proxy', proxyRouter);
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      done();
    });
  });

  afterAll(done => {
    Index.docsFromQuery = originalDocsFromQuery;
    global.query = originalQuery;
    global.dbPool = originalDbPool;
    global.surahs = originalSurahs;
    server.close(done);
  });

  test('returns both languages directly from the indexed overlapping passage', async () => {
    Index.docsFromQuery = jest.fn().mockResolvedValue([{
      commentary_alias: 'ibn-kathir',
      ordinal: 1,
      format: 'md',
      id: 47,
      surah: 5,
      ayahFrom: 47,
      ayahTo: 47,
      text: 'تفسير عربي كامل',
      text_en: 'Complete English commentary',
      footnotes: '',
      footnotes_en: ''
    }]);
    global.query = jest.fn();

    const response = await fetch(`${baseUrl}/quran/api/proxy/tafsir/local?src=ibn-kathir&s=5&a=47&lang=en`);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(Index.docsFromQuery).toHaveBeenCalled();
    expect(global.query).not.toHaveBeenCalled();
    expect(payload).toEqual(expect.objectContaining({
      id: 47,
      bilingual: true,
      content_translation_language: 'en'
    }));
    expect(payload.arabic_html).toContain('تفسير عربي كامل');
    expect(payload.translation_html).toContain('Complete English commentary');
    expect(payload.html).toContain('lang="ar"');
    expect(payload.html).toContain('lang="en"');
  });
});
