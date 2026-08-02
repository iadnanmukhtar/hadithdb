'use strict';

const GoogleAnalytics = require('../lib/GoogleAnalytics');

describe('Google Analytics tag selection', () => {
  const originalSettings = global.settings;
  const originalSiteTagId = process.env.GOOGLE_ANALYTICS_TAG_ID;
  const originalQuranTagId = process.env.QURAN_GOOGLE_ANALYTICS_TAG_ID;

  afterEach(() => {
    global.settings = originalSettings;
    restoreEnvironment('GOOGLE_ANALYTICS_TAG_ID', originalSiteTagId);
    restoreEnvironment('QURAN_GOOGLE_ANALYTICS_TAG_ID', originalQuranTagId);
  });

  test('uses separate configured tags for Quran and other pages', () => {
    global.settings = { google: {} };
    process.env.GOOGLE_ANALYTICS_TAG_ID = 'G-HADITH123';
    process.env.QURAN_GOOGLE_ANALYTICS_TAG_ID = 'G-QURAN456';

    expect(GoogleAnalytics.googleAnalyticsTagId({ hostname: 'hadith.example', path: '/books' }))
      .toBe('G-HADITH123');
    expect(GoogleAnalytics.googleAnalyticsTagId({ hostname: 'hadith.example', path: '/quran/1' }))
      .toBe('G-QURAN456');
    expect(GoogleAnalytics.googleAnalyticsTagId({ hostname: 'quran.example', path: '/settings' }))
      .toBe('G-QURAN456');
  });

  test('supports tag IDs in Google settings', () => {
    delete process.env.GOOGLE_ANALYTICS_TAG_ID;
    delete process.env.QURAN_GOOGLE_ANALYTICS_TAG_ID;
    global.settings = {
      google: {
        analyticsTagId: 'G-HADITH789',
        quranAnalyticsTagId: 'G-QURAN789'
      }
    };

    expect(GoogleAnalytics.googleAnalyticsTagId({ hostname: 'hadith.example', path: '/' }))
      .toBe('G-HADITH789');
    expect(GoogleAnalytics.googleAnalyticsTagId({ hostname: 'hadith.example', path: '/quran/review' }))
      .toBe('G-QURAN789');
  });

  test('uses the Quran tag from settings by default', () => {
    global.settings = {
      google: {
        analyticsTagId: 'G-ZZFHG1L3ZX',
        quranAnalyticsTagId: 'G-9VR5K0F8Q9'
      }
    };
    delete process.env.GOOGLE_ANALYTICS_TAG_ID;
    delete process.env.QURAN_GOOGLE_ANALYTICS_TAG_ID;

    expect(GoogleAnalytics.googleAnalyticsTagId({ hostname: 'hadith.example', path: '/quran' }))
      .toBe('G-9VR5K0F8Q9');
  });

  test('uses the Quran tag for every page on each configured Quran host', () => {
    global.settings = {
      google: {
        analyticsTagId: 'G-ZZFHG1L3ZX',
        quranAnalyticsTagId: 'G-9VR5K0F8Q9'
      },
      site: {
        quranUrl: 'https://reader.example.test',
        quranUrlLocal: 'http://reader.local:3004'
      }
    };

    expect(GoogleAnalytics.googleAnalyticsTagId({ hostname: 'reader.example.test', path: '/settings' }))
      .toBe('G-9VR5K0F8Q9');
    expect(GoogleAnalytics.googleAnalyticsTagId({ hostname: 'reader.local', path: '/about' }))
      .toBe('G-9VR5K0F8Q9');
  });

  test('uses the Quran tag for every path starting with /quran', () => {
    global.settings = {
      google: {
        analyticsTagId: 'G-ZZFHG1L3ZX',
        quranAnalyticsTagId: 'G-9VR5K0F8Q9'
      }
    };

    expect(GoogleAnalytics.googleAnalyticsTagId({ hostname: 'hadith.example', path: '/quran-corpus/1/1' }))
      .toBe('G-9VR5K0F8Q9');
    expect(GoogleAnalytics.googleAnalyticsTagId({ hostname: 'hadith.example', path: '/quran/settings' }))
      .toBe('G-9VR5K0F8Q9');
  });

  test('recognizes explicit Quran error rendering context', () => {
    global.settings = { google: {} };
    process.env.QURAN_GOOGLE_ANALYTICS_TAG_ID = 'G-QURAN456';

    expect(GoogleAnalytics.googleAnalyticsTagId({ hostname: 'hadith.example', path: '/error/404', quranArea: true }))
      .toBe('G-QURAN456');
  });

  test('updates a cached page to the tag selected for the current request', () => {
    global.settings = { google: {} };
    process.env.QURAN_GOOGLE_ANALYTICS_TAG_ID = 'G-QURAN456';
    const cachedHtml = '<script src="https://www.googletagmanager.com/gtag/js?id=G-OLD123"></script>'
      + '<script>gtag(\'config\', \'G-OLD123\')</script>';

    expect(GoogleAnalytics.injectTagId(cachedHtml, { hostname: 'hadith.example', path: '/quran/1' }))
      .toContain('gtag/js?id=G-QURAN456');
    expect(GoogleAnalytics.injectTagId(cachedHtml, { hostname: 'hadith.example', path: '/quran/1' }))
      .toContain("gtag('config', 'G-QURAN456')");
  });
});

function restoreEnvironment(name, value) {
  if (value === undefined)
    delete process.env[name];
  else
    process.env[name] = value;
}
