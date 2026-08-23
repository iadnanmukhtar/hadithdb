'use strict';

const fs = require('fs');
const path = require('path');
const QuranMushaf = require('../lib/QuranMushaf');
const Search = require('../lib/Search');

const scripts = fs.readFileSync(path.join(__dirname, '..', 'public', 'static', 'js', 'script.js'), 'utf8');

describe('Quran autocomplete Mushaf destinations', () => {
	test('adds canonical Mushaf pages to ayah and Surah suggestions', async () => {
		const pageForRef = jest.spyOn(QuranMushaf, 'pageForRef')
			.mockImplementation(async (surah, ayah) => surah === 75 && ayah === 1 ? 577 : 42);
		try {
			const suggestions = await Search.a_withQuranMushafPages([
				{ type: 'Ayah', is_quran: true, ref: 'quran:75:1', url: '/quran/unal/75/1' },
				{ type: 'Surah', is_quran: true, ref: 'quran:36:1', url: '/quran/36' },
				{ type: 'Hadith', is_quran: false, ref: 'bukhari:1', url: '/bukhari:1' }
			]);

			expect(suggestions[0]).toMatchObject({ mushaf_page: 577, ref: 'quran:75:1' });
			expect(suggestions[1]).toMatchObject({ mushaf_page: 42, ref: 'quran:36:1' });
			expect(suggestions[2]).not.toHaveProperty('mushaf_page');
			expect(pageForRef.mock.calls).toEqual([[75, 1], [36, 1]]);
		} finally {
			pageForRef.mockRestore();
		}
	});

	test('uses the first ayah in a range and leaves unmapped suggestions unchanged', async () => {
		const pageForRef = jest.spyOn(QuranMushaf, 'pageForRef').mockResolvedValue(null);
		try {
			const suggestion = { type: 'Ayah', is_quran: true, ref: 'quran:2:255-257', url: '/quran:2:255-257' };
			const [result] = await Search.a_withQuranMushafPages([suggestion]);

			expect(pageForRef).toHaveBeenCalledWith(2, 255);
			expect(result).toBe(suggestion);
			expect(result).not.toHaveProperty('mushaf_page');
		} finally {
			pageForRef.mockRestore();
		}
	});

	test('scrolls the searched Mushaf ayah below the fixed header', () => {
		expect(scripts).toContain('initQuranMushafSearchAyahScroll(document);');
		expect(scripts).toContain("new URLSearchParams(window.location.search).get('ayah')");
		expect(scripts).toContain('var line = target.closest(\'.quran-mushaf-line\') || target;');
		expect(scripts).toContain('line.getBoundingClientRect().top - navbarOffset - 12');
		expect(scripts).toContain('window.setTimeout(scrollToLine, 320);');
	});
});
