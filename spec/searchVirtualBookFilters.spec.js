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

	test('expands the Nine Books filter to the Six Books, Malik, Ahmad, and Darimi', async () => {
		await Search.a_searchText('test', ['ninebooks'], 0, { excludeQuranAndTafsir: true });

		const query = Index.docsFromQuery.mock.calls[0][1];
		const serialized = JSON.stringify(query);
		expect(serialized).toContain('"book_alias":["bukhari","muslim","abudawud","tirmidhi","nasai","ibnmajah","malik","ahmad","darimi"]');
		expect(Search.describeBookFilters(['kutubarbaah', 'sixbooks', 'ninebooks'])).toEqual(['Four Sunan', 'Six Books', 'Nine Books']);
	});
	test('expands Sihah to its exact member books', async () => {
		await Search.a_searchText('test', ['sihah'], 0, { excludeQuranAndTafsir: true });
		expect(JSON.stringify(Index.docsFromQuery.mock.calls[0][1])).toContain(JSON.stringify({ book_alias: ['bukhari', 'muslim', 'malik', 'ibnhibban', 'ibnkhuzaymah', 'hakim'] }));
		expect(Search.describeBookFilters(['sihah'])).toEqual(['Sihah']);
	});

	test('expands Sunan to its exact member books', async () => {
		await Search.a_searchText('test', ['sunan'], 0, { excludeQuranAndTafsir: true });
		expect(JSON.stringify(Index.docsFromQuery.mock.calls[0][1])).toContain(JSON.stringify({ book_alias: ['abudawud', 'tirmidhi', 'nasai', 'ibnmajah', 'darimi', 'daraqutni', 'nasai-kubra', 'bayhaqi'] }));
		expect(Search.describeBookFilters(['sunan'])).toEqual(['Sunan']);
	});

	test('expands Masanid to its exact member books', async () => {
		await Search.a_searchText('test', ['masanid'], 0, { excludeQuranAndTafsir: true });
		expect(JSON.stringify(Index.docsFromQuery.mock.calls[0][1])).toContain(JSON.stringify({ book_alias: ['ahmad', 'bazzar'] }));
		expect(Search.describeBookFilters(['masanid'])).toEqual(['Masanid']);
	});

	test('expands Musannafat to its exact member books', async () => {
		await Search.a_searchText('test', ['musannaf'], 0, { excludeQuranAndTafsir: true });
		expect(JSON.stringify(Index.docsFromQuery.mock.calls[0][1])).toContain(JSON.stringify({ book_alias: ['malik', 'abdalrazzaq', 'ibnabishaybah'] }));
		expect(Search.describeBookFilters(['musannaf'])).toEqual(['Musannafat']);
	});

	test('expands Maajim to its exact member books', async () => {
		await Search.a_searchText('test', ['maajim'], 0, { excludeQuranAndTafsir: true });
		expect(JSON.stringify(Index.docsFromQuery.mock.calls[0][1])).toContain(JSON.stringify({ book_alias: ['tabarani-saghir', 'tabarani-awsat', 'tabarani'] }));
		expect(Search.describeBookFilters(['maajim'])).toEqual(['Maajim']);
	});

});
