'use strict';

const { cleanSourceTitle, cachedTranslation, stripEnglishTocWrapper, promptForBatch, parseTranslations, cacheDuplicateTitles } = require('../bin/utils/translate-untranslated-tocs');

test('removes a leading Arabic TOC label', () => {
	expect(cleanSourceTitle('بَابُ: فضل الصلاة')).toBe('فضل الصلاة');
	expect(cleanSourceTitle('باب')).toBe('باب');
});

test('gives DeepSeek explicit hadith-book context', () => {
	const messages = promptForBatch([{ id: 7, title: 'باب الطهارة', book_type: 'hadith' }]);
	expect(messages[0].content).toContain('fiqh chapter topics');
	expect(messages[0].content).toContain('Companions');
});

test('requires every requested id and marks generated translations', () => {
	const translated = parseTranslations('{"7":"The Book of Purification"}', [{ id: 7 }]);
	expect(translated.get(7)).toBe('✧ Purification');
	expect(() => parseTranslations('{}', [{ id: 7 }])).toThrow('omitted translation');
});

test('caches repeated normalized headings within the same book type', () => {
	const cached = cacheDuplicateTitles([
		{ id: 1, title: 'باب', book_type: 'hadith' },
		{ id: 2, title: 'باب', book_type: 'hadith' }
	]);
	expect(cached).toHaveLength(1);
	expect(cached[0].duplicateIds).toEqual([1, 2]);
});

test('uses the fixed Section translation for standalone bab at h2 and h3', () => {
	expect(cachedTranslation({ level: 2, title: 'بَابٌ' })).toBe('Section');
	expect(cachedTranslation({ level: 3, title: 'بَـابُ' })).toBe('Section');
	expect(cachedTranslation({ level: 1, title: 'بَابٌ' })).toBeNull();
	expect(cachedTranslation({ level: 2, title: 'باب الطهارة' })).toBeNull();
});

test('removes redundant English TOC wrappers while preserving the AI marker', () => {
	expect(stripEnglishTocWrapper('✧ Musnad of Abu Bakr al-Siddiq')).toBe('✧ Abu Bakr al-Siddiq');
	expect(stripEnglishTocWrapper('✧ From the Musnad of Abd al-Rahman ibn Awf')).toBe('✧ Abd al-Rahman ibn Awf');
	expect(stripEnglishTocWrapper('✧ The Book of Knowledge')).toBe('✧ Knowledge');
	expect(stripEnglishTocWrapper('✧ Mention of the virtues of Bilal')).toBe('✧ virtues of Bilal');
	expect(stripEnglishTocWrapper('✧ Musnad of Abu Bakr (may Allah be pleased with him)')).toBe('✧ Abu Bakr ؓ');
	expect(stripEnglishTocWrapper('✧ Mention of the Hadith of Aisha')).toBe('✧ Aisha');
	expect(stripEnglishTocWrapper('✧ The report refuting that claim')).toBe('✧ The report refuting that claim');
});
