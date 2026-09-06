'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');

describe('shared content-filter normalization', () => {
	const client = read('public/static/js/script.js');
	const functionStart = client.indexOf('function normalizeContentFilterText');
	const functionEnd = client.indexOf('\nwindow.normalizeContentFilterText', functionStart);
	const context = {};
	vm.runInNewContext(`${client.slice(functionStart, functionEnd)}\nthis.normalize = normalizeContentFilterText;`, context);

	test.each([
		['عُثْمَانُ', 'عثمان'],
		['الأَلْبَانِيّ', 'الالباني'],
		['ʿUthmān', 'Uthman'],
		['Muʿallaq', 'Muallaq'],
		['al-Albānī', 'al Albani']
	])('folds %s independently of Arabic and Latin diacritics', (decorated, plain) => {
		expect(context.normalize(decorated)).toBe(context.normalize(plain));
	});

	test('is used by every local content-filter surface', () => {
		expect(client).toContain('window.normalizeContentFilterText = normalizeContentFilterText');
		expect(client).toContain('return normalizeContentFilterText(value);');
		for (const file of [
			'views/books.ejs',
			'views/tafsir_books.ejs',
			'views/translation_books.ejs',
			'views/quran_memorization_pages.ejs',
			'views/sub-views/quran_get_started_modal.ejs'
		]) expect(read(file)).toContain('normalizeContentFilterText');
	});
});
