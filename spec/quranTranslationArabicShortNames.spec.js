'use strict';

const { isQuranTranslation, shortNames } = require('../bin/utils/migrate-quran-translation-arabic-short-names');

describe('Quran translation Arabic short names', () => {
	test('provides an Arabic author or team label for every catalog translation', () => {
		expect(Object.keys(shortNames)).toHaveLength(24);
		for (const [alias, shortName] of Object.entries(shortNames)) {
			expect(alias).toMatch(/^(?:en-|yusuf-ali$)/);
			expect(shortName).toMatch(/[\u0600-\u06ff]/);
			expect(shortName).not.toMatch(/[A-Za-z]/);
		}
	});

	test('recognizes stored translations and translation-role tafsirs', () => {
		expect(isQuranTranslation({ type: 'trans' })).toBe(true);
		expect(isQuranTranslation({ type: 'tafsir', properties: JSON.stringify({ quran: { display_as: ['translation'] } }) })).toBe(true);
		expect(isQuranTranslation({ type: 'tafsir', properties: '{}' })).toBe(false);
	});
});
