'use strict';
const metadata = require('../lib/SocialMetadata');
const ejs = require('ejs');
const fs = require('fs');
const path = require('path');

test('extracts readable bilingual excerpts without markup, scripts or footnotes', () => {
  expect(metadata.plain('**Mercy** &amp; <em>رحمة</em>[^1]\n\n[^1]: Footnote\n<script>bad()</script>')).toBe('Mercy & رحمة');
  expect(metadata.description('Bukhari 2', ['<p>Revelation came.</p>'], 'fallback')).toBe('Bukhari 2: Revelation came.');
  expect(metadata.description('Empty', [''], 'Read this book.')).toBe('Read this book.');
  expect(metadata.excerpt('one two three', 9)).toBe('one two…');
});

test('uses displayed translations and preserves Arabic when English is absent', () => {
  expect(metadata.body({en: {body: 'Displayed translation'}, body_en: 'Other'})).toBe('Displayed translation');
  expect(metadata.body({ar: {body: 'رَحْمَةٌ'}})).toBe('رَحْمَةٌ');
});

test.each([false, true])('publishes an absolute crawler-accessible brand image (Quran: %s)', quran => {
  const image = metadata.image(null, 'https://example.com', quran);
  expect(image).toBe(`https://example.com/static/img/pwa/${quran ? 'quran' : 'hadith'}-512.png`);
  expect(fs.existsSync(path.join(__dirname, '../public', new URL(image).pathname))).toBe(true);
  const png = fs.readFileSync(path.join(__dirname, '../public', new URL(image).pathname));
  expect(png.readUInt32BE(16)).toBe(512);
  expect(png.readUInt32BE(20)).toBe(512);
  expect(metadata.image('javascript:alert(1)', 'https://example.com', quran)).toBe(image);
});

test('all updated reader templates compile', () => {
  for (const file of ['search', 'section_quran', 'translation_passage', 'tafsir_passage', 'sharh_passage', 'sub-views/head']) {
    expect(() => ejs.compile(fs.readFileSync(path.join(__dirname, '../views', file + '.ejs'), 'utf8'))).not.toThrow();
  }
});

test.each([['/bukhari:2', false], ['/quran:30:16', true]])('renders social tags in initial HTML for %s', (canonical, quran) => {
  const utils = require('../lib/Utils');
  const html = ejs.render(fs.readFileSync(path.join(__dirname, '../views/sub-views/head.ejs'), 'utf8'), {
    page: { title_en: 'Reference — A "title"', description_en: 'Reference: A passage & its meaning.', canonical, context: {} },
    site: { name: 'Hadith Unlocked', url: 'https://hadith.example', quranUrl: 'https://quran.example', logo: '/static/img/logo.png' },
    req: { originalUrl: canonical, query: {} }, utils, arabic: {}
  });
  const $ = require('cheerio').load(html);
  expect($('meta[property="og:title"]').attr('content')).toBe('Reference — A "title"');
  expect($('meta[property="og:description"]').attr('content')).toBe('Reference: A passage & its meaning.');
  expect($('meta[property="og:url"]').attr('content')).toBe(`https://${quran ? 'quran' : 'hadith'}.example${canonical}`);
  expect($('meta[property="og:image"]').attr('content')).toBe(`https://${quran ? 'quran' : 'hadith'}.example/static/img/pwa/${quran ? 'quran' : 'hadith'}-512.png`);
  expect($('meta[name="twitter:card"]').attr('content')).toBe('summary');
  expect($('meta[property="og:image:width"]').attr('content')).toBe('512');
  expect($('meta[property="og:image:height"]').attr('content')).toBe('512');
  expect($('link[rel="apple-touch-icon"]').attr('href')).toContain('apple-touch-icon.png');
});
