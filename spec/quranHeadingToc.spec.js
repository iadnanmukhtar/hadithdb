'use strict';

const path = require('path');
const ejs = require('ejs');
const Utils = require('../lib/Utils');

const template = path.join(__dirname, '..', 'views', 'sub-views', 'quran_heading_toc.ejs');

function render(outlines, options = {}) {
  return ejs.renderFile(template, {
    quranHeadingOutlines: outlines,
    quranHeadingInitialSurah: options.surah,
    quranHeadingInitialAyah: options.ayah,
    quranHeadingInitialKey: options.key,
    quranHeadingTranslationAlias: options.translationAlias,
	quranHeadingTafsirBase: options.tafsirBase,
	quranHeadingBookShortName: options.bookShortName,
    commentaryIntroductionArticles: options.introductionArticles,
    req: {},
    utils: {
      quranUrl: (_req, href) => href,
	  quranStudySectionPath: Utils.quranStudySectionPath,
      trimToEmpty: value => value === undefined || value === null ? '' : value.toString().trim()
    }
  });
}

describe('Quran heading rail', () => {
  test('renders the current surah hierarchy and activates the matching subsection', async () => {
    const html = await render({
      2: {
        surah: 2,
        nameEn: 'al-Baqarah',
        previousH1: { number: 1, title: 'al-Fatihah' },
        nextH1: { number: 3, title: 'Ali Imran' },
        sections: [{
          key: '2.1',
          level: 2,
          surah: 2,
          section: 1,
          title: 'Guidance',
          start: 1,
          end: 5,
          subsections: [{
            key: '2.1.1',
            level: 3,
            surah: 2,
            section: 1,
            subsection: 1,
            title: 'The mindful',
            start: 1,
            end: 2
          }]
        }]
      }
    }, { surah: 2, ayah: 2, translationAlias: 'haleem', bookShortName: 'Abdel Haleem' });

    expect(html).toContain('data-quran-heading-toc');
    expect(html.replace(/\s+/g, ' ')).toContain('href="/quran/haleem" data-quran-heading-toc-book>ABDEL HALEEM</a>');
    expect(html.replace(/\s+/g, ' ')).toContain('>2 al-Baqarah</strong>');
    expect(html).toContain('href="/quran/haleem/1" rel="prev"');
    expect(html).toContain('>1 al-Fatihah</a>');
    expect(html).toContain('href="/quran/haleem/3" rel="next"');
    expect(html.indexOf('href="/quran/haleem/1"')).toBeLessThan(html.indexOf('>2 al-Baqarah</strong>'));
    expect(html.indexOf('href="/quran/haleem/3"')).toBeGreaterThan(html.indexOf('>The mindful</a>'));
    expect(html).not.toContain('In this surah');
    expect(html).not.toContain('Surah 2</span>');
    expect(html).toContain('>1 Guidance</a>');
    expect(html).toContain('>The mindful</a>');
    expect(html).not.toContain('2.1 Guidance');
    expect(html).not.toContain('2.1.1 The mindful');
    expect(html).toContain('data-quran-heading-translation-alias="haleem"');
    expect(html).toContain('href="/quran/haleem/2/1" data-quran-heading-key="2.1"');
    expect(html).toContain('href="/quran/haleem/2/1" data-quran-heading-key="2.1.1"');
    expect(html).toMatch(/data-quran-heading-key="2\.1\.1"[^>]*aria-current="location"/);
  });

  test('keeps outline JSON inert and omits an empty rail', async () => {
    const html = await render({
      1: {
        surah: 1,
        nameEn: '</script><script>alert(1)</script>',
        sections: [{
          key: '1.1',
          level: 2,
          surah: 1,
          section: 1,
          title: 'Opening',
          start: 1,
          end: 7,
          subsections: []
        }]
      }
    }, { surah: 1, ayah: 1 });

    expect(html).toContain('\\u003c/script>\\u003cscript>alert(1)\\u003c/script>');
    expect((html.match(/<script/g) || [])).toHaveLength(1);
    expect(await render({})).not.toContain('data-quran-heading-toc');
  });

  test('lets Mushaf synchronize heading URLs with its active translation', () => {
    const client = require('fs').readFileSync(path.join(__dirname, '..', 'public', 'static', 'js', 'script.js'), 'utf8');

    expect(client).toContain('function applyQuranHeadingTranslationScope(alias, force)');
    expect(client).toContain("bookLink.href = quranUrl(alias ? `/quran/${encodeURIComponent(alias)}` : '/quran');");
    expect(client).toContain('applyQuranHeadingTranslationScope(selector.value);');
    expect(client).toContain('applyQuranHeadingTranslationScope(alias);');
    expect(client).toContain('renderQuranHeadingToc(surah)');
		expect(client).toContain('/${heading.surah}/${heading.section}');
  });

	test('links tafsir headings through their parent H2 section', async () => {
	  const html = await render({
	    2: {
	      surah: 2,
	      nameEn: 'al-Baqarah',
	      previousH1: { number: 1, title: 'al-Fatihah' },
	      nextH1: { number: 3, title: 'Ali Imran' },
	      sections: [{
	        key: '2.3',
	        level: 2,
	        surah: 2,
	        section: 3,
	        title: 'The rejectors',
	        start: 6,
	        end: 20,
	        subsections: [{
	          key: '2.3.1',
	          level: 3,
	          surah: 2,
	          section: 3,
	          subsection: 1,
	          title: 'Their example',
	          start: 17,
	          end: 20
	        }]
	      }]
	    }
	  }, { surah: 2, ayah: 17, tafsirBase: '/quran/tafsir/tabari', bookShortName: 'Tafsir al-Tabari' });

	  expect(html).toContain('data-quran-heading-tafsir-base="/quran/tafsir/tabari"');
	  expect(html.replace(/\s+/g, ' ')).toContain('href="/quran/tafsir/tabari" data-quran-heading-toc-book>AL-TABARI</a>');
	  expect(html).not.toContain('>TAFSIR AL-TABARI</a>');
	  expect(html).toContain('href="/quran/tafsir/tabari/2/3" data-quran-heading-key="2.3"');
	  expect(html).toContain('href="/quran/tafsir/tabari/2/3" data-quran-heading-key="2.3.1"');
	  expect(html).toContain('href="/quran/tafsir/tabari/1" rel="prev"');
	  expect(html).toContain('href="/quran/tafsir/tabari/3" rel="next"');
	  expect(html).toMatch(/data-quran-heading-key="2\.3\.1"[^>]*aria-current="location"/);
	});

  test('lists each authored introduction article before the surah hierarchy', async () => {
    const html = await render({
      1: {
        surah: 1,
        nameEn: 'al-Fatihah',
        sections: [{ key: '1.1', level: 2, surah: 1, section: 1, title: 'Opening', start: 1, end: 7, subsections: [] }]
      }
    }, {
      surah: 1,
      ayah: 1,
      tafsirBase: '/quran/tafsir/unal',
      introductionArticles: [
        { h2: 1, title_en: 'Foreword', intro_en: 'Text' },
        { h2: 2, title_en: 'Method', intro_en: 'Text' },
        { h2: 3, title_en: 'Empty', intro_en: '' }
      ]
    });

    expect(html).toMatch(/href="\/quran\/tafsir\/unal\/introduction#introduction-1"[^>]*>Foreword<\/a>/);
    expect(html).toMatch(/href="\/quran\/tafsir\/unal\/introduction#introduction-2"[^>]*>Method<\/a>/);
    expect(html).not.toContain('>Empty</a>');
    expect(html.indexOf('>Foreword</a>')).toBeLessThan(html.indexOf('>1 al-Fatihah</strong>'));
  });

  test('does not list introduction articles after Surah 1', async () => {
	const html = await render({
	  2: {
		surah: 2,
		nameEn: 'al-Baqarah',
		sections: [{ key: '2.1', level: 2, surah: 2, section: 1, title: 'Guidance', start: 1, end: 5, subsections: [] }]
	  }
	}, {
	  surah: 2,
	  ayah: 1,
	  tafsirBase: '/quran/tafsir/unal',
	  introductionArticles: [{ h2: 1, title_en: 'Foreword', intro_en: 'Text' }]
	});

	expect(html).toContain('quran-commentary-introduction-rail-link');
	expect(html).toMatch(/data-quran-introduction-heading="1" hidden>Foreword<\/a>/);
  });
});
