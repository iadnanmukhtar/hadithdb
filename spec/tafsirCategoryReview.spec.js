'use strict';
const { planUpdates } = require('../bin/utils/reclassify-tafsir-books');
const seed = require('../bin/utils/book-search-groups-seed.json').filter(group => group.scope === 'tafsir');
const review = require('../bin/utils/tafsir-category-review.json');
const BookGroups = require('../lib/BookGroups');
const fixture = require('./fixtures/bookSearchGroups');

test('requested categories replace the previous taxonomy in the supplied order', () => {
  expect(seed.map(group => group.label)).toEqual(['English', 'Classical', 'Comprehensive', 'Narrations', 'Interpretive', 'Legal', 'Language', 'Coherence', 'Modern', 'Study Aids', 'Concise']);
  expect(seed.map(group => group.aliases.length)).toEqual([14, 20, 11, 9, 31, 5, 13, 4, 29, 6, 16]);
  expect(review.entries).toHaveLength(61);
  for (const entry of review.entries.filter(entry => !entry.preserveMemberships)) {
    expect(seed.some(group => group.aliases.includes(entry.alias))).toBe(true);
  }
  for (const group of seed) {
    expect(new Set(group.aliases).size).toBe(group.aliases.length);
    for (const alias of group.aliases) expect(review.entries.some(entry => entry.alias === alias && !entry.preserveMemberships)).toBe(true);
  }
});

test('requested overlaps and exact classical order are retained', () => {
  const books = fixture();
  expect(BookGroups.expand(['tafsir-major'], 'tafsir', books)).toEqual('tabari samarqandi abu-zamanayn thalabi makki mawardi basit wajiz samaani baghawi zamakhshari ibn-atiyah ibn-al-jawzi razi qurtubi baydawi nasafi abu-hayyan ibn-juzay ibn-kathir'.split(' '));
  expect(BookGroups.expand(['tafsir-legal'], 'tafsir', books)).toEqual('qurtubi ibn-juzay shanqiti en-maarif-al-quran ibn-uthaymin'.split(' '));
  expect(BookGroups.expand(['tafsir-other'], 'tafsir', books)).toEqual('en-easy-tajwid en-wahidi qiraat irab-al-quran irab-daas khadiri'.split(' '));
  expect(BookGroups.expand(['tafsir-coherence'], 'tafsir', books)).toEqual('biqaii ibn-ashur tadabbur-wa-amal shanqiti'.split(' '));
  expect(BookGroups.expand(['tafsir-mukhtasarat'], 'tafsir', books)).toContain('mokhtasar');
  expect(BookGroups.expand(['tafsir-contemporary'], 'tafsir', books)).toContain('yasir');
});

test('English category is determined by measured commentary coverage rather than language labels', () => {
  const english = seed.find(group => group.id === 'tafsir-english');
  expect(english.aliases).toEqual(review.englishCoverage.filter(row => row.commentaryRows > 0 && row.englishRows / row.commentaryRows >= 0.9).map(row => row.alias));
  expect(english.aliases).toContain('ibn-kathir');
  expect(english.aliases).not.toContain('saadi');
  expect(english.aliases).not.toContain('rida');
});

function appliedRows() {
  const fixtures = fixture();
  return review.entries.map(entry => ({ ...(entry.preserveMemberships ? { alias: entry.alias, type: 'tafsir', hidden: 1, properties: { searchGroups: [{ id: 'existing-hidden-group', scope: 'tafsir' }] } } : fixtures.find(row => row.alias === entry.alias)), id: entry.id }));
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


test('hidden omitted books keep their categories and cannot silently become visible', () => {
  const rows = appliedRows();
  expect(planUpdates(rows)).toEqual([]);
  rows.find(row => row.hidden === 1).hidden = 0;
  expect(() => planUpdates(rows)).toThrow('Previously hidden book is now visible');
});
