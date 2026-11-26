'use strict';
const { build, attach } = require('../lib/GraderDictionary');
test('canonical names survive aliases and distinct source identities survive a shared name', () => {
	const docs = build([{ id: 7, shortName: 'A', shortName_en: 'Approved', name_en: 'Full' }], [
		{ sourceId: 5, ar: 'A', en: 'Variant' }, { sourceId: null, ar: 'A', en: null },
		{ sourceId: 8, ar: 'B', en: 'First' }, { sourceId: 9, ar: 'B', en: 'Second' }
	]);
	const rows = [[5,'A'],[null,'A'],[8,'B'],[9,'B']].map(([grader_source_id,grader]) => ({ grader_source_id, grader }));
	attach(rows, { entries: new Map(docs.flatMap(doc => doc.keys.map(key => [key, doc]))) });
	expect(rows.map(row => row.grader_en)).toEqual(['Approved','Approved','First','Second']);
	expect(rows[0].grader_name_en).toBe('Full');
});

test('resolves both imported spellings of المباركفوري to the approved name', () => {
	const variants = ['Mubārakpūrī', 'Mubarakpūri', null].map(en => ({ sourceId: null, ar: 'المباركفوري', en }));
	expect(build([], variants)).toEqual([expect.objectContaining({ english: 'Mubārakpūrī' })]);
});
