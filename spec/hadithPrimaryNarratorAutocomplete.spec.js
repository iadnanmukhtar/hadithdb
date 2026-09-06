'use strict';

const { invalidatePrimaryNarratorSuggestionCache, normalizePrimaryNarratorSearch, primaryNarratorSuggestions } = require('../lib/HdithMetadata');
const HadithBilingualPairs = require('../lib/HadithBilingualPairs');

describe('primary narrator autocomplete', () => {
	beforeEach(() => {
		invalidatePrimaryNarratorSuggestionCache();
		HadithBilingualPairs.resetSchemaForTests();
	});

	afterEach(() => {
		delete global.query;
	});

	test('normalizes Arabic and Latin diacritics for matching', () => {
		expect(normalizePrimaryNarratorSearch('عُثْمَانُ بْنُ عَفَّانَ')).toBe('عثمان بن عفان');
		expect(normalizePrimaryNarratorSearch('ʿUthmān b. ʿAffān')).toBe('uthman b affan');
	});

	test.each(['عثمان بن عفان', 'عُثْمَان', 'Uthman'])('finds the same vocalized narrator for %s', async query => {
		global.query = jest.fn(async sql => {
			if (sql.includes('FROM hdith_bilingual_pairs')) return [];
			if (sql.includes('narrator_pairs')) return [
				{ value_ar: 'عَائِشَةُ', value_en: 'ʿĀʾishah', usage_count: 20 },
				{ value_ar: 'عُثْمَانُ بْنُ عَفَّانَ', value_en: 'ʿUthmān b. ʿAffān', usage_count: 10 }
			];
			return [];
		});

		await expect(primaryNarratorSuggestions(query, 10)).resolves.toEqual([
			expect.objectContaining({ narrator: 'عُثْمَانُ بْنُ عَفَّانَ', narrator_en: 'ʿUthmān b. ʿAffān' })
		]);
	});

	test('deduplicates vocalization variants and honors the requested limit', async () => {
		global.query = jest.fn(async sql => {
			if (sql.includes('FROM hdith_bilingual_pairs')) return [];
			if (sql.includes('narrator_pairs')) return [
				{ value_ar: 'عَائِشَةُ', value_en: 'ʿĀʾishah', usage_count: 20 },
				{ value_ar: 'عائشة', value_en: 'ʿĀʾishah', usage_count: 2 },
				{ value_ar: 'أَنَسٌ', value_en: 'Anas', usage_count: 15 }
			];
			return [];
		});

		const suggestions = await primaryNarratorSuggestions('', 1);

		expect(suggestions).toHaveLength(1);
		expect(suggestions[0].narrator).toBe('عَائِشَةُ');
	});
});
