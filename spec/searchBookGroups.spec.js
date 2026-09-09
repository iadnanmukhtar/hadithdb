'use strict';
jest.mock('../lib/Index', () => ({ docsFromQuery: jest.fn() }));
const Search = require('../lib/Search');
const Index = require('../lib/Index');

beforeEach(() => {
	global.settings = { search: { itemsPerPage: 50 } };
	Index.docsFromQuery.mockReset();
	Index.docsFromQuery.mockResolvedValue(Object.assign([], { total: 0 }));
});

test('a new catalog group scopes Hadith search without code changes', async () => {
	global.books = [{ alias: 'custom-book', properties: { searchGroups: [{ id: 'custom-group', label: 'custom group', scope: 'hadith' }] } }];
	await Search.a_searchText('=mercy', Search.generalContentFilters(['custom-group']), 0, { generalSearch: true });
	const branches = Index.docsFromQuery.mock.calls[0][1].bool.filter[0].bool.should;
	expect(branches[0].bool.filter).toContainEqual({ terms: { book_alias: ['custom-book'] } });
	expect(Search.describeBookFilters(['custom-group'])).toEqual(['Custom Group']);
});

test('a catalog Tafsir group expands to exact commentary aliases and scoped TOCs', async () => {
	global.books = ['one', 'two'].map(alias => ({ alias, type: 'tafsir', properties: { searchGroups: [{ id: 'tafsir-small', label: 'mukhtasarat', scope: 'tafsir' }] } }));
	await Search.a_searchText('=mercy', ['commentaries'], 0, { generalSearch: true, tafsirAliases: ['tafsir-small'] });
	const branches = Index.docsFromQuery.mock.calls[0][1].bool.filter[0].bool.should;
	expect(branches[0].bool.filter).toContainEqual({ terms: { commentary_alias: ['one', 'two'] } });
	expect(branches[1].bool.filter).toContainEqual({ terms: { book_alias: ['one', 'two'] } });
});
