'use strict';

const Tafsir = require('../lib/Tafsir');

describe('Tafsir catalog languages', () => {
	let originalCommentaries;

	beforeEach(() => {
		originalCommentaries = global.commentaries;
		global.tafsirCarouselBooks = null;
	});

	afterEach(() => {
		global.commentaries = originalCommentaries;
		global.tafsirCarouselBooks = null;
	});

	test('shows a stored tafsir in translations when its catalog roles include translation', () => {
		global.commentaries = [{
			alias: 'translation-commentary', type: 'tafsir', lang: 'en', hidden: 0,
			properties: { quran: { display_as: ['translation', 'tafsir'] } }
		}];

		expect(Tafsir.visibleTranslationsSync()).toEqual([
			expect.objectContaining({
				alias: 'translation-commentary', type: 'trans', storedType: 'tafsir',
				quranBookSlug: 'translation-commentary'
			})
		]);
	});

	test('shows a stored translation in English tafsirs when its catalog roles include tafsir', () => {
		global.commentaries = [{
			alias: 'annotated-translation', type: 'trans', lang: 'en', hidden: 0,
			properties: JSON.stringify({ quran: { display_as: ['translation', 'tafsir'] } })
		}];

		expect(Tafsir.visibleTafsirsSync()).toEqual([
			expect.objectContaining({ alias: 'annotated-translation', type: 'tafsir', storedType: 'trans' })
		]);
	});

	test('keeps tafsir-only books out of the translation catalog', () => {
		global.commentaries = [
			{ alias: 'mokhtasar', type: 'tafsir', lang: 'ar-en', source: 'local', hidden: 0, properties: { rendering: { footnotes: 'sm' } } },
			{ alias: 'muntakhab', type: 'tafsir', lang: 'ar-en', source: 'local', hidden: 0, properties: { rendering: { footnotes: 'sm' } } }
		];

		expect(Tafsir.visibleTranslationsSync()).toEqual([]);
		expect(new Set(Tafsir.visibleTafsirsSync().map(book => book.alias))).toEqual(new Set(['mokhtasar', 'muntakhab']));
	});

	test('splits a multi-ayah English translation passage into one entry per ayah', () => {
		const rows = Tafsir.splitTranslationRowByAyah({
			id: 1, surah: 1, ayahFrom: 1, ayahTo: 3,
			text_en: 'First translation\n\nSecond translation\n\nThird translation',
			footnotes_en: ''
		}, {});

		expect(rows.map(row => [row.ayahFrom, row.ayahTo, row.text_en])).toEqual([
			[1, 1, 'First translation'],
			[2, 2, 'Second translation'],
			[3, 3, 'Third translation']
		]);
	});

	test('supports declared paragraph splitting when an early ayah spans multiple paragraphs', () => {
		const rows = Tafsir.splitTranslationRowByAyah({
			surah: 24, ayahFrom: 31, ayahTo: 32,
			text_en: 'First part of 31\n\nSecond part of 31\n\nTranslation of 32'
		}, { properties: { quran: { translation_split: 'paragraphs' } } });

		expect(rows).toEqual([
			expect.objectContaining({ ayahFrom: 31, ayahTo: 31, text_en: 'First part of 31\n\nSecond part of 31' }),
			expect.objectContaining({ ayahFrom: 32, ayahTo: 32, text_en: 'Translation of 32' })
		]);
	});

	test('extracts only the leading Quran translation paragraph from a one-ayah tafsir row', () => {
		const rows = Tafsir.splitTranslationRowByAyah({
			surah: 1, ayahFrom: 2, ayahTo: 2,
			text_en: 'All praise is due to Allah, Lord of the worlds.\n\nAll praise belongs to Allah because He created everything.',
			footnotes_en: '[^1]: Commentary note',
			text: 'Arabic tafsir'
		}, {
			storedType: 'tafsir',
			properties: { quran: { translation_extract: 'first_paragraph' } }
		});

		expect(rows).toEqual([
			expect.objectContaining({
				ayahFrom: 2,
				ayahTo: 2,
				text_en: 'All praise is due to Allah, Lord of the worlds.',
				footnotes_en: '',
				text: ''
			})
		]);
	});

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
