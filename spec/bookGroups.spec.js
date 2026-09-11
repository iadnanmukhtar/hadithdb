'use strict';
const BookGroups = require('../lib/BookGroups');
const row = (alias, groups, extra = {}) => ({ alias, properties: { searchGroups: groups }, ...extra });
const group = { id: 'custom', label: 'custom collection', scope: 'hadith', ordinal: 1 };

test('seeded groups do not collide with individual books or broaden an individual Adab selection', () => {
	const books = require('./fixtures/bookSearchGroups')();
	const aliases = new Set(books.map(book => book.alias));
	for (const group of BookGroups.list(undefined, books)) expect(aliases.has(group.id)).toBe(false);
	expect(BookGroups.expand(['adab'], 'hadith', books)).toEqual(['adab']);
	expect(BookGroups.expand(['hadith-adab'], 'hadith', books)).toEqual(['adab', 'riyad']);
});

test('includes both Irab editions in Language & Rhetoric', () => {
	const books = require('./fixtures/bookSearchGroups')();
	const languageAndRhetoric = BookGroups.list('tafsir', books).find(group => group.id === 'tafsir-language-rhetoric');
	expect(languageAndRhetoric.aliases).toEqual(expect.arrayContaining(['irab-al-quran', 'irab-daas']));
});

test('reads lowercase names and overlapping memberships from books metadata', () => {
	const books = [row('one', [group]), row('two', [group, { ...group, id: 'second', label: 'second' }])];
	expect(BookGroups.list('hadith', books).map(g => [g.id, g.label, g.aliases])).toEqual([
		['custom', 'Custom Collection', ['one', 'two']], ['second', 'Second', ['two']]
	]);
	expect(BookGroups.expand(['custom', 'two', 'second'], 'hadith', books)).toEqual(['one', 'two']);
	books[0].properties.searchGroups = [{ ...group, label: 'renamed' }];
	expect(BookGroups.list('hadith', books)[0].label).toBe('Renamed');
});

test('honors visibility, scope, and JSON properties returned by MySQL', () => {
	const books = [row('one', [group]), row('hidden', [group], { hidden: 1 }),
		row('tafsir', [{ ...group, id: 'tafsir-group', scope: 'tafsir' }])];
	books[0].properties = JSON.stringify(books[0].properties);
	expect(BookGroups.expand(['custom'], 'hadith', books)).toEqual(['one']);
	expect(BookGroups.expand(['tafsir-group'], 'tafsir', books)).toEqual(['tafsir']);
	expect(BookGroups.list('hadith', [row('plain', [])])).toEqual([]);
});
