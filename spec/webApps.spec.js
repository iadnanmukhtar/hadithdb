'use strict';

const WebApps = require('../lib/WebApps');

const request = (path, query = {}) => ({ path, query });

test.each([
  ['hadith home', request('/'), 'hadith'],
  ['hadith collection', request('/bukhari/1'), 'hadith'],
  ['notes', request('/notebook'), 'notes'],
  ['notes on the Quran host path', request('/quran/notebook'), 'notes'],
  ['Quran', request('/quran/2/255'), 'quran'],
  ['Mudhakkir progress', request('/quran/review'), 'mudhakkir'],
  ['Mudhakkir practice', request('/quran/page/2', { memorize: '' }), 'mudhakkir'],
  ['Mudhakkir review', request('/quran/page/2', { review: '2:1' }), 'mudhakkir'],
  ['ordinary Mushaf', request('/quran/page/2'), 'quran']
])('selects the %s app manifest', (_label, req, expected) => {
  expect(WebApps.forRequest(req).key).toBe(expected);
});

test('publishes four distinct install identities with usable icons', () => {
  const manifests = Object.values(WebApps.APPS).map(WebApps.manifest);
  expect(new Set(manifests.map(item => item.id)).size).toBe(4);
  for (const manifest of manifests) {
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons.map(icon => icon.sizes)).toEqual(['192x192', '512x512']);
  }
});
