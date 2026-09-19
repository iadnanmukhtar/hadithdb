'use strict';
const { planRepairs } = require('../bin/repairPrimaryNarratorPairs');
const canonical = { id: 1, name_tashkil: 'أَنَس', name_ala_lc: 'Anas' };
const row = { hadith_id: 10, narrator_id: 1, narrator: 'أنس', narrator_en: 'Ns' };
function plan(overrides = {}) {
	return planRepairs({ narrators: [canonical], metadata: [row], pairs: [], ...overrides });
}
test('copies both fields from the same narrator identity', () => {
	expect(plan().updates[0]).toMatchObject({ corrected_ar: 'أَنَس', corrected_en: 'Anas' });
});
test('does not substitute a different name linked by ordinal', () => {
	expect(plan({ metadata: [{ ...row, narrator: 'زيد' }] }).updates).toHaveLength(0);
});
test('does not collapse hamza spelling differences', () => {
	expect(plan({ metadata: [{ ...row, narrator: 'انس' }] }).updates).toHaveLength(0);
});
test('leaves conflicting matches without an identity unchanged', () => {
	expect(plan({ narrators: [canonical, { id: 2, name_tashkil: 'أُنْس', name_ala_lc: 'Uns' }],
		metadata: [{ ...row, narrator_id: null }] }).updates).toHaveLength(0);
});
test('preserves existing vocalized metadata', () => {
	expect(plan({ metadata: [{ ...row, narrator: 'أَنَس' }] }).updates).toHaveLength(0);
});
test('respects an existing managed vocalized correction', () => {
	expect(plan({ pairs: [{ value_ar: 'أَنَس', value_en: 'Anas corrected', hidden: 0 }] })
		.updates[0].corrected_en).toBe('Anas corrected');
});
