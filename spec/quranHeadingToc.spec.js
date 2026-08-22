'use strict';

const path = require('path');
const ejs = require('ejs');

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
    req: {},
    utils: {
      quranUrl: (_req, href) => href
    }
  });
}

describe('Quran heading rail', () => {
  test('renders the current surah hierarchy and activates the matching subsection', async () => {
    const html = await render({
      2: {
        surah: 2,
        nameEn: 'al-Baqarah',
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
    expect(html.replace(/\s+/g, ' ')).toContain('>ABDEL HALEEM</span>');
    expect(html.replace(/\s+/g, ' ')).toContain('>2 al-Baqarah</strong>');
    expect(html).not.toContain('In this surah');
    expect(html).not.toContain('Surah 2</span>');
    expect(html).toContain('>1 Guidance</a>');
    expect(html).toContain('>The mindful</a>');
    expect(html).not.toContain('2.1 Guidance');
    expect(html).not.toContain('2.1.1 The mindful');
    expect(html).toContain('data-quran-heading-translation-alias="haleem"');
    expect(html).toContain('href="/quran/haleem/2/1/1"');
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

	test('links tafsir headings through the selected tafsir at each heading start', async () => {
	  const html = await render({
	    2: {
	      surah: 2,
	      nameEn: 'al-Baqarah',
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
	  }, { surah: 2, ayah: 17, tafsirBase: '/quran/tafsir/tabari' });

	  expect(html).toContain('data-quran-heading-tafsir-base="/quran/tafsir/tabari"');
	  expect(html).toContain('href="/quran/tafsir/tabari/quran:2:6"');
	  expect(html).toContain('href="/quran/tafsir/tabari/quran:2:17"');
	  expect(html).toMatch(/data-quran-heading-key="2\.3\.1"[^>]*aria-current="location"/);
	});
});
