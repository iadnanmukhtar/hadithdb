'use strict';

const QuranHeadingOutlines = require('../lib/QuranHeadingOutlines');
const QuranTocSubdivisions = require('../lib/QuranTocSubdivisions');

describe('Quran heading outlines', () => {
	const originalSurahs = global.surahs;

	beforeEach(() => {
		global.surahs = [{ num: 2, name_en: 'al-Baqarah', name_ar: 'البقرة' }];
	});

	afterEach(() => {
		jest.restoreAllMocks();
		global.surahs = originalSurahs;
	});

	test('builds shared passage and subsection ranges for reader rails', async () => {
		jest.spyOn(QuranTocSubdivisions, 'quranSectionRangesBySurah').mockResolvedValue({
			2: [{ section: 3, title_en: 'The rejectors', start: 6, end: 20 }]
		});
		jest.spyOn(QuranTocSubdivisions, 'quranSubsectionRangesBySurah').mockResolvedValue({
			2: [{ section: 3, subsection: 1, title_en: 'Their example', start: 17, end: 20 }]
		});

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
	});
});
