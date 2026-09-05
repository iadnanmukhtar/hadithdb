'use strict';

const Utils = require('../lib/Utils');
const { normalizeHadithRow, normalizeSharhRow, normalizeHeadingRow, normalizeTafsirRow } = require('../bin/utils/normalize-hadith-honorifics');
const { normalizeHadithText } = require('../bin/utils/import-hdith-book');
const { sharhToMarkdown } = require('../bin/utils/import-hdith-six-books-enrichment');
const { parseDorarSharhHtml } = require('../lib/DorarSharhImport');

describe('Arabic hadith and sharh honorific normalization', () => {
	test('replaces the legacy English AI marker wherever it occurs', () => {
		expect(Utils.normalizeEnglishAIMarker('[Machine] Translation [Machine] note')).toBe('[AI] Translation [AI] note');
		expect(Utils.normalizeEnglishAIMarker(null)).toBeNull();
	});

	test.each([
		['صَلَّى اللَّهُ عَلَيْهِ وَسَلَّمَ', 'ﷺ'],
		['صَلَّى ٱللَّهُ عَلَيْهِ وَسَلَّمَ', 'ﷺ'],
		['صـلى الله عليه وسلم', 'ﷺ']
	])('normalizes salawat variant %s', (input, expected) => {
		expect(Utils.normalizeArabicHonorifics(input).trim()).toBe(expected);
	});

	test.each([
		['قال -ؓ - ثم مضى', 'قال ؓ ثم مضى'],
		['قال -ﷺ- ثم مضى', 'قال ﷺ ثم مضى']
	])('removes paired dashes around honorifics in %s', (input, expected) => {
		expect(Utils.normalizeArabicHonorifics(input).replace(/[ \t]{2,}/g, ' ').trim()).toBe(expected);
	});

	test.each([
		['رَضِيَ اللَّهُ عَنْهُ', 'ؓ'],
		['رضى الله تعالى عنها', 'ؓ'],
		['رَضِيَ ٱللَّهُ عَنْهُمَا', 'ؓ'],
		['رضي الله عنهم', 'ؓ'],
		['رضي الله عنهن', 'ؓ'],
		['رضي الله عنك', 'ؓ'],
		['رضي الله عني', 'ؓ'],
		['رضي الله عنا', 'ؓ']
	])('normalizes companion blessing variant %s', (input, expected) => {
		expect(Utils.normalizeArabicHonorifics(input).trim()).toBe(expected);
	});

	test('normalizes only scoped Arabic hadith fields and rebuilds derived text', () => {
		expect(normalizeHadithRow({
			id: 7,
			chain: 'عن أنس رضي الله عنه',
			body: 'قال النبي صلى الله عليه وسلم',
			footnote: 'عن عائشة رضي الله عنها'
		})).toEqual([7, 'عن أنس ؓ', 'قال النبي ﷺ', 'عن عائشة ؓ', 'عن أنس ؓ قال النبي ﷺ']);
	});

	test('normalizes Arabic sharh text without changing other columns', () => {
		expect(normalizeSharhRow({ id: 8, hadith_id: 7, text: 'قال صلى الله عليه وسلم', text_en: 'peace be upon him', title: 'Title' }))
			.toEqual({ id: 8, hadithId: 7, text: 'قال ﷺ' });
	});

	test('normalizes Arabic heading titles and introductions without touching English fields', () => {
		expect(normalizeHeadingRow({
			id: 9, bookId: 4, title: 'باب قوله صلى الله عليه وسلم', intro: 'عن عمر رضي الله عنه',
			title_en: 'Chapter title', intro_en: 'English introduction'
		})).toEqual({ id: 9, bookId: 4, title: 'باب قوله ﷺ', intro: 'عن عمر ؓ' });
	});

	test('normalizes Arabic tafsir text without touching translations or footnotes', () => {
		expect(normalizeTafsirRow({
			id: 10, bookId: 100, text: 'قال النبي صلى الله عليه وسلم', text_en: 'English', footnotes: 'Unchanged'
		})).toEqual({ id: 10, bookId: 100, text: 'قال النبي ﷺ' });
	});

	test('keeps hdith.com hadith and sharh importers normalized', () => {
		expect(normalizeHadithText('قال صَلَّى ٱللَّهُ عَلَيْهِ وَسَلَّمَ')).toBe('قال ﷺ');
		expect(sharhToMarkdown('<p>عن ابن عمر رَضِيَ اللَّهُ عَنْهُمَا</p>')).toBe('عن ابن عمر ؓ');
	});

	test('keeps manually imported Dorar Arabic sharh normalized', () => {
		expect(parseDorarSharhHtml('<div id="sharh-text-content">قال صَلَّى اللَّهُ عَلَيْهِ وَسَلَّمَ</div>')).toBe('قال ﷺ');
	});
});
