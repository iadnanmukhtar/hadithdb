'use strict';

const identity = require('./ContentIdentity');
const {plain, excerpt} = identity;

function body(item) {
  return item?.en?.body || item?.en?.text || item?.body_en || item?.ar?.body || item?.body || '';
}

function description(label, texts, fallback) {
  const text = texts.map(plain).filter(Boolean).join(' ');
  return text ? excerpt(`${plain(label)}: ${text}`) : excerpt(fallback);
}

function image(cover, origin, quran) {
  // Social crawlers require larger images than the 180px Apple touch icons.
  const fallback = `/static/img/pwa/${quran ? 'quran' : 'hadith'}-512.png`;
  try {
    const url = new URL(cover || fallback, origin);
    if (/^https?:$/.test(url.protocol)) return url.href;
  } catch (_) { /* Fall back to the public brand icon. */ }
  return new URL(fallback, origin).href;
}

module.exports = { ...identity, body, description, image };
