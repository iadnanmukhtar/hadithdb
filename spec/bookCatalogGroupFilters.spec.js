'use strict';

const fs = require('fs');
const path = require('path');

const template = fs.readFileSync(path.join(__dirname, '..', 'views', 'books.ejs'), 'utf8');

describe('books catalog group filters', () => {
	test('keeps the local search separate from the optional collection filters', () => {
		expect(template).toContain('<details class="catalog-facets">');
		expect(template).toContain('class="book-catalog-filter" placeholder="Search books"');
	});

	test('switches between Hadith and Tafsir search groups with the catalog tabs', () => {
		expect(template).toContain("hadith: BookGroups.list('hadith')");
		expect(template).toContain("tafsir: BookGroups.list('tafsir')");
		expect(template).toContain('data-book-catalog-group-scope');
		expect(template).toContain('data-book-catalog-language-filter="en"');
		expect(template).toContain('data-book-catalog-language-filter="ar"');
		expect(template).toContain('setGroupScope');
	});

	test('collapses bilingual tafsir variants into one badged card', () => {
		expect(template).toContain("tafsirs: Tafsir.uniqueCarouselTafsirs((tafsirs || []).slice())");
		expect(template).toContain('book-language-badge');
		expect(template).toContain('Tafsir.commentaryLanguages(book)');
		expect(template).toContain("split(/\\s+/).indexOf(activeLanguage) >= 0");
	});
});
