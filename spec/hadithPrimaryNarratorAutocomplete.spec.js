'use strict';

const { invalidatePrimaryNarratorSuggestionCache, normalizePrimaryNarratorSearch, primaryNarratorSuggestions } = require('../lib/HdithMetadata');

describe('primary narrator autocomplete', () => {
	beforeEach(() => {
		invalidatePrimaryNarratorSuggestionCache();
	});

	afterEach(() => {
		delete global.query;
	});

	test('normalizes Arabic and Latin diacritics for matching', () => {
		expect(normalizePrimaryNarratorSearch('عُثْمَانُ بْنُ عَفَّانَ')).toBe('عثمان بن عفان');
		expect(normalizePrimaryNarratorSearch('ʿUthmān b. ʿAffān')).toBe('uthman b affan');
	});

	test.each(['عثمان بن عفان', 'عُثْمَان', 'Uthman'])('finds the same vocalized narrator for %s', async query => {
		global.query = jest.fn(async () => [
			{ narrator: 'عَائِشَةُ', narrator_en: 'ʿĀʾishah', usage_count: 20 },
			{ narrator: 'عُثْمَانُ بْنُ عَفَّانَ', narrator_en: 'ʿUthmān b. ʿAffān', usage_count: 10 }
		]);

		await expect(primaryNarratorSuggestions(query, 10)).resolves.toEqual([
			expect.objectContaining({ narrator: 'عُثْمَانُ بْنُ عَفَّانَ', narrator_en: 'ʿUthmān b. ʿAffān' })
		]);
	});

	test('deduplicates vocalization variants and honors the requested limit', async () => {
		global.query = jest.fn(async () => [
			{ narrator: 'عَائِشَةُ', narrator_en: 'ʿĀʾishah', usage_count: 20 },
			{ narrator: 'عائشة', narrator_en: 'ʿĀʾishah', usage_count: 2 },
			{ narrator: 'أَنَسٌ', narrator_en: 'Anas', usage_count: 15 }
		]);

		const suggestions = await primaryNarratorSuggestions('', 1);

		expect(suggestions).toHaveLength(1);
		expect(suggestions[0].narrator).toBe('عَائِشَةُ');
	});
});
