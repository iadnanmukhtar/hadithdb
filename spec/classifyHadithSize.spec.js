'use strict';

const { classifyRows } = require('../bin/utils/classify-hadith-size');

describe('hadith content size classification', () => {
	test('classifies Arabic and English-only books against separate medians', () => {
		const rows = [
			{ alias: 'arabic-small', arabicChars: 40, englishOnlyChars: 0 },
			{ alias: 'arabic-medium', arabicChars: 100, englishOnlyChars: 0 },
			{ alias: 'arabic-large', arabicChars: 250, englishOnlyChars: 0 },
			{ alias: 'english-small', arabicChars: 0, englishOnlyChars: 400 },
			{ alias: 'english-medium', arabicChars: 0, englishOnlyChars: 1000 },
			{ alias: 'english-large', arabicChars: 0, englishOnlyChars: 2500 },
			{ alias: 'empty', arabicChars: 0, englishOnlyChars: 0 }
		];

		const { classifiedRows, arabicThresholds, englishThresholds } = classifyRows(rows);
		const byAlias = Object.fromEntries(classifiedRows.map(row => [row.alias, row]));

		expect(arabicThresholds.medianChars).toBe(100);
		expect(englishThresholds.medianChars).toBe(1000);
		expect(byAlias['arabic-small']).toMatchObject({ size: 'sm', contentLanguage: 'ar' });
		expect(byAlias['arabic-medium']).toMatchObject({ size: 'md', contentLanguage: 'ar' });
		expect(byAlias['arabic-large']).toMatchObject({ size: 'lg', contentLanguage: 'ar' });
		expect(byAlias['english-small']).toMatchObject({ size: 'sm', contentLanguage: 'en' });
		expect(byAlias['english-medium']).toMatchObject({ size: 'md', contentLanguage: 'en' });
		expect(byAlias['english-large']).toMatchObject({ size: 'lg', contentLanguage: 'en' });
		expect(byAlias.empty).toMatchObject({ size: null, contentLanguage: null });
	});

	test('uses Arabic totals whenever the book has Arabic content', () => {
		const rows = [
			{ alias: 'bilingual', arabicChars: 100, englishOnlyChars: 10000 },
			{ alias: 'english', arabicChars: 0, englishOnlyChars: 1000 }
		];

		const { classifiedRows } = classifyRows(rows);
		expect(classifiedRows[0]).toMatchObject({ contentLanguage: 'ar', contentChars: 100, size: 'md' });
	});
});
