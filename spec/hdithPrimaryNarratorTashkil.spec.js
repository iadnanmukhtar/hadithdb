'use strict';

const { parseCorrections, serializeRows, withoutTashkil } = require('../bin/hdithPrimaryNarratorTashkil');

describe('primary narrator tashkil round trip', () => {
	test('serializes an editable tab-separated narrator list', () => {
		const text = serializeRows([{ source_slug: 'p-4307', name: 'عثمان بن عفان', name_tashkil: '', ala_lc: '', hadith_count: 12 }]);
		expect(text).toBe('source_slug\tname\tname_tashkil\tala_lc\thadith_count\np-4307\tعثمان بن عفان\t\t\t12\n');
	});

	test('loads completed tashkil and supplied ALA-LC corrections verbatim', () => {
		const corrections = parseCorrections(`source_slug\tname\tname_tashkil\tala_lc\thadith_count
p-4307\tعثمان بن عفان\tعُثْمَانُ بْنُ عَفَّانَ\tʿUthmān b. ʿAffān\t12
p-3320\tأبو هريرة الدوسي\t\t\t100
`);
		expect(corrections).toEqual([{
			sourceSlug: 'p-4307', name: 'عثمان بن عفان', nameTashkil: 'عُثْمَانُ بْنُ عَفَّانَ', alaLc: 'ʿUthmān b. ʿAffān'
		}]);
	});

	test('rejects changes other than tashkil', () => {
		expect(() => parseCorrections(`source_slug\tname\tname_tashkil\thadith_count
p-4307\tعثمان بن عفان\tعُمَرُ بْنُ الْخَطَّابِ\t12
`)).toThrow(/differ from name only by tashkil/);
	});

	test('requires ALA-LC when the new format supplies a corrected narrator', () => {
		expect(() => parseCorrections(`source_slug\tname\tname_tashkil\tala_lc\thadith_count
p-4307\tعثمان بن عفان\tعُثْمَانُ بْنُ عَفَّانَ\t\t12
`)).toThrow(/ala_lc is required/);
	});

	test('normalizes Arabic tashkil for validation', () => {
		expect(withoutTashkil('عُثْمَانُ بْنُ عَفَّانَ')).toBe('عثمان بن عفان');
	});
});
