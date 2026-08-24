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

	test('wraps backward from the first introduction section to the final section', async () => {
		jest.spyOn(Index, 'docsFromQueryString').mockImplementation(async (_index, query, _offset, _size, orderBy) => {
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
		expect(current.next.path).toBe('muslim/0/5');
	});

	test('wraps forward from the final section to the introduction', async () => {
		jest.spyOn(Index, 'docsFromQueryString').mockImplementation(async (_index, query, _offset, _size, orderBy) => {
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
		expect(current.next.path).toBe('muslim/0/1');
	});

	test('keeps lazy-loaded Hadith history on the public URL', () => {
		const script = fs.readFileSync(path.join(__dirname, '..', 'public', 'static', 'js', 'script.js'), 'utf8');
		expect(script).toContain("remoteUrl = remoteUrl.replace(/^\\/api(?=\\/)/, '')");
	});
});
