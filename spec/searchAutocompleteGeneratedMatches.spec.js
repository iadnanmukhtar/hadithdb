'use strict';

const Index = require('../lib/Index');
const Search = require('../lib/Search');
const Surahs = require('../lib/Surahs');

describe('generated Quran autocomplete matches', () => {
	let originalSurahs;

	beforeEach(() => {
		originalSurahs = Surahs.surahs.slice();
		Surahs.surahs.length = 0;
		Surahs.surahs.push({
			num: 52,
			name_en: 'At-Tur',
			name_ar: 'الطور',
			ayahs: 49,
			aliases: ['At-Tur', 'Tur', 'الطور', 'طور']
		});
	});

	afterEach(() => {
		jest.restoreAllMocks();
		Search.invalidateQuranAyahSearchCache();
		Surahs.surahs.length = 0;
		Surahs.surahs.push(...originalSurahs);
	});

	test.each([
		['الطور', 'الطُّورِ'],
		['Tur', 'Mount Tur']
	])('keeps the Surah suggestion and includes matching ayahs for %s', async (query, ayahText) => {
		jest.spyOn(Index, 'docsFromQueryFields').mockResolvedValue([{
			id: 52001,
			hId: 52001,
			ref: 'quran:52:1',
			path: 'quran:52:1',
			book_alias: 'quran',
			book_ordinal: 1,
			ordinal: 1,
			h1: 52,
			h1_title_en: 'At-Tur',
			h1_title: 'الطور',
			numInChapter: 1,
			remark: 2,
			body: query === 'الطور' ? ayahText : 'وَالطُّورِ',
			body_en: query === 'Tur' ? ayahText : 'By the Mount'
		}]);
		jest.spyOn(Index, 'docsFromQuery').mockResolvedValue([]);

		const suggestions = await Search.a_autocomplete(query, ['quran', 'commentaries'], 10);

		expect(suggestions[0]).toMatchObject({ type: 'Surah', ref: 'quran:52:1' });
		expect(suggestions.some(item => item.type === 'Ayah' && item.ref === 'quran:52:1')).toBe(true);
	});
});
