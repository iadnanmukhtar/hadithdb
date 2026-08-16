'use strict';

const fs = require('fs');
const path = require('path');
const Utils = require('../lib/Utils');

describe('static assets', () => {
  test.each([
    ['/images/logo.png', '/static/img/logo.png'],
    ['/fonts/kitab-base.woff2', '/static/fonts/kitab-base.woff2'],
    ['/javascripts/script.js?v=1', '/static/js/script.js?v=1'],
    ['https://hadithunlocked.com/stylesheets/style.css', 'https://hadithunlocked.com/static/css/style.css'],
    ['/static/images/logo.png', '/static/img/logo.png'],
    ['/static/img/logo.png', '/static/img/logo.png'],
    ['/robots.txt', '/robots.txt']
  ])('maps %s to %s', (input, expected) => {
    expect(Utils.staticAssetUrl(input)).toBe(expected);
  });

  test('rewrites cached HTML asset URLs and keeps the operation idempotent', () => {
    const html = [
      '<link rel="stylesheet" href="/stylesheets/style.css?v=old" rel="stylesheet">',
      '<script src="/javascripts/script.js?v=old"></script>',
      '<img src="https://hadithunlocked.com/images/logo.png">'
    ].join('\n');

    const rewritten = Utils.injectCachedAssetVersions(html);

    expect(rewritten).toContain(`/static/css/style.css?v=${Utils.styleAssetVersion()}`);
    expect(rewritten).toContain(`/static/js/script.js?v=${Utils.scriptAssetVersion()}`);
    expect(rewritten).toContain('https://hadithunlocked.com/static/img/logo.png');
    expect(Utils.injectCachedAssetVersions(rewritten)).toBe(rewritten);
  });

  test('keeps asset directories under public/static and root crawler files at public root', () => {
    const publicDir = path.join(__dirname, '..', 'public');

    for (const directory of ['audio', 'fonts', 'img', 'js', 'css']) {
      expect(fs.statSync(path.join(publicDir, 'static', directory)).isDirectory()).toBe(true);
    }
    for (const directory of ['audio', 'fonts', 'images', 'javascripts', 'stylesheets'])
      expect(fs.existsSync(path.join(publicDir, directory))).toBe(false);
    for (const directory of ['images', 'javascripts', 'stylesheets'])
      expect(fs.existsSync(path.join(publicDir, 'static', directory))).toBe(false);
    expect(fs.existsSync(path.join(publicDir, 'robots.txt'))).toBe(true);
    expect(fs.existsSync(path.join(publicDir, 'ads.txt'))).toBe(true);
  });

  test('provides a local SVG title for every Surah header', () => {
    const titleDir = path.join(__dirname, '..', 'public', 'static', 'img', 'quran', 'surah-header', 'names');

    expect(fs.existsSync(path.join(titleDir, '..', 'border.svg'))).toBe(true);
    expect(fs.existsSync(path.join(titleDir, '..', 'basmala.svg'))).toBe(true);
    for (let surahNumber = 1; surahNumber <= 114; surahNumber++) {
      expect(Utils.quranSurahHeaderSvgPath(surahNumber))
        .toBe(`/static/img/quran/surah-header/names/${surahNumber}.svg`);
      expect(fs.existsSync(path.join(titleDir, `${surahNumber}.svg`))).toBe(true);
    }
    expect(Utils.quranSurahHeaderSvgPath(0)).toBe('');
    expect(Utils.quranSurahHeaderSvgPath(115)).toBe('');
  });

  test('keeps the startup fallback self-contained apart from an available static logo', () => {
    const publicDir = path.join(__dirname, '..', 'public');
    const fallbackPath = path.join(publicDir, 'html', '_app_restarting.html');
    const fallbackHtml = fs.readFileSync(fallbackPath, 'utf8');

    expect(fallbackHtml).toContain('<style>');
    expect(fallbackHtml).toContain('src="/static/img/logo2.svg"');
    expect(fs.existsSync(path.join(publicDir, 'static', 'img', 'logo2.svg'))).toBe(true);
    expect(fallbackHtml).not.toMatch(/(?:href|src)="\/(?!static\/img\/logo2\.svg)/);
  });

  test('removes unused assets while retaining high-resolution logo bases', () => {
    const staticDir = path.join(__dirname, '..', 'public', 'static');
    const retainedLogoBases = [
      'img/hadith/hadith-unlocked.png',
      'img/logo.png',
      'img/logo2.png',
      'img/quran-logo.png',
      'img/quran-logo2.png',
      'img/quran/mudhakkir.png',
      'img/quran/quran-unlocked.png'
    ];
    const removedAssets = [
      'fonts/AlQuranAli.ttf',
      'fonts/DigitalKhattV2.otf',
      'fonts/me_quran.ttf',
      'img/android-chrome-512x512.png',
      'img/mstile-150x150.png',
      'img/quran-android-chrome-512x512.png',
      'img/quran-mstile-150x150.png',
      'img/quran-logo.svg',
      'img/hadith/hadith-unlocked.ico',
      'img/quran/quran-unlocked.ico'
    ];

    for (const relativePath of retainedLogoBases)
      expect(fs.existsSync(path.join(staticDir, relativePath))).toBe(true);
    for (const relativePath of removedAssets)
      expect(fs.existsSync(path.join(staticDir, relativePath))).toBe(false);
  });
});
