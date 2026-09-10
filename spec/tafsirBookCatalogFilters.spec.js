'use strict';

const fs = require('fs');
const path = require('path');

const template = fs.readFileSync(path.join(__dirname, '..', 'views', 'tafsir_books.ejs'), 'utf8');

describe('tafsir book catalog filters', () => {
	test('uses English and Arabic filters instead of language tabs', () => {
		expect(template).toContain('data-tafsir-language-filter="en"');
		expect(template).toContain('data-tafsir-language-filter="ar"');
		expect(template).not.toContain('class="nav nav-tabs tafsir-book-tabs mb-3"');
	});

	test('renders search groups as inclusive filter pills', () => {
		expect(template).toContain("BookGroups.list('tafsir')");
		expect(template).toContain('home-hadith-book-nav tafsir-book-group-filters');
		expect(template).toContain('book-carousel-filter-input tafsir-book-filter');
		expect(template).toContain('data-tafsir-group-filter');
		expect(template).toContain('data-tafsir-book-groups');
		expect(template).toContain("groups.indexOf(activeGroup) >= 0");
	});
});
