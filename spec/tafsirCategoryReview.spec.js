'use strict';
const { planUpdates } = require('../bin/utils/reclassify-tafsir-books');
const seed = require('../bin/utils/book-search-groups-seed.json').filter(group => group.scope === 'tafsir');
const review = require('../bin/utils/tafsir-category-review.json');
const BookGroups = require('../lib/BookGroups');
const fixture = require('./fixtures/bookSearchGroups');

test('every reviewed tafsir has a descriptive category independent of prominence or period', () => {
  expect(review.entries).toHaveLength(61);
  for (const entry of review.entries) {
    expect(seed.some(group => !['tafsir-major', 'tafsir-contemporary'].includes(group.id) && group.aliases.includes(entry.alias))).toBe(true);
  }
  for (const group of seed) {
    expect(new Set(group.aliases).size).toBe(group.aliases.length);
    for (const alias of group.aliases) expect(review.entries.some(entry => entry.alias === alias)).toBe(true);
  }
});

test('historical importance overlaps with method and format across scholarly traditions', () => {
  const books = fixture();
  expect(BookGroups.expand(['tafsir-major'], 'tafsir', books)).toEqual(expect.arrayContaining(['razi', 'zamakhshari', 'baydawi', 'nasafi', 'ibn-kathir', 'ibn-ashur', 'rida', 'en-maududi']));
  expect(BookGroups.expand(['tafsir-encyclopedic'], 'tafsir', books)).toContain('razi');
  expect(BookGroups.expand(['tafsir-mukhtasarat'], 'tafsir', books)).toContain('baydawi');
  expect(BookGroups.expand(['tafsir-other'], 'tafsir', books)).not.toEqual(expect.arrayContaining(['shanqiti', 'biqaii']));
  expect(BookGroups.expand(['tafsir-quran-by-quran'], 'tafsir', books)).toContain('shanqiti');
  expect(BookGroups.expand(['tafsir-coherence'], 'tafsir', books)).toContain('biqaii');
});

function appliedRows() {
  const fixtures = fixture();
  return review.entries.map(entry => ({ ...fixtures.find(row => row.alias === entry.alias), id: entry.id }));
}

test('migration is idempotent, preserves non-tafsir memberships, and refuses concurrent edits', () => {
  const rows = appliedRows();
  rows[0].properties.searchGroups.unshift({ id: 'private-reading-list', scope: 'personal', label: 'My list' });
  rows[0].properties.unrelated = { preserve: true };
  expect(planUpdates(rows)).toEqual([]);
  rows[1].properties.searchGroups[0].label = 'User edit';
  expect(() => planUpdates(rows)).toThrow('Concurrent membership edit');
});

test('migration refuses missing or newly added tafsir identities', () => {
  const rows = appliedRows();
  expect(() => planUpdates(rows.slice(1))).toThrow('Book identity changed');
  expect(() => planUpdates([...rows, { id: 99999, alias: 'new-tafsir', type: 'tafsir' }])).toThrow('Unreviewed tafsir');
});
