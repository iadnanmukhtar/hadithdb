'use strict';

const fs = require('fs');
const path = require('path');

const template = fs.readFileSync(path.join(__dirname, '..', 'views', 'books.ejs'), 'utf8');

describe('tafsir book catalog filters', () => {
	test('supports Arabic, English and bilingual language facets', () => {
		expect(template).not.toContain('data-tafsir-language-filter="en"');
		expect(template).toContain("['ar', 'en', 'en-ar'].includes(badge)");
		expect(template).not.toContain('class="nav nav-tabs tafsir-book-tabs mb-3"');
	});

	test('renders search groups as inclusive filter pills', () => {
		expect(template).toContain("BookGroups.list('tafsir')");
		expect(template).toContain("include('sub-views/book_group_rail.ejs'");
		expect(template).toContain('book-catalog-filter');
		expect(template).toContain('link.dataset.catalogValue');
		expect(template).toContain('data-book-catalog-groups');
		expect(template).toContain("groups.indexOf(activeGroup) >= 0");
	});

	test('shows one bilingual card with a matching language facet', () => {
		expect(template).toContain('Tafsir.uniqueCarouselTafsirs((tafsirs || []).slice())');
		expect(template).toContain('book-language-badge');
		expect(template).toContain("return 'en-ar'");
		expect(template).toContain("badgeOf(card) === activeBadge");
	});
});
