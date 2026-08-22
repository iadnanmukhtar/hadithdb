'use strict';

const QuranHeadingOutlines = require('../lib/QuranHeadingOutlines');
const Index = require('../lib/Index');
const { Heading } = require('../lib/Model');

describe('Quran heading outlines', () => {
	const originalSurahs = global.surahs;
	const originalQuery = global.query;

	beforeEach(() => {
		global.surahs = [{ num: 2, name_en: 'al-Baqarah', name_ar: 'البقرة' }];
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
			'ordinal'
		);
		expect(global.query).not.toHaveBeenCalled();
	});
});
