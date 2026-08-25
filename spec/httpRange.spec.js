'use strict';

const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const HttpRange = require('../lib/HttpRange');
const Utils = require('../lib/Utils');
const Search = require('../lib/Search');
const { Chapter, Section, Subsection } = require('../lib/Model');
const blogRouter = require('../routes/blog');
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

  test('describes the available item count for an unsatisfied offset', () => {
    const error = HttpRange.itemOffsetNotSatisfiable(100, 37, 'Section bukhari/1/1');

    expect(error.status).toBe(416);
    expect(error.message).toBe('Section bukhari/1/1 does not have content at offset 100');
    expect(error.headers).toEqual({
      'Accept-Ranges': 'items',
      'Content-Range': 'items */37'
    });
  });

  test('accepts an offset that points to available content', () => {
    expect(HttpRange.itemOffsetNotSatisfiable(36, 37, 'Section bukhari/1/1')).toBeNull();
  });

  test('rejects malformed offsets as Bad Request', () => {
    expect(() => HttpRange.parseOffset('not-an-offset')).toThrow(expect.objectContaining({ status: 400 }));
  });
});

describe('Blog offset status errors', () => {
  let server;
  let baseUrl;
  let blogDir;
  let originalSettings;
  let originalUtils;

  beforeAll(done => {
    originalSettings = global.settings;
    originalUtils = global.utils;
    blogDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hadithdb-blog-offset-'));
    fs.writeFileSync(path.join(blogDir, 'one.md'), '---\ntitle: One\npublished: 2026-01-02\n---\nOne');
    fs.writeFileSync(path.join(blogDir, 'two.md'), '---\ntitle: Two\npublished: 2026-01-01\n---\nTwo');
    global.settings = {
      ...(originalSettings || {}),
      blog: {
        ...((originalSettings && originalSettings.blog) || {}),
        dir: blogDir,
        itemsPerPage: 1,
        shortName: 'Test Blog'
      },
      site: {
        ...((originalSettings && originalSettings.site) || {}),
        url: 'https://example.test'
      }
    };
    global.utils = Utils;

    const app = express();
    app.use('/blog', blogRouter);
    app.use((err, req, res, next) => {
      Object.entries(err.headers || {}).forEach(([name, value]) => res.setHeader(name, value));
      res.status(err.status || 500).send(err.message);
    });
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      done();
    });
  });

  afterAll(done => {
    global.settings = originalSettings;
    global.utils = originalUtils;
    fs.rmSync(blogDir, { recursive: true, force: true });
    server.close(done);
  });

  test('returns Range Not Satisfiable when the offset has no post', async () => {
    const response = await fetch(`${baseUrl}/blog?o=2`);

    expect(response.status).toBe(416);
    expect(response.headers.get('accept-ranges')).toBe('items');
    expect(response.headers.get('content-range')).toBe('items */2');
  });

  test('returns Bad Request for a malformed offset', async () => {
    const response = await fetch(`${baseUrl}/blog?o=invalid`);

    expect(response.status).toBe(400);
  });
});

describe('Hadith route status errors', () => {
  let server;
  let baseUrl;
  let originalBooks;
  let originalSurahs;
  let originalSettings;

  beforeAll(done => {
    originalBooks = global.books;
    originalSurahs = global.surahs;
    originalSettings = global.settings;
    global.books = [
      { alias: 'tabarani', hidden: 0 },
      { alias: 'quran', hidden: 0 }
    ];
    global.surahs = [{ num: 2, ayahs: 286 }];
    global.settings = {
      ...(originalSettings || {}),
      search: {
        ...((originalSettings && originalSettings.search) || {}),
        itemsPerPage: 100
      }
    };

    const app = express();
    app.use(searchRouter);
    app.use((err, req, res, next) => {
      Object.entries(err.headers || {}).forEach(([name, value]) => res.setHeader(name, value));
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
    global.settings = originalSettings;
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
    ['/tabarani/10.1', '/tabarani/10.10'],
    ['/tabarani/10/2.3?json=1', '/tabarani/10/2.30?json=1'],
    ['/tabarani/10/2/3.4', '/tabarani/10/2/3.40'],
    ['/tabarani/10.1/2.2/3.3', '/tabarani/10.10/2.20/3.30'],
    ['/tabarani/10.100/2/3', '/tabarani/10.10/2/3']
  ])('permanently redirects non-canonical decimal Hadith headings: %s', async (path, location) => {
    const response = await fetch(`${baseUrl}${path}`, { redirect: 'manual' });

    expect(response.status).toBe(301);
    expect(response.headers.get('location')).toBe(location);
  });

  test('accepts canonical two-place decimals in Hadith H1 and H2 parameters', async () => {
    const lookup = jest.spyOn(Section, 'sectionFromRef').mockRejectedValue(new ReferenceError('Not found'));
    try {
      const response = await fetch(`${baseUrl}/tabarani/10.10/2.30`, { redirect: 'manual' });

      expect(response.status).toBe(410);
      expect(response.headers.get('location')).toBeNull();
      expect(lookup).toHaveBeenCalledWith('tabarani/10.1/2.3');
    } finally {
      lookup.mockRestore();
    }
  });

  test('accepts canonical two-place decimals in Hadith H3 parameters', async () => {
    const lookup = jest.spyOn(Subsection, 'subsectionFromRef').mockRejectedValue(new ReferenceError('Not found'));
    try {
      const response = await fetch(`${baseUrl}/tabarani/10.10/2.30/3.40`, { redirect: 'manual' });

      expect(response.status).toBe(410);
      expect(response.headers.get('location')).toBeNull();
      expect(lookup).toHaveBeenCalledWith('tabarani/10.1/2.3/3.4');
    } finally {
      lookup.mockRestore();
    }
  });

  test('does not canonicalize decimal heading paths for an unknown book', async () => {
    const response = await fetch(`${baseUrl}/removed-book/10.1/2.2`, { redirect: 'manual' });

    expect(response.status).toBe(404);
    expect(response.headers.get('location')).toBeNull();
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

  test('returns Range Not Satisfiable for a chapter offset without content', async () => {
    const chapterLookup = jest.spyOn(Chapter, 'chapterFromRef').mockResolvedValue({ count: 2 });

    try {
      const response = await fetch(`${baseUrl}/tabarani/10?json=1&o=2`);

      expect(response.status).toBe(416);
      expect(response.headers.get('content-range')).toBe('items */2');
    } finally {
      chapterLookup.mockRestore();
    }
  });

  test('returns Range Not Satisfiable for a section offset without content', async () => {
    const sectionLookup = jest.spyOn(Section, 'sectionFromRef').mockResolvedValue({ count: 3 });

    try {
      const response = await fetch(`${baseUrl}/tabarani/10/1?json=1&o=3`);

      expect(response.status).toBe(416);
      expect(response.headers.get('content-range')).toBe('items */3');
    } finally {
      sectionLookup.mockRestore();
    }
  });

  test('returns Range Not Satisfiable for a search offset without content', async () => {
    const searchResults = [];
    searchResults.total = 2;
    const search = jest.spyOn(Search, 'a_searchText').mockResolvedValue(searchResults);

    try {
      const response = await fetch(`${baseUrl}/?q=test&o=2`);

      expect(response.status).toBe(416);
      expect(response.headers.get('content-range')).toBe('items */2');
    } finally {
      search.mockRestore();
    }
  });
});
