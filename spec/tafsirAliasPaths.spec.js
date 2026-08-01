'use strict';

const TafsirAliasPaths = require('../lib/TafsirAliasPaths');

describe('Tafsir alias paths', () => {
  const commentaries = [
    { alias: 'tabari', type: 'tafsir', hidden: 0 },
    { alias: 'en-tafsir-ibn-katheer', type: 'tafsir', hidden: 0 },
    { alias: 'hidden-tafsir', type: 'tafsir', hidden: 1 },
    { alias: 'clear-quran', type: 'trans', hidden: 0 }
  ];

  test.each([
    ['/tabari', '/quran/tafsir/tabari'],
    ['/quran/tabari', '/quran/tafsir/tabari'],
    ['/tafsir/tabari', '/quran/tafsir/tabari'],
    ['/quran/tabari/2/3', '/quran/tafsir/tabari/2/3'],
    ['/tafsir/en-tafsir-ibn-katheer', '/quran/tafsir/ibn-katheer'],
    ['/quran/ibn-katheer', '/quran/tafsir/ibn-katheer']
  ])('canonicalizes %s', (requestPath, expected) => {
    expect(TafsirAliasPaths.canonicalPath(requestPath, commentaries)).toBe(expected);
  });

  test.each([
    '/quran/tafsir/tabari',
    '/quran',
    '/tafsir',
    '/quran/hidden-tafsir',
    '/quran/clear-quran',
    '/quran/not-a-tafsir'
  ])('does not redirect %s as a tafsir alias', requestPath => {
    expect(TafsirAliasPaths.canonicalPath(requestPath, commentaries)).toBe('');
  });
});
