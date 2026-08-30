'use strict';

const QuranHeadingOutlines = require('../lib/QuranHeadingOutlines');
const Index = require('../lib/Index');
const { Heading } = require('../lib/Model');

describe('Quran heading outlines', () => {
	const originalSurahs = global.surahs;
	const originalQuery = global.query;

	beforeEach(() => {
		global.surahs = [
			{ num: 1, name_en: 'al-Fatihah', name_ar: 'الفاتحة' },
			{ num: 2, name_en: 'al-Baqarah', name_ar: 'البقرة' },
			{ num: 3, name_en: 'Ali Imran', name_ar: 'آل عمران' }
		];
	});

	afterEach(() => {
		jest.restoreAllMocks();
		global.surahs = originalSurahs;
		global.query = originalQuery;
	});

	test('loads reader-rail ranges from Elasticsearch without querying the DB', async () => {
		global.query = jest.fn(() => {
			throw new Error('Quran heading rails must not query the DB');
		});
		const search = jest.spyOn(Index, 'docsFromQueryFields').mockResolvedValue([{
			ordinal: 1,
			level: 2,
			book_alias: 'quran',
			h1: 2,
			h2: 3,
			h2_title_en: 'The rejectors',
			h2_start: '2:6',
			h2_count: 15
		}, {
			ordinal: 2,
			level: 3,
			book_alias: 'quran',
			h1: 2,
			h2: 3,
			h3: 1,
			h3_title_en: 'Their example',
			h3_start: '2:17',
			h3_count: 4
		}]);

		await expect(QuranHeadingOutlines.forSurahs([2, 2])).resolves.toEqual({
			2: {
				surah: 2,
				nameEn: 'al-Baqarah',
				nameAr: 'البقرة',
				previousH1: { number: 1, title: 'al-Fatihah', titleAr: 'الفاتحة' },
				nextH1: { number: 3, title: 'Ali Imran', titleAr: 'آل عمران' },
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
		});
		expect(search).toHaveBeenCalledTimes(1);
		expect(search).toHaveBeenCalledWith(
			Heading.INDEX,
			expect.objectContaining({
				bool: {
					filter: [
						{ term: { book_alias: 'quran' } },
						{ terms: { h1: [2] } },
						{ terms: { level: [2, 3] } }
					]
				}
			}),
			expect.arrayContaining(['start', 'count', 'h2_start', 'h3_start']),
			0,
			500,
			'h1, h2, h3, ordinal'
		);
		expect(global.query).not.toHaveBeenCalled();
	});

	test('orders H2 and H3 links by their starting ayah rather than their stored heading number', () => {
		const outline = QuranHeadingOutlines.buildOutlines([18], [{
			level: 2, h1: 18, h2: 2, h2_title_en: 'Cave youths', h2_start: '18:9', h2_count: 17
		}, {
			level: 2, h1: 18, h2: 1, h2_title_en: 'Opening', h2_start: '18:1', h2_count: 8
		}, {
			level: 3, h1: 18, h2: 2, h3: 4, h3_title_en: 'The sleepers become a sign', h3_start: '18:21', h3_count: 2
		}, {
			level: 3, h1: 18, h2: 2, h3: 6, h3_title_en: 'The youths seek food', h3_start: '18:19', h3_count: 2
		}, {
			level: 3, h1: 18, h2: 2, h3: 5, h3_title_en: 'Say God willing', h3_start: '18:23', h3_count: 2
		}])[18];

		expect(outline.sections.map(section => section.section)).toEqual([1, 2]);
		expect(outline.sections[1].subsections.map(subsection => subsection.subsection)).toEqual([6, 4, 5]);
		expect(outline.sections[1].subsections.map(subsection => subsection.start)).toEqual([19, 21, 23]);
	});
});
