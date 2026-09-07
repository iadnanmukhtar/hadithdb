'use strict';
jest.mock('../lib/Index', () => ({ docsFromQuery: jest.fn() }));
const Index = require('../lib/Index');
const Search = require('../lib/Search');
const Books = require('../lib/Books');
const SharhBooks = require('../lib/SharhBooks');

describe('Sharh book search', () => {
	beforeEach(() => {
		global.settings = { search: { itemsPerPage: 50 } };
		global.books = [
			{ alias: 'bukhari', hidden: 0, shortName_en: 'Bukhari', shortName: 'البخاري' },
			{ id: 101, alias: 'fath-al-bari', type: 'sharh', hidden: 1, shortName_en: 'Fath al-Bari', shortName: 'فتح الباري' }
		];
		Index.docsFromQuery.mockReset();
		Index.docsFromQuery.mockResolvedValue(Object.assign([], { total: 0 }));
	});
	test.each([['kindness', 'text_en^5'], ['الرحمة', 'text^5']])('searches %s within Sharh documents', async (q, field) => {
		await Search.a_searchText(q, ['sharh', 'bukhari'], 0, { excludeQuranAndTafsir: true });
		const query = Index.docsFromQuery.mock.calls[0][1];
		expect(query.bool.filter).toContainEqual({ term: { doctype: 'sharh' } });
		expect(query.bool.filter).toContainEqual({ terms: { book_alias: ['bukhari'] } });
		const clause = query.bool.should.find(clause => clause.bool.filter.term.doctype === 'sharh');
		expect(clause.bool.should[0].multi_match.fields).toContain(field);
		expect(Search.describeBookFilters(['sharh'])).toEqual(['Sharh']);
	});
	test('filters by the stable book ID while accepting its editable alias', async () => {
		await Search.a_searchText('mercy', ['fath-al-bari'], 0, { excludeQuranAndTafsir: true });
		const filters = Index.docsFromQuery.mock.calls[0][1].bool.filter;
		expect(filters).toContainEqual({ terms: { bookId: [101] } });
		expect(filters).toContainEqual({ term: { doctype: 'sharh' } });
		expect(JSON.stringify(filters)).not.toContain('fath-al-bari');
	});
	test('renders separate explanations with current book metadata and the Hadith link', async () => {
		Index.docsFromQuery.mockResolvedValue(Object.assign([
			{ doctype: 'sharh', id: 7, bookId: 101, ref: 'bukhari:1', commentary_alias: 'old-alias', text_en: 'mercy', _highlight: { text_en: ['<i>mercy</i>'] } },
			{ doctype: 'sharh', id: 8, bookId: 101, ref: 'bukhari:2', text: 'رحمة', text_en: 'mercy' }
		], { total: 2 }));
		const results = await Search.a_searchText('mercy', ['sharh'], 0, { excludeQuranAndTafsir: true });
		expect(results).toHaveLength(2);
		expect(results[0]).toMatchObject({ url: '/bukhari:1', commentary_alias: 'fath-al-bari', commentary_fragment_html_en: '<mark>mercy</mark>' });
		expect(results[0].commentary_ref_en).toContain('Fath al-Bari');
		expect(results[0].commentary_ref_ar).toBe('فتح الباري · البخاري:١');
		expect(results[1].commentary_is_bilingual).toBe(true);
	});
	test('resolves metadata by source identity even after names and aliases change', () => {
		const books = [
			{ id: 10, type: 'sharh', alias: 'renamed', properties: { sharh: { source_id: 8, source_title: 'شرح' } } },
			{ id: 11, type: 'sharh', properties: JSON.stringify({ sharh: { source_id: 8, source_title: 'شرح آخر' } }) },
			{ id: 12, type: 'sharh', properties: { sharh: { source_id: 9, source_title: '' } } }
		];
		expect(SharhBooks.bookForEntry({ source_id: 8, source_book_id: -1, source_title: 'شرح' }, books)).toBe(books[0]);
		expect(SharhBooks.bookForEntry({ source_id: 8, source_book_id: -1, source_title: 'شرح آخر' }, books)).toBe(books[1]);
		expect(SharhBooks.bookForEntry({ source_id: 9, source_book_id: 34, source_title: 'changed title' }, books)).toBe(books[2]);
		expect(SharhBooks.bookForEntry({ source_id: 8, source_book_id: -1, source_title: 'unknown' }, books)).toBeNull();
	});
	test('keeps Sharh books classified separately and custom titles distinct', () => {
		expect(Books.normalizeBook(global.books[1], 'books')).toMatchObject({ book_model: 'sharh', hidden: 1 });
		expect(SharhBooks.mappingTitle(-1, 'شرح مختصر')).toBe('شرح مختصر');
		expect(SharhBooks.mappingTitle(34, 'فتح الباري')).toBe('');
	});
});
