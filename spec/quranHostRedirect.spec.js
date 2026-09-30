'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Utils = require('../lib/Utils');

describe('Quran host redirects', () => {
  const originalSettings = global.settings;
  let redirect;

  beforeAll(() => {
    const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
    const start = source.indexOf("  app.all('/*', function redirectQuranPathsToQuranHost");
    const end = source.indexOf('\n  });', start) + '\n  });'.length;
    vm.runInNewContext(source.slice(start, end), {
      app: { all: (route, handler) => { redirect = handler; } },
      global,
      Utils,
      TafsirAliasPaths: { canonicalPath: () => null },
      quranPrefixedHadithPath: () => '',
      hadithBookPath: () => ''
    });
    global.settings = { site: { url: 'https://hadithunlocked.com' } };
  });

  afterAll(() => { global.settings = originalSettings; });

  test.each([
    ['GET', '/quran/41/4'],
    ['HEAD', '/quran/41/4'],
    ['GET', '/quran/41/4?flush=1&translation=en-khattab'],
    ['GET', '/quran/41/4/'],
    ['GET', '/quran:41:4'],
    ['GET', '/quran/41']
  ])('%s %s preserves the complete URL on the Quran host', (method, url) => {
    const res = { redirect: jest.fn() };
    const next = jest.fn();
    redirect({ method, path: url.split('?')[0], originalUrl: url, hostname: 'hadithunlocked.com' }, res, next);
    expect(res.redirect).toHaveBeenCalledWith(301, `https://quran.islamunlocked.com${url}`);
    expect(next).not.toHaveBeenCalled();
  });

  test.each(['quran.islamunlocked.com', 'localhost', '192.168.1.10'])('does not redirect a section on %s', hostname => {
    const res = { redirect: jest.fn() };
    const next = jest.fn();
    redirect({ method: 'GET', path: '/quran/41/4', originalUrl: '/quran/41/4', hostname }, res, next);
    expect(res.redirect).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });
});
