'use strict';

const fs = require('fs');
const path = require('path');

const template = fs.readFileSync(path.join(__dirname, '..', 'views', 'books.ejs'), 'utf8');

describe('books catalog group filters', () => {
	test('uses the wrapped Hadith-home filter layout', () => {
		expect(template).toContain('home-hadith-book-nav book-catalog-group-filters');
		expect(template).toContain('book-carousel-filter-input book-catalog-filter');
	});

	test('switches between Hadith and Tafsir search groups with the catalog tabs', () => {
		expect(template).toContain("hadith: BookGroups.list('hadith')");
		expect(template).toContain("tafsir: BookGroups.list('tafsir')");
		expect(template).toContain('data-book-catalog-group-scope');
		expect(template).toContain('data-book-catalog-language-filter="en"');
		expect(template).toContain('data-book-catalog-language-filter="ar"');
		expect(template).toContain('setGroupScope');
	});
});
