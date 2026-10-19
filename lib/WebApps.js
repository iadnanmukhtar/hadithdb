'use strict';

const APPS = Object.freeze({
  hadith: Object.freeze({
    key: 'hadith',
    id: '/apps/hadith',
    name: 'Hadith Unlocked',
    shortName: 'Hadith',
    description: 'Search and study hadith collections, translations, references, and commentary.',
    startUrl: '/',
    scope: '/',
    icon: '/static/img/pwa/hadith'
  }),
  notes: Object.freeze({
    key: 'notes',
    id: '/apps/notes',
    name: 'Notes',
    shortName: 'Notes',
    description: 'Write and organize private study notes.',
    startUrl: '/notebook',
    scope: '/',
    icon: '/static/img/pwa/notes'
  }),
  quran: Object.freeze({
    key: 'quran',
    id: '/apps/quran',
    name: 'Quran Unlocked',
    shortName: 'Quran',
    description: 'Read and study the Quran, translations, and tafsir.',
    startUrl: '/quran',
    scope: '/quran',
    icon: '/static/img/pwa/quran'
  }),
  mudhakkir: Object.freeze({
    key: 'mudhakkir',
    id: '/apps/mudhakkir',
    name: 'Mudhakkir',
    shortName: 'Mudhakkir',
    description: 'Practice Quran memorization and review due passages.',
    startUrl: '/quran/review',
    scope: '/quran',
    icon: '/static/img/pwa/mudhakkir'
  })
});

function requestPath(req) {
  return (req && (req.path || req.originalUrl) || '/').toString().split('?')[0];
}

function isMudhakkirRequest(req, path) {
  if (path === '/quran/review')
    return true;
  if (path !== '/quran/page' && !path.startsWith('/quran/page/'))
    return false;
  const query = req && req.query || {};
  return query.memorize !== undefined || query.review !== undefined || query.reviewRef !== undefined;
}

function forRequest(req) {
  const path = requestPath(req);
  if (path === '/notebook' || path.startsWith('/notebook/')
      || path === '/quran/notebook' || path.startsWith('/quran/notebook/'))
    return APPS.notes;
  if (isMudhakkirRequest(req, path))
    return APPS.mudhakkir;
  if (path === '/quran' || path.startsWith('/quran/') || path.startsWith('/quran:'))
    return APPS.quran;
  return APPS.hadith;
}

function manifest(app) {
  return {
    id: app.id,
    name: app.name,
    short_name: app.shortName,
    description: app.description,
    start_url: app.startUrl,
    scope: app.scope,
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#174d7c',
    icons: [192, 512].map(size => ({
      src: `${app.icon}-${size}.png`,
      sizes: `${size}x${size}`,
      type: 'image/png',
      purpose: 'any'
    }))
  };
}

module.exports = { APPS, forRequest, manifest };
