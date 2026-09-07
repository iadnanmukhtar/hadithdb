'use strict';

const { buildIbnHibbanPlan, logicalKey, payloadReference, sourcePath } = require('../bin/utils/repair-hadith-toc-integrity');

describe('Hadith TOC integrity repair', () => {
	test('uses the full cached deepest heading and preserves exact references', () => {
		const payload = { id: 10, numbering_harf: '2', numberings: [{ value: '1' }], chapter_text: 'ذكر كامل', chapter_path: [
			{ id: 1, title: 'كتاب' }, { id: 2, title: 'باب' }, { id: 3, title: 'ذكر مقتطع' }
		] };
		expect(payloadReference(payload)).toBe('1');
		expect(sourcePath(payload)).toEqual([
			{ id: 1, title: 'كتاب' }, { id: 2, title: 'باب' }, { id: 3, title: 'ذكر كامل' }
		]);
	});

	test('restores omitted third-level headings using stable source sibling order', () => {
		const payloads = [
			{ id: 10, numberings: [{ value: '1' }], chapter_path: [{ id: 1, title: 'كتاب' }, { id: 2, title: 'باب' }] },
			{ id: 11, numberings: [{ value: '2' }], chapter_path: [{ id: 1, title: 'كتاب' }, { id: 2, title: 'باب' }, { id: 3, title: 'أ' }] },
			{ id: 12, numberings: [{ value: '3' }], chapter_path: [{ id: 1, title: 'كتاب' }, { id: 2, title: 'باب' }, { id: 4, title: 'ب' }] }
		];
		const hadiths = [
			{ id: 101, ordinal: 1, tocId: 20, h1: 0, h2: 1, h3: null, num: '1' },
			{ id: 102, ordinal: 2, tocId: 20, h1: 0, h2: 1, h3: null, num: '2' },
			{ id: 103, ordinal: 3, tocId: 20, h1: 0, h2: 1, h3: 2, num: '3' }
		];
		const plan = buildIbnHibbanPlan(payloads, hadiths, [
			{ source_entry_id: 10, hadith_id: 101 }, { source_entry_id: 11, hadith_id: 102 }, { source_entry_id: 12, hadith_id: 103 }
		]);
		expect(plan.nodes.map(node => [node.level, node.h1, node.h2, node.h3])).toEqual([
			[1, 0, null, null], [2, 0, 1, null], [3, 0, 1, 1], [3, 0, 1, 2]
		]);
		expect(logicalKey(plan.records[1].node)).toBe('3|0|1|1');
		expect(logicalKey(plan.records[0].node)).toBe('2|0|1|');
	});

	test('uses the verified edition crosswalk even when a local suffix differs', () => {
		const plan = buildIbnHibbanPlan([
			{ id: 10, numbering_harf: '9', numberings: [{ value: '1' }], chapter_path: [{ id: 1, title: 'كتاب' }] }
		], [
			{ id: 100, ordinal: 1, tocId: 20, h1: 0, h2: null, h3: null, num: '0b' },
			{ id: 101, ordinal: 2, tocId: 20, h1: 0, h2: null, h3: null, num: '2' }
		], [{ source_entry_id: 10, source_edition_reference: '1', hadith_id: 100 }]);
		expect(plan.records[0].hadith.id).toBe(100);
		expect(plan.metadataMismatches).toBe(0);
		expect(plan.uncoveredHadiths.map(row => row.num)).toEqual(['2']);
	});
});
