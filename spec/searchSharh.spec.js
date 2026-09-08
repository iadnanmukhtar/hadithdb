'use strict';
jest.mock('../lib/Index', () => ({ docsFromQuery: jest.fn(), docsFromQueryFields: jest.fn().mockResolvedValue([]) }));
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
	test('General defaults include all five sources and preserve explicit exclusions', async () => {
		expect(Search.generalContentFilters([])).toEqual(['hadith', 'sharh', 'sirah', 'quran', 'commentaries']);
		expect(Search.generalContentFilters(['quran'])).toEqual(['quran']);
		expect(Search.generalContentFilters(['bukhari'])).toEqual(['hadith', 'sharh', 'bukhari']);
		await Search.a_searchText('=mercy', Search.generalContentFilters([]), 0, { generalSearch: true });
		const union = Index.docsFromQuery.mock.calls[0][1].bool.filter[0].bool;
		expect(union.minimum_should_match).toBe(1);
		expect(union.should).toHaveLength(5);
		expect(union.should[0].bool.filter).toContainEqual({ terms: { doctype: ['hadith', 'sharh'] } });
		expect(union.should[1].bool.filter).toContainEqual({ term: { book_alias: 'quran' } });
		expect(union.should[2].bool.filter).toContainEqual({ term: { doctype: 'commentary' } });
	});

	test.each([
		[['sirah'], ['sirah-one', 'sirah-two']],
		[['sirah', 'sirah-one'], ['sirah-one']],
		[['hadith'], ['bukhari', 'muslim']],
		[['hadith', 'bukhari'], ['bukhari']],
		[['quran'], ['quran']],
		[['commentaries'], ['tafsir-one']],
		[['sharh'], ['fath-al-bari']]
	])('includes only TOCs belonging to scope %j', async (scope, aliases) => {
		global.books.push(
			{ alias: 'muslim' }, { alias: 'quran' },
			{ alias: 'sirah-one', type: 'sirah' }, { alias: 'sirah-two', type: 'sirah' },
			{ alias: 'tafsir-one', type: 'tafsir' }, { alias: 'hidden-book', hidden: 1 }
		);
		await Search.a_searchText('=abu dujanah', scope, 0, { generalSearch: true });
		const branches = Index.docsFromQuery.mock.calls[0][1].bool.filter[0].bool.should;
		const tocBranch = branches.find(branch => branch.bool.filter.some(filter => filter.term?.doctype === 'toc'));
		expect(tocBranch.bool.filter).toEqual([{ term: { doctype: 'toc' } }, { terms: { book_alias: aliases } }]);
	});

	test('General autocomplete carries mixed-source filters beyond Quran matches', async () => {
		await Search.a_autocomplete('uncommon search phrase', Search.generalContentFilters([]), 10, { generalSearch: true });
		const restCall = Index.docsFromQuery.mock.calls.find(call => call[0] === 'hadiths,toc,commentaries,sharhs');
		expect(restCall).toBeDefined();
		const union = restCall[1].bool.must.bool.filter[0].bool;
		expect(union.should).toHaveLength(5);
		expect(union.should[0].bool.filter).toContainEqual({ terms: { doctype: ['hadith', 'sharh'] } });
	});

	test('General restricts named Tafsir only within the commentary branch', async () => {
		await Search.a_searchText('=mercy', ['hadith', 'commentaries', 'bukhari'], 0, { generalSearch: true, tafsirAliases: ['ibn-kathir'] });
		const branches = Index.docsFromQuery.mock.calls[0][1].bool.filter[0].bool.should;
		expect(branches).toHaveLength(3);
		expect(branches[0].bool.filter).toContainEqual({ terms: { book_alias: ['bukhari'] } });
		expect(JSON.stringify(branches[0])).not.toContain('commentary_alias');
		expect(branches[1].bool.filter).toContainEqual({ term: { commentary_alias: 'ibn-kathir' } });
		expect(branches[0].bool.filter).toContainEqual({ term: { doctype: 'hadith' } });
	});

	test('defaults to both content types while preserving book scope', async () => {
		expect(Search.hadithContentFilters(['bukhari'])).toEqual(['hadith', 'sharh', 'bukhari']);
		expect(Search.hadithContentFilters([])).toEqual(['hadith', 'sharh']);
		await Search.a_searchText('mercy', Search.hadithContentFilters(['bukhari']), 0, { excludeQuranAndTafsir: true });
		const filters = Index.docsFromQuery.mock.calls[0][1].bool.filter;
		expect(filters).toContainEqual({ terms: { doctype: ['hadith', 'sharh'] } });
		expect(filters).toContainEqual({ terms: { book_alias: ['bukhari'] } });
	});
	test('can search Hadith without Sharh and retain the selected book', async () => {
		expect(Search.hadithContentFilters(['hadith', 'bukhari'])).toEqual(['hadith', 'bukhari']);
		await Search.a_searchText('mercy', ['hadith', 'bukhari'], 0, { excludeQuranAndTafsir: true });
		const filters = Index.docsFromQuery.mock.calls[0][1].bool.filter;
		expect(filters).toContainEqual({ term: { doctype: 'hadith' } });
		expect(filters).toContainEqual({ terms: { book_alias: ['bukhari'] } });
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
