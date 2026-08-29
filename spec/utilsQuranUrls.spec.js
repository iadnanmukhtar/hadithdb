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

  test('uses the production Hadith host for Hadith links requested on the Quran host', () => {
    global.settings = { site: {} };
    const req = { hostname: 'quran.islamunlocked.com' };

    expect(Utils.hadithBaseUrl(req)).toBe('https://hadithunlocked.com');
    expect(Utils.urlFor(req, '/bukhari/1/1'))
      .toBe('https://hadithunlocked.com/bukhari/1/1');
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

  test('builds default and translation-scoped Study section paths in one place', () => {
    expect(Utils.quranStudySectionPath({ h1: 2, h2: 11 }, '')).toBe('/quran/2/11');
    expect(Utils.quranStudySectionPath({ surah: 2, section: 11, subsection: 3 }, 'yusuf-ali')).toBe('/quran/yusuf-ali/2/11/3');
    expect(Utils.quranStudySectionPath({ number: 3 }, 'en-itani')).toBe('/quran/en-itani/3');
    expect(Utils.quranStudySectionPath(null, 'en-itani')).toBe('/quran/en-itani');
    expect(Utils.quranStudySectionPath(null, '../tafsir')).toBe('/quran');
  });
});
