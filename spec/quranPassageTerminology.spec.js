'use strict';

const path = require('path');
const ejs = require('ejs');
const Arabic = require('../lib/Arabic');
const Utils = require('../lib/Utils');

const chapterTitleTemplate = path.join(__dirname, '..', 'views', 'sub-views', 'chapterTitle.ejs');

function normalize(html) {
  return html.replace(/\s+/g, ' ').trim();
}

async function renderChapterTitle(bookAlias, options = {}) {
  const isQuran = bookAlias === 'quran';
  const book = {
    alias: bookAlias,
    name_en: isQuran ? 'The Holy Quran' : 'Test Hadith Book',
    shortName_en: isQuran ? 'Quran' : 'Hadith',
		title: isQuran ? 'القرآن الكريم' : 'الحديث',
    shortName: isQuran ? 'القرآن' : 'الحديث'
  };
  const chapter = {
    id: 20,
    h1: 2,
    level: 1,
    path: `${bookAlias}/2`,
    title_en: isQuran ? 'al-Baqarah' : 'Faith',
    title: isQuran ? 'البقرة' : 'الإيمان',
    count: 1,
    book
  };
  const section = {
    id: 21,
    h1: 2,
    h2: 10,
    level: 2,
    path: `${bookAlias}/2/10`,
    title_en: '',
    title: '',
    chapter,
    book
  };
  chapter.sections = [section];

  return ejs.renderFile(chapterTitleTemplate, {
    page: { context: { book, chapter, section, passage: isQuran, quranCommentaryBook: options.quranCommentaryBook }, menu: 'Section' },
    site: { editMode: false },
    req: {},
    utils: {
      quranSurahBreadcrumbLabel: Utils.quranSurahBreadcrumbLabel,
	  quranSurahBreadcrumbLabelAr: Utils.quranSurahBreadcrumbLabelAr,
      quranSurahNameLigature: Utils.quranSurahNameLigature,
      urlFor: (_req, href) => href
    },
    arabic: Arabic
  });
}

describe('Quran passage terminology', () => {
  const originalSurahs = global.surahs;
  const originalSettings = global.settings;

  beforeAll(() => {
    global.surahs = [{ num: 2, name_en: 'al-Baqarah', name_ar: 'الْبَقَرَة', revelation_en: 'Madani' }];
    global.settings = { search: { itemsPerPage: 20 } };
  });

  afterAll(() => {
    global.surahs = originalSurahs;
    global.settings = originalSettings;
  });

  test.each([
    ['al-Baqarah', '2 al-Baqarah'],
    ['Surat al-Baqarah', '2 al-Baqarah'],
    ['Surah al-Baqarah', '2 al-Baqarah']
  ])('formats the Surah breadcrumb name from %s', (title, expected) => {
    expect(Utils.quranSurahBreadcrumbLabel(2, title)).toBe(expected);
  });

  test.each([
    ['الْبَقَرَة', '٢ الْبَقَرَة'],
    ['سورة البقرة', '٢ البقرة'],
    ['سُورَةُ البقرة', '٢ البقرة']
  ])('formats the Arabic Surah breadcrumb name from %s', (title, expected) => {
    expect(Utils.quranSurahBreadcrumbLabelAr(2, title)).toBe(expected);
  });

  test('renders Quran h2 breadcrumbs as a named Surah and Passage', async () => {
    const html = normalize(await renderChapterTitle('quran'));

	expect(html).toContain('href="/quran">Quran</a>');
    expect(html).toContain('>2 al-Baqarah</a>');
    expect(html).toContain('>Passage 10</a>');
	expect(html).toContain('href="/quran">القرآن</a>');
	expect(html).toContain('>٢ البقرة</a>');
	expect(html).toContain('>مقطع ١٠</a>');
    expect(html).toContain('title="Bookmark this passage"');
	expect(html).not.toContain('>The Holy Quran</a>');
    expect(html).not.toContain('>Surah 2</a>');
    expect(html).not.toContain('>Section 10</a>');
	expect(html).not.toContain('>السورة ٢</a>');
  });

  test('uses the selected translation book in Study breadcrumbs', async () => {
    const html = normalize(await renderChapterTitle('quran', {
      quranCommentaryBook: {
        type: 'trans',
        alias: 'en-khattab',
        quranBookSlug: 'en-khattab',
        shortName_en: 'Khattab',
        name_en: 'The Clear Quran',
        shortName: 'خطاب',
        title: 'القرآن المبين'
      }
    }));

    expect(html).toContain('title="The Clear Quran" href="/quran/en-khattab">Khattab</a>');
    expect(html).toContain('title="القرآن المبين" href="/quran/en-khattab">خطاب</a>');
    expect(html).not.toContain('href="/quran">Quran</a>');
  });

  test('preserves Chapter and Section terminology for Hadith h2 breadcrumbs', async () => {
    const html = normalize(await renderChapterTitle('test-book'));

	expect(html).toContain('>Hadith</a>');
	expect(html).not.toContain('>Test Hadith Book</a>');
    expect(html).toContain('>Chapter 2</a>');
    expect(html).toContain('>Section 10</span>');
    expect(html).toContain('title="Bookmark this section"');
  });
});
