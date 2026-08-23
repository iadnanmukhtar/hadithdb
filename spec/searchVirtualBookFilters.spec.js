'use strict';

jest.mock('../lib/Index', () => ({
	docsFromQuery: jest.fn()
}));

const Index = require('../lib/Index');
const Search = require('../lib/Search');

function emptySearchResult() {
	const results = [];
	results.total = 0;
	return results;
}

describe('virtual Hadith search filters', () => {
	beforeEach(() => {
		global.settings = { search: { itemsPerPage: 50 } };
		global.books = [{
			alias: 'bukhari',
			hidden: 0,
			shortName_en: 'Bukhari',
			virtual: 0
		}, {
			alias: 'ibnrajab50',
			hidden: 0,
			shortName_en: "Ibn Rajab's Fifty",
			virtual: 1
		}];
		Index.docsFromQuery.mockReset();
		Index.docsFromQuery.mockResolvedValue(emptySearchResult());
	});

	test('matches virtual books through both primary aliases and Hadith membership', async () => {
		await Search.a_searchText('test', ['ibnrajab50'], 0, { excludeQuranAndTafsir: true });

		const query = Index.docsFromQuery.mock.calls[0][1];
		const serialized = JSON.stringify(query);
		expect(serialized).toContain('"book_alias":["ibnrajab50"]');
		expect(serialized).toContain('books:\\"{ibnrajab50}\\"');
		expect(serialized).toContain('"minimum_should_match":1');
	});

	test('keeps ordinary Hadith filters scoped to their primary alias', async () => {
		await Search.a_searchText('test', ['bukhari'], 0, { excludeQuranAndTafsir: true });

		const query = Index.docsFromQuery.mock.calls[0][1];
		const serialized = JSON.stringify(query);
		expect(serialized).toContain('"book_alias":["bukhari"]');
		expect(serialized).not.toContain('books:');
	});
});
