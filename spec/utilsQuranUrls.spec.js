'use strict';

const Utils = require('../lib/Utils');

describe('Utils Quran URLs', () => {
  const originalSettings = global.settings;

  afterEach(() => {
    global.settings = originalSettings;
  });

  test('uses the production Quran host when quranUrl is not configured', () => {
    global.settings = { site: { url: 'https://hadithunlocked.com' } };
    const req = { hostname: 'hadithunlocked.com' };

    expect(Utils.quranBaseUrl(req)).toBe('https://quran.islamunlocked.com');
    expect(Utils.quranUrl(req, '/quran/en-khattab'))
      .toBe('https://quran.islamunlocked.com/quran/en-khattab');
    expect(Utils.quranUrl(req, '/quran/tafsir/qinnawji'))
      .toBe('https://quran.islamunlocked.com/quran/tafsir/qinnawji');
  });

  test('honors a configured Quran host', () => {
    global.settings = { site: { quranUrl: 'https://quran.example.test' } };
    const req = { hostname: 'hadith.example.test' };

    expect(Utils.quranUrl(req, '/quran/1'))
      .toBe('https://quran.example.test/quran/1');
  });

  test('keeps localhost Quran URLs on the current origin', () => {
    global.settings = { site: {} };
    const req = {
      hostname: 'localhost',
      protocol: 'http',
      get(name) {
        return name === 'host' ? 'localhost:3004' : '';
      }
    };

    expect(Utils.quranBaseUrl(req)).toBe('http://localhost:3004');
    expect(Utils.quranUrl(req, '/quran/1')).toBe('/quran/1');
  });
});
