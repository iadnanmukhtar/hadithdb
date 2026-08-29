'use strict';

const {
	BOOK,
	hasUnescapedMarkdownBackticks,
	parseSurahPage,
	readOptions,
	sourceUrl,
	validatePassages
} = require('../bin/utils/import-alim-yusuf-ali-tafsir');
const Tafsir = require('../lib/Tafsir');

function page(surah, body) {
	return `<!doctype html><html><head><link rel="canonical" href="${sourceUrl(surah)}"></head><body>
		<h1>Surah ${surah}. Example</h1><div id="translation-content">${body}</div></body></html>`;
}

function ayah(number, translation, notes = '') {
	return `<div id="translation${number}" class="trans-ayah-container">
		<div id="yatTranslation${number}"><h5>${translation}</h5>${notes}</div></div>`;
}

describe('Alim Yusuf Ali tafsir importer', () => {
	test('uses the requested local English tafsir metadata', () => {
		expect(BOOK).toEqual({
			alias: 'yusuf-ali',
			shortName_en: 'Yusuf Ali',
			name_en: "The Meaning of the Holy Qur'an",
			author_en: 'Abdullah Yusuf Ali',
			description: "An English translation and commentary of the Qur'an by Abdullah Yusuf Ali, including the author's explanatory notes.",
			lang: 'en',
			format: 'md',
			size: 'md',
			properties: { quran: { display_as: ['translation', 'tafsir'] } }
		});
		expect(sourceUrl(114)).toBe('https://www.alim.org/translation/yusuf-ali/114/');
	});

	test('parses each ayah translation and its numbered commentary as Markdown footnotes', () => {
		const parsed = parseSurahPage(page(114, [
			ayah(1, `Say: I seek refuge with the Lord of Mankind <sup class="fn">6307</sup> <sup class="fn">6308</sup>`,
				`<p id="yatFNote6307" class="footnotes">The first note.</p>
				<p id="yatFNote6308" class="footnotes">The second note.<br><br>Another paragraph.</p>`),
			ayah(2, 'The King of Mankind')
		].join('')), 114);

		expect(parsed).toEqual([
			{
				surah: 114,
				ayahFrom: 1,
				ayahTo: 1,
				text_en: 'Say: I seek refuge with the Lord of Mankind[^6307][^6308]',
				footnotes_en: '[^6307]: The first note.\n\n[^6308]: The second note.\n\n    Another paragraph.'
			},
			{
				surah: 114,
				ayahFrom: 2,
				ayahTo: 2,
				text_en: 'The King of Mankind',
				footnotes_en: ''
			}
		]);
	});

	test('escapes literal source backticks instead of activating Tafsir backtick rendering', () => {
		const parsed = parseSurahPage(page(1, ayah(1, '`Abdullah explained al-ta`awwudh.')), 1)[0];
		const rendered = Tafsir.renderEnglishCommentaryMarkdown(parsed.text_en);

		expect(parsed.text_en).toBe('\\`Abdullah explained al-ta\\`awwudh.');
		expect(hasUnescapedMarkdownBackticks(parsed.text_en)).toBe(false);
		expect(rendered).toContain('`Abdullah explained al-ta`awwudh.');
		expect(rendered).not.toContain('quran-tafsir-backtick');
	});

	test('rejects source identity, sequence, and footnote mismatches', () => {
		expect(() => parseSurahPage(page(2, ayah(1, 'Text')), 1)).toThrow(/canonical URL/);
		expect(() => parseSurahPage(page(1, ayah(2, 'Text')), 1)).toThrow(/sequential ayah 1/);
		expect(() => parseSurahPage(page(1, ayah(1, 'Text <sup class="fn">9</sup>')), 1))
			.toThrow(/missing definitions: 9/);
	});

	test('preserves repeated source references to one commentary note', () => {
		const parsed = parseSurahPage(page(5, ayah(1,
			'Text <sup class="fn">715</sup> <sup class="fn">715</sup>',
			'<p id="yatFNote715" class="footnotes">One source definition.</p>')), 5)[0];

		expect(parsed.text_en).toBe('Text[^715][^715]');
		expect(parsed.footnotes_en).toBe('[^715]: One source definition.');
	});

	test('reconciles a one-for-one source marker typo with its surplus definition', () => {
		const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
		let parsed;
		try {
			parsed = parseSurahPage(page(25, ayah(1,
				'Text <sup class="fn">3064</sup> <sup class="fn">2065</sup>',
				'<p id="yatFNote3064" class="footnotes">First definition.</p>' +
				'<p id="yatFNote3065" class="footnotes">Second definition.</p>')), 25)[0];
			expect(warning).toHaveBeenCalledWith(expect.stringContaining('marker 2065 with definition 3065'));
		} finally {
			warning.mockRestore();
		}

		expect(parsed.text_en).toBe('Text[^3064][^2065]');
		expect(parsed.footnotes_en).toBe('[^3064]: First definition.\n\n[^2065]: Second definition.');
	});

	test('preserves Yusuf Ali alphanumeric commentary labels', () => {
		const parsed = parseSurahPage(page(2, ayah(1,
			'Text <sup class="fn">300-A</sup>',
			'<p id="yatFNote300-A" class="footnotes">Supplemental definition.</p>')), 2)[0];

		expect(parsed.text_en).toBe('Text[^300-A]');
		expect(parsed.footnotes_en).toBe('[^300-A]: Supplemental definition.');
	});

	test('validates exact contiguous coverage against local Quran verse counts', () => {
		const verseCounts = new Map();
		const passages = [];
		for (let surah = 1; surah <= 114; surah++) {
			verseCounts.set(surah, 1);
			passages.push({ surah, ayahFrom: 1, ayahTo: 1, text_en: 'Text', footnotes_en: '' });
		}
		expect(validatePassages(passages, verseCounts)).toBe(true);
		passages[1].ayahFrom = 2;
		passages[1].ayahTo = 2;
		expect(() => validatePassages(passages, verseCounts)).toThrow(/expected Yusuf Ali ayah 1/);
	});

	test('is dry-run by default and supports explicit apply/index options', () => {
		expect(readOptions([])).toMatchObject({ dryRun: true, buildIndex: true, concurrency: 8, batchSize: 200 });
		expect(readOptions(['--apply', '--no-index'])).toMatchObject({ dryRun: false, buildIndex: false });
		expect(() => readOptions(['--concurrency', '0'])).toThrow(/positive integer/);
	});
});
