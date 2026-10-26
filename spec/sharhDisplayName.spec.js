'use strict';
const { displayName, authorSuffix } = require('../lib/SharhDisplayName');
const plan = require('../bin/utils/sharh-clean-names-plan.json');
const { validatePlan } = require('../bin/utils/enrich-book-display-names');

test('identical titles remain distinguishable through separately stored short authors', () => {
  const name = 'Fatḥ al-Bārī';
  expect(displayName({ shortName_en: name, authorShortName_en: 'Ibn Hajar al-Asqalani' })).toBe(name + ' (Ibn Hajar al-Asqalani)');
  expect(displayName({ shortName_en: name, authorShortName_en: 'Ibn Rajab' })).toBe(name + ' (Ibn Rajab)');
});
test.each([
  ['Sharḥ al-Suyūṭī', 'Jalal al-Din al-Suyuti'],
  ['Hāshiyat al-Sindī on Nasāʾī', 'Abu al-Hasan al-Sindi'],
  ['Sharḥ al-Zurqānī on al-Muwaṭṭaʾ', 'Muhammad al-Zurqani'],
  ["Salahi's Commentary", 'Adil Salahi'],
  ['al-Durar al-Saniyyah', 'Dorar al-Saniyyah Foundation']
])('does not repeat authors embedded in %s', (title, author) => {
  expect(authorSuffix({ authorShortName_en: author }, title)).toBe('');
});
test('does not confuse the base-book author with the commentator or invent missing authors', () => {
  expect(displayName({ shortName_en: 'Sharh Riyad al-Salihin', authorShortName_en: 'Muhammad Ibn Uthaymin' })).toBe('Sharh Riyad al-Salihin (Muhammad Ibn Uthaymin)');
  expect(displayName({ shortName_en: 'Title' })).toBe('Title');
});
test('reviewed cleanup changes only English title fields and preserves the title before the author suffix', () => {
  expect(() => validatePlan(plan)).not.toThrow();
  expect(plan.entries).toHaveLength(19);
  for (const entry of plan.entries) for (const [field, value] of Object.entries(entry.fields)) {
    expect(['shortName_en', 'name_en', 'title_en']).toContain(field);
    expect(value.before.startsWith(value.after + ' (')).toBe(true);
    expect(value.after).not.toMatch(/[()]/);
  }
});

test('Arabic hadith labels use short authors and ignore tashkil when detecting embedded names', () => {
  expect(displayName({ shortName: 'فَتْحُ الْبَارِي', authorShortName: 'ابْنُ حَجَرٍ الْعَسْقَلَانِيُّ' }, null, 'ar')).toBe('فَتْحُ الْبَارِي (ابْنُ حَجَرٍ الْعَسْقَلَانِيُّ)');
  expect(displayName({ shortName: 'شَرْح السُّيُوطِيّ', authorShortName: 'جَلَالُ الدِّينِ السُّيُوطِيُّ' }, null, 'ar')).toBe('شَرْح السُّيُوطِيّ');
  expect(displayName({ shortName: 'شَرْح صَلَاحِي', authorShortName: 'عَادِلٌ صَلَاحِي' }, null, 'ar')).toBe('شَرْح صَلَاحِي');
});

test('Arabic cleanup preserves the title and every diacritic before the reviewed author suffix', () => {
  const arabicPlan = require('../bin/utils/sharh-clean-arabic-names-plan.json');
  expect(() => validatePlan(arabicPlan)).not.toThrow();
  for (const entry of arabicPlan.entries) for (const [field, change] of Object.entries(entry.fields)) {
    expect(['shortName', 'name', 'title']).toContain(field);
    expect(change.after).toBe(change.before.slice(0, change.before.lastIndexOf(' (')));
  }
});
