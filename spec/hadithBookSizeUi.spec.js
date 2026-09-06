'use strict';

const fs = require('fs');
const path = require('path');

const read = relativePath => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

describe('hadith book size UI', () => {
	const books = read('views/books.ejs');
	const carousel = read('views/sub-views/bookNav.ejs');
	const toc = read('views/toc.ejs');
	const styles = read('public/static/css/style.css');

	test('shows the filled size indicator in book listings and hadith carousels', () => {
		expect(books).toContain('<%- hadithSizeIndicator(book) %>');
		expect(books).toContain('hadith-size-indicator-${size}');
		expect(carousel).toContain('<%- hadithSizeIndicator(b) %>');
		expect(carousel).toContain('hadith-size-indicator-${size}');
	});

	test('shows and edits hadith size beside the TOC title', () => {
		expect(toc).toContain("tocDisplayBook.type === 'hadith' ? 'hadith' : ''");
		expect(toc).toContain('data-prop="book.size"');
		expect(toc).toContain("'Hadith' %> content size");
		expect(toc).toContain('toc-book-size-unset');
	});

	test('uses the same green, amber, and red filled-circle scale as tafsir', () => {
		expect(styles).toMatch(/\.tafsir-size-indicator-lg,\s*\.hadith-size-indicator-lg\s*\{\s*background: #dc3545;/s);
		expect(styles).toMatch(/\.tafsir-size-indicator-md,\s*\.hadith-size-indicator-md\s*\{\s*background: #ffc107;/s);
		expect(styles).toMatch(/\.tafsir-size-indicator-sm,\s*\.hadith-size-indicator-sm\s*\{\s*background: #198754;/s);
	});
});
