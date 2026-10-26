'use strict';
const { validatePlan, run } = require('../bin/utils/enrich-book-display-names');
const plan = require('../bin/utils/book-display-names-plan.json');
const expandedPlan = require('../bin/utils/book-author-short-names-expanded-plan.json');

test('expanded bilingual author names apply as a separate idempotent follow-up', async () => {
  expect(() => validatePlan(expandedPlan)).not.toThrow();
  const bayhaqi = expandedPlan.entries.find(entry => entry.alias === 'bayhaqi');
  expect(bayhaqi.fields.authorShortName_en.after).toBe('Abu Bakr al-Bayhaqi');
  expect(bayhaqi.fields.authorShortName.after).toBe('أَبُو بَكْرٍ الْبَيْهَقِيُّ');
  const rows = expandedPlan.entries.map(entry => ({ id: entry.id, alias: entry.alias,
    ...Object.fromEntries(Object.entries(entry.fields).map(([field, change]) => [field, change.before])) }));
  const query = jest.fn(async sql => sql.startsWith('SELECT *') ? rows : []);
  expect((await run(query, false, expandedPlan)).books).toBe(21);
  rows.forEach(row => Object.entries(expandedPlan.entries.find(entry => entry.id === row.id).fields).forEach(([field, change]) => {
    expect(change.after.trim().split(/\s+/).length).toBeGreaterThanOrEqual(2);
    row[field] = change.after;
  }));
  expect((await run(query, false, expandedPlan)).books).toBe(0);
});

function currentRows() {
  return plan.entries.map(entry => ({ id: entry.id, alias: entry.alias, properties: '{"preserve":true}', ...Object.fromEntries(Object.entries(entry.fields).map(([field, change]) => [field, change.before])) }));
}

test('the reviewed plan is valid and distinct book/author short names remain paired', () => {
  expect(() => validatePlan(plan)).not.toThrow();
  const muslim = plan.entries.find(entry => entry.alias === 'muslim');
  expect(muslim.fields.authorShortName_en.after).toBe('Muslim b. al-Hajjaj');
  expect(muslim.fields.authorShortName.after).toBe('مُسْلِمُ بْنُ الْحَجَّاجِ');
});

test('dry run changes no data and reports no updates after applying the plan', async () => {
  const rows = currentRows();
  const query = jest.fn(async sql => sql.startsWith('SELECT *') ? rows : []);
  const dry = await run(query, false);
  expect(dry.books).toBe(plan.entries.length);
  expect(query.mock.calls.some(([sql]) => sql.startsWith('UPDATE'))).toBe(false);
  expect(query).toHaveBeenLastCalledWith('ROLLBACK');
  rows.forEach(row => Object.entries(plan.entries.find(entry => entry.id === row.id).fields).forEach(([field, change]) => { row[field] = change.after; }));
  expect((await run(query, false)).books).toBe(0);
});

test('refuses a changed identity or user edit before writing any name', async () => {
  const rows = currentRows();
  const first = plan.entries[0];
  rows[0][Object.keys(first.fields)[0]] = 'A user edit';
  const query = jest.fn(async sql => sql.startsWith('GET_LOCK') ? [{ acquired: 1 }] : sql.startsWith('SELECT *') ? rows : []);
  await expect(run(query, false)).rejects.toThrow('Concurrent/unreviewed change');
  expect(query.mock.calls.some(([sql]) => sql.startsWith('UPDATE'))).toBe(false);
  expect(query).toHaveBeenLastCalledWith('ROLLBACK');
});

test('vocalization-only entries preserve base spelling and reject out-of-scope fields', () => {
  expect(() => validatePlan({ entries: [{ id: 1, alias: 'sample', fields: { name: { before: 'كتاب', after: 'كاتب', reason: 'Add missing lexical tashkil' } } }] })).toThrow('base spelling');
  expect(() => validatePlan({ entries: [{ id: 1, alias: 'sample', fields: { hidden: { before: 0, after: '1', reason: 'Not allowed' } } }] })).toThrow('Invalid');
});
