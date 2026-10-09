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
			if (sql.includes('MAX(updated_at)')) return [{ updated_at: new Date() }];
			if (sql.includes('SELECT value_ar,value_en,usage_count FROM hdith_narrator_search')) return [
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
			if (sql.includes('MAX(updated_at)')) return [{ updated_at: new Date() }];
			if (sql.includes('SELECT value_ar,value_en,usage_count FROM hdith_narrator_search')) return [
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
	test('uses the catalog and normalizes only when filling the cache', async () => {
		global.query = jest.fn(async sql => {
			if (sql.includes('MAX(updated_at)')) return [{ updated_at: new Date() }];
			if (sql.includes('SELECT value_ar,value_en,usage_count FROM hdith_narrator_search'))
				return [{ value_ar: 'عُثْمَانُ', value_en: 'ʿUthmān', usage_count: 5 }];
			return [];
		});
		await primaryNarratorSuggestions('عثمان');
		await primaryNarratorSuggestions('Uthman');
		expect(global.query.mock.calls.filter(([sql]) => sql.includes('SELECT value_ar,value_en,usage_count FROM hdith_narrator_search'))).toHaveLength(1);
		expect(global.query.mock.calls.some(([sql]) => sql.includes('narrator_pairs'))).toBe(false);
	});

	test('does not publish a lookup invalidated while loading a pair update', async () => {
		let finishOld;
		const oldLoad = new Promise(resolve => { finishOld = resolve; });
		const spy = jest.spyOn(HadithBilingualPairs, 'list')
			.mockReturnValueOnce(oldLoad)
			.mockResolvedValue([{ value_ar: 'عُثْمَانُ', value_en: 'Corrected', usage_count: 5 }]);
		try {
			const pending = primaryNarratorSuggestions('');
			invalidatePrimaryNarratorSuggestionCache();
			finishOld([{ value_ar: 'عثمان', value_en: 'Old', usage_count: 5 }]);
			expect((await pending)[0].narrator_en).toBe('Corrected');
			expect((await primaryNarratorSuggestions(''))[0].narrator_en).toBe('Corrected');
		} finally { spy.mockRestore(); }
	});

	test('catalog lookup retains managed corrections and hidden pairs', async () => {
		global.query = jest.fn(async sql => {
			if (sql.includes('MAX(updated_at)')) return [{ updated_at: new Date() }];
			if (sql.includes('SELECT value_ar,value_en,usage_count FROM hdith_narrator_search')) return [
				{ value_ar: 'عثمان', value_en: 'Old', usage_count: 10 },
				{ value_ar: 'عائشة', value_en: 'Aishah', usage_count: 20 }
			];
			if (sql.includes('FROM hdith_bilingual_pairs')) return [
				{ id: 1, pair_key: 'عثمان', value_ar: 'عُثْمَانُ', value_en: 'Corrected', hidden: 0 },
				{ id: 2, pair_key: normalizePrimaryNarratorSearch('عائشة'), value_ar: 'عائشة', hidden: 1 }
			];
			return [];
		});
		expect(await primaryNarratorSuggestions('')).toEqual([
			expect.objectContaining({ narrator: 'عُثْمَانُ', narrator_en: 'Corrected' })
		]);
	});

});
