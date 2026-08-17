'use strict';

const {
	commentaryAfterTranslation,
	findMergeGroups,
	mergedSourceText,
	resolveSourceColumn,
	splitTranslationAndCommentary,
	validateCoverage
} = require('../bin/utils/compact-tafsir-translation-ranges');

function row(id, surah, ayahFrom, ayahTo, translation, commentary) {
	return {
		id,
		bookId: 10,
		surah,
		ayahFrom,
		ayahTo,
		sourceText: `${translation}\n\n${commentary}`
	};
}

describe('tafsir translation range compaction', () => {
	test('selects the source column for single and multilingual tafsirs', () => {
		expect(resolveSourceColumn({ alias: 'english', lang: 'en' })).toBe('text_en');
		expect(resolveSourceColumn({ alias: 'arabic', lang: 'ar' })).toBe('text');
		expect(resolveSourceColumn({ alias: 'urdu', lang: 'ur' })).toBe('text');
		expect(resolveSourceColumn({ alias: 'bilingual', lang: 'ar-en' }, { language: 'en' })).toBe('text_en');
		expect(resolveSourceColumn({ alias: 'bilingual', lang: 'ar-en' }, { language: 'ar' })).toBe('text');
		expect(resolveSourceColumn({ alias: 'custom', lang: 'ar-en' }, { column: 'text_en' })).toBe('text_en');
		expect(() => resolveSourceColumn({ alias: 'bilingual', lang: 'ar-en' })).toThrow(/multiple languages/);
		expect(() => resolveSourceColumn({ alias: 'arabic', lang: 'ar' }, { language: 'en' })).toThrow(/does not declare/);
	});

	test('extracts only commentary after the leading translation paragraph', () => {
		expect(splitTranslationAndCommentary('Translation\r\n\r\nShared commentary\n\nSecond paragraph'))
			.toEqual({ translation: 'Translation', commentary: 'Shared commentary\n\nSecond paragraph' });
		expect(commentaryAfterTranslation('Translation\r\n\r\nShared commentary\n\nSecond paragraph'))
			.toBe('Shared commentary\n\nSecond paragraph');
		expect(commentaryAfterTranslation('Translation only')).toBeNull();
		expect(commentaryAfterTranslation('Translation\n\n  ')).toBeNull();
	});

	test('merges consecutive rows with identical commentary but different translations', () => {
		const rows = [
			row(1, 2, 1, 1, 'Alif Lam Mim', 'First commentary'),
			row(2, 2, 2, 2, 'Translation 2', 'Shared commentary'),
			row(3, 2, 3, 3, 'Translation 3', 'Shared commentary'),
			row(4, 2, 4, 4, 'Translation 4', 'Shared commentary'),
			row(5, 2, 5, 5, 'Translation 5', 'Shared commentary'),
			row(6, 2, 6, 6, 'Translation 6', 'Next commentary')
		];

		const groups = findMergeGroups(rows);
		expect(groups).toEqual([expect.objectContaining({
			surah: 2,
			ayahFrom: 2,
			ayahTo: 5,
			keepId: 2,
			deleteIds: [3, 4, 5]
		})]);
		expect(groups[0].sourceText).toBe([
			'2. Translation 2',
			'3. Translation 3',
			'4. Translation 4',
			'5. Translation 5',
			'',
			'Shared commentary'
		].join('\n'));
		expect(mergedSourceText(groups[0].translations, groups[0].commentary)).toBe(groups[0].sourceText);
	});

	test('does not merge across a gap, surah boundary, or missing commentary', () => {
		const rows = [
			row(1, 1, 1, 1, 'Translation', 'Shared'),
			row(2, 1, 3, 3, 'Translation', 'Shared'),
			row(3, 2, 1, 1, 'Translation', 'Shared'),
			Object.assign(row(4, 2, 2, 2, 'Translation', 'Shared'), { sourceText: 'Translation only' })
		];
		expect(findMergeGroups(rows)).toEqual([]);
	});

	test('accepts partial tafsirs and verifies their exact coverage is preserved', () => {
		const rows = [
			row(1, 1, 1, 2, 'Translation', 'Commentary'),
			row(2, 2, 3, 4, 'Translation', 'Commentary')
		];
		const quranSurahs = new Map();
		for (let surah = 1; surah <= 114; surah++) quranSurahs.set(surah, 10);
		const coverage = validateCoverage(rows, quranSurahs, 'test');

		expect(Array.from(coverage)).toEqual(['1:1', '1:2', '2:3', '2:4']);
		expect(() => validateCoverage(rows, quranSurahs, 'test', coverage)).not.toThrow();
		expect(() => validateCoverage(rows.slice(1), quranSurahs, 'test', coverage)).toThrow(/coverage changed/);
		expect(() => validateCoverage([
			row(1, 1, 1, 2, 'Translation', 'Commentary'),
			row(2, 1, 2, 3, 'Translation', 'Commentary')
		], quranSurahs, 'test')).toThrow(/overlapping/);
	});
});
