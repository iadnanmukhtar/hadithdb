'use strict';
const BookGroups = require('../lib/BookGroups');
const Tafsir = require('../lib/Tafsir');
const { plan, changes } = require('../bin/utils/update-translation-dates');
afterEach(() => { delete global.commentaries; });
test('publication centuries use the 2000/2001 boundary, chronological order, and visibility', () => {
 const rows = [{ alias: 'new', published_year: 2001 }, { alias: 'old', published_year: 1930 }, { alias: 'last', published_year: 2000 }, { alias: 'unknown' }, { alias: 'hidden', published_year: 1920, hidden: 1 }];
 expect(BookGroups.translationGroups(rows).map(group => [group.id, group.label, group.aliases])).toEqual([
  ['trans-20th-century', '20th Century', ['old', 'last']], ['trans-21st-century', '21st Century', ['new']]
 ]);
});
test('translation presentation preserves shared Hijri death and sorts mixed catalog roles', () => {
 global.commentaries = [
  { alias: 'new', hidden: 0, type: 'trans', published_year: 2015 },
  { alias: 'yusuf-ali', hidden: 0, type: 'tafsir', published_year: 1934, death: 1372, properties: { quran: { display_as: ['trans'], translationBibliography: { deathLabel: 'd. 1953 CE' } } } }
 ];
 const rows = Tafsir.visibleTranslationsSync();
 expect(rows.map(row => row.alias)).toEqual(['yusuf-ali', 'new']);
 expect(rows[0]).toMatchObject({ death: 1372, translationDeathLabel: 'd. 1953 CE', quranBookSlug: 'yusuf-ali' });
 expect(global.commentaries[1].death).toBe(1372);
});
test('date migration preserves unrelated metadata, is idempotent, and rejects conflicting edits', () => {
 const rows = changes.map(change => ({ id: change.id, alias: change.alias, published_year: change.beforeYear, properties: JSON.stringify({ custom: 'keep', quran: { display_as: ['trans'] }, searchGroups: [{ id: 'existing' }] }) }));
 const updates = plan(rows);
 expect(updates).toHaveLength(changes.length);
 expect(updates[0].properties).toMatchObject({ custom: 'keep', quran: { display_as: ['trans'] }, searchGroups: [{ id: 'existing' }] });
 expect(plan(updates.map(update => ({ ...update.row, published_year: update.published_year, properties: update.properties })))).toEqual([]);
 rows[0].published_year = 1900;
 expect(() => plan(rows)).toThrow('Publication date changed');
});
