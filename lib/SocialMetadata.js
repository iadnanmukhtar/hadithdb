'use strict';

const markdown = require('markdown-it')({ html: true });
const { load } = require('cheerio');

function plain(value) {
  const html = markdown.render(String(value || '').replace(/^\[\^[^\]]+\]:.*(?:\n[ \t]+.*)*/gm, '').replace(/\[\^[^\]]+\]/g, ''));
  const $ = load(html, null, false);
  $('script,style,nav,form,.footnotes,.footnote-ref,.footnote-backref').remove();
  $('p,li,br,h1,h2,h3,blockquote').append(' ');
  return $.text().replace(/\s+/g, ' ').trim();
}

function excerpt(value, limit = 360) {
  const text = plain(value);
  if (Array.from(text).length <= limit) return text;
  const part = Array.from(text).slice(0, limit).join('');
  return (part.replace(/\s+\S*$/, '') || part).trimEnd() + '…';
}

function body(item) {
  return item?.en?.body || item?.en?.text || item?.body_en || item?.ar?.body || item?.body || '';
}

function description(label, texts, fallback) {
  const text = texts.map(plain).filter(Boolean).join(' ');
  return text ? excerpt(`${plain(label)}: ${text}`) : excerpt(fallback);
}

function image(cover, origin, quran) {
  // Social crawlers require larger images than the 180px Apple touch icons.
  const fallback = `/static/img/${quran ? 'quran-' : ''}logo.png`;
  try {
    const url = new URL(cover || fallback, origin);
    if (/^https?:$/.test(url.protocol)) return url.href;
  } catch (_) { /* Fall back to the public brand icon. */ }
  return new URL(fallback, origin).href;
}

module.exports = { plain, excerpt, body, description, image };
