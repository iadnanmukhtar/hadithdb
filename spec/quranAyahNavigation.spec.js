'use strict';

const QuranAyahNavigation = require('../lib/QuranAyahNavigation');

describe('Quran ayah navigation around the invocation', () => {
	beforeEach(() => {
		global.surahs = [
			{ num: 1, ayahs: 7 },
			{ num: 2, ayahs: 286 },
			{ num: 114, ayahs: 6 }
		];
	});

	test('Previous traverses 1:1 to 1:0 to 114:6', () => {
		expect(QuranAyahNavigation.adjacent(1, 1, -1)).toEqual({ surah: 1, ayah: 0 });
		expect(QuranAyahNavigation.adjacent(1, 0, -1)).toEqual({ surah: 114, ayah: 6 });
	});

	test('Next traverses 114:6 to 1:0 to 1:1', () => {
		expect(QuranAyahNavigation.adjacent(114, 6, 1)).toEqual({ surah: 1, ayah: 0 });
		expect(QuranAyahNavigation.adjacent(1, 0, 1)).toEqual({ surah: 1, ayah: 1 });
	});

	test('ordinary ayah and surah boundaries are unchanged', () => {
		expect(QuranAyahNavigation.adjacent(2, 2, -1)).toEqual({ surah: 2, ayah: 1 });
		expect(QuranAyahNavigation.adjacent(2, 1, -1)).toEqual({ surah: 1, ayah: 7 });
	});
});
