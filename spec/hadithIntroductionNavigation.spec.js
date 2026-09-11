'use strict';

const fs = require('fs');
const path = require('path');
const Index = require('../lib/Index');
const HadithHeadingNavigation = require('../lib/HadithHeadingNavigation');

function heading(overrides) {
	return {
		book_alias: 'muslim',
		book_id: 2,
		level: 2,
		h1: 0,
		h2: 1,
		ordinal: 100,
		path: 'muslim/0/1',
		...overrides
	};
}

describe('Hadith introduction chapter navigation', () => {
	afterEach(() => jest.restoreAllMocks());

	test('loads ordinary previous and next headings concurrently without an introduction lookup', async () => {
		let resolvePrevious;
		const lookup = jest.spyOn(Index, 'docsFromQueryString').mockImplementation(async (_index, query) => {
			if (query.includes('ordinal:<500'))
				return new Promise(resolve => { resolvePrevious = resolve; });
			if (query.includes('ordinal:>500'))
				return [heading({ h1: 4, h2: 2, ordinal: 501, path: 'muslim/4/2' })];
			return [];
		});
		const current = heading({ h1: 4, h2: 1, ordinal: 500, path: 'muslim/4/1' });
		const pending = HadithHeadingNavigation.applySameBookHeadingNavigation(current);

		await Promise.resolve();
		expect(lookup).toHaveBeenCalledTimes(2);
		expect(lookup.mock.calls.some(call => call[1].includes('h1:0'))).toBe(false);
		resolvePrevious([heading({ h1: 3, h2: 9, ordinal: 499, path: 'muslim/3/9' })]);
		await pending;

		expect(current.prev.path).toBe('muslim/3/9');
		expect(current.next.path).toBe('muslim/4/2');
	});

	test('keeps a populated chapter zero section on its hadith route', async () => {
		jest.spyOn(Index, 'docsFromQueryString')
			.mockResolvedValueOnce([heading({ h2_count: 4 })])
			.mockResolvedValueOnce([heading({ h1: 1, h2: 2, ordinal: 201, path: 'muslim/1/2' })]);
		const current = heading({ h1: 1, h2: 1, ordinal: 200, path: 'muslim/1/1' });
		await HadithHeadingNavigation.applySameBookHeadingNavigation(current);
		expect(current.prev.path).toBe('muslim/0/1');
	});

	test('moves from an empty parent section to an intervening populated decimal chapter', async () => {
		const lookup = jest.spyOn(Index, 'docsFromQueryString').mockImplementation(async (_index, query) => {
			if (query.includes('ordinal:<100')) return [];
			if (query.includes('level:2') && query.includes('ordinal:>100'))
				return [heading({ h1: 1.4, h2: 2, ordinal: 140, path: 'ahmad/1.40/2' })];
			if (query.includes('level:1') && query.includes('ordinal:>100'))
				return [
					heading({ level: 1, h1: 1.2, h2: null, h1_count: 81, ordinal: 120, path: 'ahmad/1.20' }),
					heading({ level: 1, h1: 1.3, h2: null, h1_count: 317, ordinal: 130, path: 'ahmad/1.30' })
				];
			return [];
		});
		const current = heading({ book_alias: 'ahmad', h1: 1, h2: 1, h2_count: 0, ordinal: 100, path: 'ahmad/1/1' });

		await HadithHeadingNavigation.applySameBookHeadingNavigation(current);

		expect(current.next.path).toBe('ahmad/1.20');
	});

	test('wraps backward from the first introduction section to the final section', async () => {
		const lookup = jest.spyOn(Index, 'docsFromQueryString').mockImplementation(async (_index, query, _offset, _size, orderBy) => {
			if (query.includes('h1:0')) return [heading({})];
			if (query.includes('ordinal:<100')) return [];
			if (query.includes('ordinal:>100')) return [heading({ h2: 5, ordinal: 105, path: 'muslim/0/5' })];
			if (query === 'book_alias:muslim AND level:2' && orderBy === 'ordinal DESC')
				return [heading({ h1: 56, h2: 8, ordinal: 9999, path: 'muslim/56/8' })];
			return [];
		});
		const current = heading({});

		await HadithHeadingNavigation.applySameBookHeadingNavigation(current);

		expect(current.prev.path).toBe('muslim/56/8');
		expect(current.next.path).toBe('muslim/introduction');
		expect(lookup).toHaveBeenCalledTimes(3);
	});

	test('wraps forward from the final section to the introduction', async () => {
		const lookup = jest.spyOn(Index, 'docsFromQueryString').mockImplementation(async (_index, query, _offset, _size, orderBy) => {
			if (query.includes('h1:0')) return [heading({})];
			if (query.includes('ordinal:<9999')) return [heading({ h1: 56, h2: 7, ordinal: 9998, path: 'muslim/56/7' })];
			if (query.includes('ordinal:>9999')) return [];
			if (query === 'book_alias:muslim AND level:2' && orderBy === 'ordinal ASC')
				return [heading({})];
			return [];
		});
		const current = heading({ h1: 56, h2: 8, ordinal: 9999, path: 'muslim/56/8' });

		await HadithHeadingNavigation.applySameBookHeadingNavigation(current);

		expect(current.prev.path).toBe('muslim/56/7');
		expect(current.next.path).toBe('muslim/introduction');
		expect(lookup).toHaveBeenCalledTimes(3);
	});

	test('keeps lazy-loaded Hadith history on the public URL', () => {
		const script = fs.readFileSync(path.join(__dirname, '..', 'public', 'static', 'js', 'script.js'), 'utf8');
		expect(script).toContain("remoteUrl = remoteUrl.replace(/^\\/api(?=\\/)/, '')");
	});
});
