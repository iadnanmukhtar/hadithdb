'use strict';

const Tafsir = require('../lib/Tafsir');

describe('Tafsir catalog languages', () => {
  test('places an Arabic original with translations into each language carousel', () => {
    const [english, arabic, urdu] = Tafsir.expandBilingualLocalCommentaries([{
      alias: 'ibn-kathir',
      lang: 'ar-en-ur',
      source: 'local',
      format: 'md,ur:md'
    }]);

    expect(english).toMatchObject({ alias: 'ibn-kathir', lang: 'en' });
    expect(arabic).toMatchObject({ alias: 'ibn-kathir', lang: 'ar' });
    expect(urdu).toMatchObject({ alias: 'ibn-kathir', lang: 'ur' });
    expect(english.languages).toBe('ar-en-ur');
    expect(Tafsir.isBilingualTafsir(english)).toBe(true);
  });

  test('does not duplicate an Arabic-only local tafsir', () => {
    const books = Tafsir.expandBilingualLocalCommentaries([{
      alias: 'tabari',
      lang: 'ar',
      source: 'local',
      format: 'md'
    }]);

    expect(books).toEqual([expect.objectContaining({ alias: 'tabari', lang: 'ar' })]);
    expect(Tafsir.isBilingualTafsir(books[0])).toBe(false);
  });

  test('retains metadata-based bilingual compatibility', () => {
    expect(Tafsir.expandBilingualLocalCommentaries([{
      alias: 'mokhtasar',
      lang: 'en',
      source: 'local',
      format: 'en:md,ar:md'
    }]).map(book => book.lang)).toEqual(['en', 'ar']);
  });

  test('preserves source-first language metadata while removing duplicates', () => {
    expect(Tafsir.commentaryLanguages({ lang: 'ar-en-ur-en' })).toEqual(['ar', 'en', 'ur']);
  });

  test('renders one carousel item per tafsir alias and prefers its English variant', () => {
    const books = Tafsir.uniqueCarouselTafsirs([
      { alias: 'mokhtasar', lang: 'ar' },
      { alias: 'tabari', lang: 'ar' },
      { alias: 'mokhtasar', lang: 'en' },
      { alias: 'mokhtasar', lang: 'ur' }
    ]);

    expect(books).toEqual([
      { alias: 'mokhtasar', lang: 'en' },
      { alias: 'tabari', lang: 'ar' }
    ]);
  });

  test('always places Mokhtasar first in a tafsir carousel', () => {
    const books = Tafsir.uniqueCarouselTafsirs([
      { alias: 'tabari', lang: 'ar' },
      { alias: 'ibn-kathir', lang: 'en' },
      { alias: 'mokhtasar', lang: 'ar', languages: 'ar-en' },
      { alias: 'mokhtasar', lang: 'en', languages: 'ar-en' }
    ]);

    expect(books.map(book => book.alias)).toEqual(['mokhtasar', 'tabari', 'ibn-kathir']);
    expect(books[0].lang).toBe('en');
    expect(Tafsir.DEFAULT_TAFSIR_ALIAS).toBe('mokhtasar');
  });

  test('groups English and bilingual tafsirs separately from Arabic-only tafsirs', () => {
    expect(Tafsir.carouselLanguage({ alias: 'english', lang: 'en', source: 'local' })).toBe('en');
    expect(Tafsir.carouselLanguage({ alias: 'bilingual', lang: 'ar', languages: 'ar-en', source: 'local' })).toBe('en');
    expect(Tafsir.carouselLanguage({ alias: 'arabic', lang: 'ar', source: 'local' })).toBe('ar');
  });
});
