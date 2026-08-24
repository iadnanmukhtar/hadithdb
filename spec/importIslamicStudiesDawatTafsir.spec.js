'use strict';

const {
	BOOK,
	SOURCES,
	chapterUrl,
	formatNumberedBlock,
	parseChapterRanges,
	parsePassagePage,
	passageUrl,
	readOptions,
	sourceUrl,
	validatePassages
} = require('../bin/utils/import-islamicstudies-dawat-tafsir');

describe('IslamicStudies.info Dawat tafsir importer', () => {
	test('uses the requested local tafsir alias and source metadata', () => {
		expect(BOOK).toMatchObject({
			alias: 'dawat',
			shortName_en: 'Dawat',
			name_en: 'Dawat ul Quran',
			author_en: 'Shams Pirzada',
			lang: 'en',
			format: 'md'
		});
	});

	test('builds canonical chapter and passage URLs', () => {
		expect(chapterUrl(2)).toBe('https://islamicstudies.info/quran/dawat.php?sura=2');
		expect(passageUrl(2, 8, 20)).toBe('https://islamicstudies.info/quran/dawat.php?sura=2&verse=8&to=20');
		expect(sourceUrl('ishraq')).toBe('https://islamicstudies.info/quran/ishraq.php');
		expect(chapterUrl(2, 'ishraq')).toBe('https://islamicstudies.info/quran/ishraq.php?sura=2');
		expect(passageUrl(2, 8, 20, 'ishraq')).toBe('https://islamicstudies.info/quran/ishraq.php?sura=2&verse=8&to=20');
	});

	test('configures Ishraq as a separate local English tafsir', () => {
		expect(SOURCES.ishraq).toMatchObject({
			alias: 'ishraq',
			expectedPassages: 556,
			book: {
				alias: 'ishraq',
				shortName_en: 'Ishraq',
				name_en: "Tafsir Ishraq al-Ma'ani",
				author_en: 'Syed Iqbal Zaheer'
			}
		});
		expect(readOptions(['--alias', 'ishraq'])).toMatchObject({
			alias: 'ishraq',
			dryRun: true,
			cacheFile: expect.stringMatching(/islamicstudies\/ishraq\.json$/)
		});
	});

	test('extracts and deduplicates native range links for the requested surah', () => {
		const html = `
			<a href="?sura=1">1. Al-Fatihah</a>
			<a href="?sura=2&verse=8&to=20">8-20 [2]</a>
			<a href="?sura=2&amp;verse=1&amp;to=7">1-7 [1]</a>
			<a href="?sura=2&verse=8&to=20">duplicate</a>
			<a href="?sura=3&verse=1&to=9">another surah</a>`;
		expect(parseChapterRanges(html, 2)).toEqual([
			{ surah: 2, ayahFrom: 1, ayahTo: 7 },
			{ surah: 2, ayahFrom: 8, ayahTo: 20 }
		]);
	});

	test('extracts Ishraq range links without accepting another configured source', () => {
		const html = `
			<a href="?sura=1&verse=1&to=7">1-7 [1]</a>
			<a href="dawat.php?sura=1&verse=1&to=7">Dawat</a>`;
		expect(parseChapterRanges(html, 1, 'ishraq')).toEqual([
			{ surah: 1, ayahFrom: 1, ayahTo: 7 }
		]);
	});

	test('converts source superscripts and commentary into Markdown footnotes', () => {
		const html = `
			<div id="page">
				<center><b>Quran Text of Verse 1-2</b></center>
				<bism>In the name<sup>1</sup> of Allah.</bism>
				<p class="tr">1. Praise <sup>2</sup> be to Allah.</p>
				<p class="tr">2. Most Gracious.<br><br>Most Merciful.</p>
				<div id="notes">
					<p class="nt">1. The opening formula.<br><br>A second paragraph.</p>
					<p class="nt">2: The word means praise.</p>
				</div>
			</div>`;
		expect(parsePassagePage(html, { surah: 1, ayahFrom: 1, ayahTo: 2 })).toEqual({
			surah: 1,
			ayahFrom: 1,
			ayahTo: 2,
			text_en: [
				'### Translation',
				'In the name[^1] of Allah.',
				'**1.** Praise [^2] be to Allah.',
				'**2.** Most Gracious.\n\nMost Merciful.'
			].join('\n\n'),
			footnotes_en: '[^1]: The opening formula.\n\n    A second paragraph.\n\n[^2]: The word means praise.'
		});
	});

	test('reconciles a malformed source marker with its unmatched definition', () => {
		const html = `
			<div id="page">
				<center><b>Quran Text of Verse 1</b></center>
				<p class="tr">1. Translation.<sup>31</sup></p>
				<div id="notes"><p class="nt">131. Commentary body.</p></div>
			</div>`;
		expect(parsePassagePage(html, { surah: 3, ayahFrom: 1, ayahTo: 1 })).toMatchObject({
			text_en: '### Translation\n\n**1.** Translation.[^31]',
			footnotes_en: '[^31]: Commentary body.'
		});
	});

	test('accepts source definitions whose number touches the commentary text', () => {
		const html = `
			<div id="page">
				<center><b>Quran Text of Verse 1</b></center>
				<p class="tr">1. Translation.<sup>38</sup></p>
				<div id="notes"><p class="nt">38.This is the commentary.</p></div>
			</div>`;
		expect(parsePassagePage(html, { surah: 2, ayahFrom: 1, ayahTo: 1 })).toMatchObject({
			text_en: '### Translation\n\n**1.** Translation.[^38]',
			footnotes_en: '[^38]: This is the commentary.'
		});
	});

	test('preserves malformed source note numbers without inventing footnote mappings', () => {
		expect(formatNumberedBlock('23l. A source typo remains visible.')).toBe('**23l.** A source typo remains visible.');
		expect(formatNumberedBlock('Unnumbered commentary remains visible.')).toBe('Unnumbered commentary remains visible.');
	});

	test('validates contiguous full-surah range coverage', () => {
		const passages = Array.from({ length: 114 }, (_, index) => ({
			surah: index + 1,
			ayahFrom: 1,
			ayahTo: 1,
			text_en: 'Text'
		}));
		expect(validatePassages(passages)).toBe(true);
		passages[1].ayahFrom = 2;
		expect(() => validatePassages(passages)).toThrow('Surah 2: first Dawat passage starts at ayah 2');
	});

	test('is dry-run by default and requires full Quran scope', () => {
		expect(readOptions([])).toMatchObject({ dryRun: true, fromSurah: 1, toSurah: 114, buildIndex: true });
		expect(readOptions(['--apply', '--no-index'])).toMatchObject({ dryRun: false, buildIndex: false });
		expect(() => readOptions(['--from-surah', '2'])).toThrow('must cover all surahs 1-114');
		expect(() => readOptions(['--alias', 'unknown'])).toThrow('--alias must be one of: dawat, ishraq');
	});
});
