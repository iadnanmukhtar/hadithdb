'use strict';

const fs = require('fs');
const path = require('path');
const Books = require('../lib/Books');

function source(relativePath) {
	return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

describe('commentary footnote rendering properties', () => {
	test('normalizes JSON book properties and defaults footnotes to the current small size', () => {
		const large = Books.normalizeBook({
			id: 1,
			alias: 'unal',
			type: 'tafsir',
			properties: '{"rendering":{"footnotes":"lg"}}'
		}, 'books');

		expect(large.properties).toEqual({ rendering: { footnotes: 'lg' } });
		expect(Books.commentaryFootnoteSize(large)).toBe('lg');
		expect(Books.commentaryFootnoteSize({ properties: { rendering: { footnotes: 'md' } } })).toBe('md');
		expect(Books.commentaryFootnoteSize({ properties: { rendering: { footnotes: 'invalid' } } })).toBe('sm');
		expect(Books.commentaryFootnoteSize({})).toBe('sm');
	});

	test('migrates all commentary books to small and the requested tafsirs to large', () => {
		const migration = source('data/add_book_properties.sql');

		expect(migration).toContain('ADD COLUMN properties JSON DEFAULT NULL');
		expect(migration).toContain("'$.rendering.footnotes'");
		expect(migration).toContain("WHERE type IN ('tafsir', 'trans')");
		for (const alias of ['dawat', 'ishraq', 'en-maududi', 'en-easy-tajwid', 'unal'])
			expect(migration).toContain(`'${alias}'`);
	});

	test('applies the size class to Tafsir, translation, and selected passage footnotes', () => {
		const client = source('public/static/js/script.js');
		const css = source('public/static/css/style.css');

		expect(client).toContain('function quranCommentaryFootnoteSize(book)');
		expect(client).toContain('applyQuranCommentaryFootnoteSize(tafsirText, book);');
		expect(client).toContain('applyQuranCommentaryFootnoteSize(translationText, book);');
		expect(client).toContain('applyQuranCommentaryFootnoteSize(quranSelectedTranslationFootnoteHolder(target), book);');
		expect(css).toContain('.quran-tafsir-text.quran-footnotes-size-lg .footnotes');
		expect(css).toContain('.quran-translation-text.quran-footnotes-size-lg .footnotes');
		expect(css).toContain('.quran-preferred-translation-footnotes.quran-footnotes-size-lg');
		expect(css).toMatch(/\.quran-tafsir-text \.footnotes p:lang\(ar\),[\s\S]*?font-size: calc\(1rem \* var\(--content-font-scale\)\) !important;/);
		expect(css).toMatch(/\.quran-tafsir-text\.quran-footnotes-size-lg \.footnotes,[\s\S]*?font-size: 1em !important;/);
		expect(css).toMatch(/\.quran-tafsir-text\.quran-footnotes-size-md \.footnotes p,[\s\S]*?font-size: inherit !important;/);
	});
});
