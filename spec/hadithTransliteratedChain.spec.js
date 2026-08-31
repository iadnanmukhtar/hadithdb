'use strict';

const Hadith = require('../lib/Hadith');

describe('Hadith transliterated narrator chains', () => {
	test('keeps parsed ALA-LC narrators in the same order as the Arabic chain', () => {
		expect(Hadith.transliteratedNarratorChain('حَدَّثَنَا خَالِدٌ عَنْ سَعِيدٍ عَنْ أَنَسٍ').chain_en)
			.toBe('Khālid > Saʿīd > Anas');
	});
});
