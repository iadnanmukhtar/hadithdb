'use strict';
const { collectChapterSummaries, matchFullRecords, matchSummaries } = require('../bin/utils/repair-hdith-enrichment-gaps');
const { fullRecordMatchScore } = require('../bin/utils/import-hdith-six-books-enrichment');

const text = 'حدثنا محمد بن عبد الله عن مالك عن نافع عن ابن عمر قال الماء طهور لا ينجسه شيء';
const summary = (id, n) => ({ id, n, kind: 'hadith', text });

test('comparison treats written and ligature divine honorifics alike without changing report words', () => {
	const { normalizeHadithForComparison } = require('../bin/utils/import-hdith-six-books-enrichment');
	expect(normalizeHadithForComparison('إِنَّ مِنَ الْغَيْرَةِ مَا يُحِبُّ اللَّهُ عَزَّ وَجَلَّ'))
		.toBe(normalizeHadithForComparison('إن من الغيرة ما يحب الله ﷻ'));
	expect(normalizeHadithForComparison('عز الرجل وجل')).toBe('عز الرجل وجل');
});

test('number-only editorial source entries do not become a hadith text preview', () => {
	const { parseHadithPayload } = require('../bin/utils/import-hdith-six-books-enrichment');
	const record = parseHadithPayload({ id: 100038, entry_kind: 'hadith', matn: '2322 2153' }, { sourceSlug: 'b-4' });
	expect(record.bodyStart).toBeNull();
	expect(record.comparisonText).toBe('');
});

test('bulk link resolution preserves crosswalk priority, book identity, and exact-reference fallback', async () => {
	const { localTargetsForHdithLinks } = require('../bin/utils/import-hdith-six-books-enrichment');
	const calls = [];
	const connection = { query(sql, values, callback) {
		calls.push({ sql, values });
		callback(null, sql.includes('hdith_book_reference_crosswalk') ? [
			{ source_book_id: 3, source_entry_id: 90, bookId: 99, id: 999, num: '1' },
			{ source_book_id: 3, source_entry_id: 90, bookId: 4, id: 101, num: '2' },
			{ source_book_id: 3, source_entry_id: 90, bookId: 4, id: 102, num: '3' }
		] : [{ bookId: 18, id: 103, num: '5' }]);
	} };
	const result = await localTargetsForHdithLinks(connection, [
		{ id: 1, source_book_id: 3, source_entry_id: 90, source_num: '5' },
		{ id: 2, source_book_id: 3, source_entry_id: 91, source_num: '5' },
		{ id: 3, source_book_id: 2, source_entry_id: 92, source_num: '5' },
		{ id: 4, source_book_id: 999, source_entry_id: 93, source_num: '5' },
		{ id: 5, source_book_id: 1, source_entry_id: 94, source_num: '5' },
		{ id: 6, source_book_id: 4, source_entry_id: 95, source_num: '5' },
		{ id: 7, source_book_id: 5, source_entry_id: 96, source_num: '5' },
		{ id: 8, source_book_id: 6, source_entry_id: 97, source_num: '5' },
		{ id: 9, source_book_id: 18, source_entry_id: 98, source_num: '5' }
	]);
	expect([...result.values()].map(row => row.id)).toEqual([101, 103]);
	expect(calls).toHaveLength(2);
	expect(result.has(2)).toBe(false); // Abu Dawud display numbers drift; a crosswalk is required.
	expect(result.has(5)).toBe(false); // Bukhari display numbers drift after 99.
	expect(result.has(6)).toBe(false); // Tirmidhi display numbers also drift.
	expect(result.has(7)).toBe(false); // Nasai source numbering also differs from local citations.
	expect(result.has(8)).toBe(false); // Ibn Majah includes extra transmissions in display numbering.
	expect(result.get(9).id).toBe(103);
	expect(calls[1].values).toEqual([[[18, '5']]]);
});

test('both Daraqutni enrichment entry points include linked explanations', () => {
	const { FOLLOWUP_BOOKS, HDITH_LOCAL_BOOKS } = require('../bin/utils/import-hdith-six-books-enrichment');
	expect(FOLLOWUP_BOOKS.find(book => book.sourceSlug === 'b-18').commentaryServices).toEqual([6, 12]);
	expect(HDITH_LOCAL_BOOKS[18].commentaryServices).toEqual([6, 12]);
});

test('both Malik enrichment entry points include dedicated and linked explanations', () => {
	const { FOLLOWUP_BOOKS, HDITH_LOCAL_BOOKS } = require('../bin/utils/import-hdith-six-books-enrichment');
	expect(FOLLOWUP_BOOKS.find(book => book.sourceSlug === 'b-7').commentaryServices).toEqual([6, 12]);
	expect(HDITH_LOCAL_BOOKS[7].commentaryServices).toEqual([6, 12]);
});

test('both Abu Dawud enrichment entry points include linked explanations', () => {
	const { SIX_BOOKS, HDITH_LOCAL_BOOKS } = require('../bin/utils/import-hdith-six-books-enrichment');
	expect(SIX_BOOKS.find(book => book.sourceSlug === 'b-3').commentaryServices).toEqual([6, 12]);
	expect(HDITH_LOCAL_BOOKS[3].commentaryServices).toEqual([6, 12]);
});

test('both Tirmidhi enrichment entry points include linked explanations', () => {
	const { SIX_BOOKS, HDITH_LOCAL_BOOKS } = require('../bin/utils/import-hdith-six-books-enrichment');
	expect(SIX_BOOKS.find(book => book.sourceSlug === 'b-4').commentaryServices).toEqual([6, 12]);
	expect(HDITH_LOCAL_BOOKS[4].commentaryServices).toEqual([6, 12]);
});

test('Nasai enrichment includes linked explanations and uses edition grading citations', () => {
	const { SIX_BOOKS, HDITH_LOCAL_BOOKS, gradingReference } = require('../bin/utils/import-hdith-six-books-enrichment');
	expect(SIX_BOOKS.find(book => book.sourceSlug === 'b-5').commentaryServices).toEqual([6, 12]);
	expect(HDITH_LOCAL_BOOKS[5].commentaryServices).toEqual([6, 12]);
	expect(gradingReference({ sourceSlug: 'b-5' }, { num: '353', editionReference: '352 / 2' }, '354')).toBe('352');
	expect(gradingReference({ sourceSlug: 'b-5' }, { num: '434', editionReference: '433 / 3' }, '434b')).toBe('433');
	expect(gradingReference({ sourceSlug: 'b-5' }, { num: '272', editionReference: '271 م / 3' }, '272')).toBe('271');
	expect(gradingReference({ sourceSlug: 'b-5' }, { num: '1369', editionReference: '1367 م' }, '1368-2')).toBe('1367');
	expect(gradingReference({ sourceSlug: 'b-5' }, { sourceId: 69686, num: '4027', editionReference: '4028 / 2' }, '4016')).toBe('4027');
	expect(gradingReference({ sourceSlug: 'b-5' }, { sourceId: 69962, num: '4231', editionReference: '4232 / 2' }, '4220')).toBe('4231');
	expect(gradingReference({ sourceSlug: 'b-5' }, { sourceId: 69962, num: '4231', editionReference: '4233 / 2' }, '4220')).toBe('4233');
});

test('reference matching uses the source slug first rather than matching book 18 to hadith 18', () => {
	const locals = [{ id: 1, num: '18', body: text }, { id: 2, num: '6', body: text }];
	expect(matchSummaries(18, [summary(101, '6')], locals).matched).toEqual([
		expect.objectContaining({ localHadithId: 2 })
	]);
});

test('full-detail repair uses edition references when display numbers drift', () => {
	const records = [{ sourceId: 101, num: '2057', editionReference: '2056', comparisonText: text, bodyStart: text }];
	const locals = [{ id: 1, num: '2057', body: text }, { id: 2, num: '2056', body: text }];
	expect(matchFullRecords(18, records, locals).matched).toEqual([
		expect.objectContaining({ localHadithId: 2, localReference: '2056' })
	]);
});

test('matn-only confirmation requires a matching edition reference', () => {
	const record = { editionReference: '6', comparisonText: 'زيد عمرو بكر سعيد حارثة', bodyStart: text };
	expect(fullRecordMatchScore(record, { num: '6', body: text }, 'b-18')).toBe(1);
	expect(fullRecordMatchScore(record, { num: '18', body: text }, 'b-18')).toBeLessThan(0.9);
	expect(fullRecordMatchScore({ ...record, editionReference: null, num: '6' }, { num: '6', body: text }, 'b-3')).toBeLessThan(0.9);
});

test('missing edition references use confirmed neighbors and ordered full text despite display-number drift', () => {
	const records = [{ sourceId: 11, num: '173', editionReference: null, comparisonText: text, bodyStart: text }];
	const locals = [{ id: 1, num: '174', ordinal: 50, body: text }, { id: 2, num: '173', ordinal: 48, body: text }];
	const anchors = [{ source_entry_id: 10, ordinal: 49 }, { source_entry_id: 12, ordinal: 51 }];
	expect(matchFullRecords(3, records, locals, anchors).matched).toEqual([expect.objectContaining({ localHadithId: 1 })]);
	expect(matchFullRecords(3, [{ ...records[0], comparisonText: 'حدثنا آخر عن راو آخر لا يطابق الإسناد' }], locals, anchors).matched).toHaveLength(0);
});

test('unrelated texts and suffix-only guesses remain unresolved', () => {
	const records = [{ sourceId: 1, editionReference: '6', comparisonText: text, bodyStart: text }];
	const locals = [{ id: 1, num: '6a', body: text }, { id: 2, num: '6', body: 'زيد عمرو بكر سعيد حارثة' }];
	expect(matchFullRecords(18, records, locals).matched).toHaveLength(0);
});

test('multiple source entries claiming the same local record are all withheld', () => {
	const records = [1, 2, 3].map(sourceId => ({ sourceId, editionReference: '6', comparisonText: text, bodyStart: text }));
	const result = matchFullRecords(18, records, [{ id: 1, num: '6', body: text }]);
	expect(result.matched).toHaveLength(0);
	expect(result.ambiguous).toHaveLength(3);
	expect(result.unmatchedLocals).toHaveLength(1);
});

test('truncated listings fetch the partially returned group as well as empty groups and deduplicate', async () => {
	const pages = {
		10: { hadiths: [summary(1, '1')], hadith_groups: [{ id: 11, hadiths: [summary(1, '1')] }, { id: 12, hadiths: [] }] },
		11: { hadiths: [summary(1, '1'), summary(2, '2')] },
		12: { hadiths: [summary(3, '3')], hadith_groups: [{ id: 10, hadiths: [] }] }
	};
	const fetchChapter = jest.fn(async id => pages[id]);
	const result = await collectChapterSummaries({ id: 10, count: 3 }, fetchChapter);
	expect(result.map(item => item.id)).toEqual([1, 2, 3]);
	expect(fetchChapter).toHaveBeenCalledTimes(3);
});

test('incomplete source coverage aborts instead of reporting a complete repair', async () => {
	await expect(collectChapterSummaries({ id: 10, count: 2 }, async () => ({ hadiths: [summary(1, '1')] })))
		.rejects.toThrow('found 1/2');
});

test('source inventory counts explanatory passages without automatically mapping them as hadiths', async () => {
	const rows = await collectChapterSummaries({ id: 10, count: 2 }, async () => ({ hadiths: [summary(1, '1'), { ...summary(2, '2'), kind: 'passage' }] }));
	expect(rows).toHaveLength(2);
	expect(matchFullRecords(3, [{ sourceId: 2, entryKind: 'passage', num: '2', comparisonText: text }], [{ id: 2, num: '2', body: text }]).matched).toHaveLength(0);
});

test('a truncated subchapter list is completed through explicit source navigation', async () => {
	const records = {
		1: { sourceId: 1, chapterId: 10, nextId: 2 },
		2: { sourceId: 2, chapterId: 10, nextId: 3, num: '2', comparisonText: text },
		3: { sourceId: 3, chapterId: 20, nextId: 4 }
	};
	const fetchChapter = async () => ({ hadiths: [summary(1, '1')] });
	expect((await collectChapterSummaries({ id: 10, count: 2 }, fetchChapter, async id => records[id])).map(x => x.id)).toEqual([1, 2]);
	await expect(collectChapterSummaries({ id: 10, count: 3 }, fetchChapter, async id => records[id])).rejects.toThrow('found 2/3');
});

test('one stored commentary does not hide missing or truncated shuruh', () => {
	const { sharhEntriesComplete } = require('../bin/utils/import-hdith-six-books-enrichment');
	const expected = [{ sourceEntryId: 10, text: 'complete commentary' }, { sourceEntryId: 20, text: 'another commentary' }];
	expect(sharhEntriesComplete([{ source_entry_id: 10, text: 'complete commentary' }], expected)).toBe(false);
	expect(sharhEntriesComplete([{ source_entry_id: 10, text: 'complete commentary' }, { source_entry_id: 20, text: 'another' }], expected)).toBe(false);
	expect(sharhEntriesComplete(expected.map(item => ({ source_entry_id: item.sourceEntryId, text: item.text })), expected)).toBe(true);
});

test('edition part numbers match lettered references without becoming unrelated small hadith numbers', () => {
	const { editionReferencesEquivalent } = require('../bin/utils/import-hdith-six-books-enrichment');
	expect(editionReferencesEquivalent('b-18', '142a', '142 / 1')).toBe(true);
	expect(editionReferencesEquivalent('b-18', '148b', '148 / 2')).toBe(true);
	expect(editionReferencesEquivalent('b-18', '1', '142 / 1')).toBe(false);
	expect(editionReferencesEquivalent('b-18', '142b', '142 / 1')).toBe(false);
});

test('numbered hadith entries remain eligible even when the source marks scholarly discussion as intro', () => {
	const { parseHadithPayload } = require('../bin/utils/import-hdith-six-books-enrichment');
	expect(parseHadithPayload({ id: 1, entry_kind: 'hadith', is_intro: true }).isIntro).toBe(false);
	expect(parseHadithPayload({ id: 1, entry_kind: 'intro', is_intro: true }).isIntro).toBe(true);
});

test('unparsed scholarly reports retain comparison text without becoming matn split hints', () => {
	const { parseHadithPayload } = require('../bin/utils/import-hdith-six-books-enrichment');
	const record = parseHadithPayload({ id: 1, entry_kind: 'hadith', is_intro: true, isnad_prefix: '', matn: text });
	expect(record.isIntro).toBe(false);
	expect(record.comparisonText).toBe(text);
	expect(record.bodyStart).toBeNull();
});

test('a substantial verbatim matn can straddle an incorrect local chain/body split', () => {
	const matn = 'قال رسول الله الماء طهور لا ينجسه شيء من الأشياء';
	const local = { num: '6', chain: 'حدثنا زيد عن عمرو قال رسول الله الماء', body: 'طهور لا ينجسه شيء منالأشياء' };
	expect(fullRecordMatchScore({ editionReference: '6', comparisonText: 'سعيد بكر خالد', bodyStart: matn }, local, 'b-18')).toBe(1);
	expect(fullRecordMatchScore({ editionReference: '7', comparisonText: 'سعيد بكر خالد', bodyStart: matn }, local, 'b-18')).toBeLessThan(0.9);
});

test('an explicit identity review becomes invalid if either reviewed text changes', () => {
	const crypto = require('crypto');
	const { reviewedIdentityIsCurrent } = require('../bin/utils/import-hdith-six-books-enrichment');
	const local = { id: 1, num: '77', chain: 'chain', body: 'body' };
	const match = { review: { reason: 'Full chain and matn reviewed across edition wording differences', sourceChecksum: 'source-sha',
		localChecksum: crypto.createHash('sha256').update(JSON.stringify(local)).digest('hex') } };
	expect(reviewedIdentityIsCurrent(match, { rawChecksum: 'source-sha' }, local)).toBe(true);
	expect(reviewedIdentityIsCurrent(match, { rawChecksum: 'changed' }, local)).toBe(false);
	expect(reviewedIdentityIsCurrent(match, { rawChecksum: 'source-sha' }, { ...local, body: 'changed' })).toBe(false);
	expect(reviewedIdentityIsCurrent({}, { rawChecksum: 'source-sha' }, local)).toBe(false);
});

test('refreshing dedicated sharh preserves explanatory passages from other source services', async () => {
	const { replaceSharh } = require('../bin/utils/import-hdith-six-books-enrichment');
	const calls = [];
	const connection = { query(sql, values, callback) { calls.push({ sql, values }); callback(null, []); } };
	await replaceSharh(connection, 123, []);
	const deletion = calls.find(call => call.sql.includes('DELETE hs'));
	expect(deletion.sql).toContain('hs.source_url LIKE ?');
	expect(deletion.values).toEqual([123, 'https://hdith.com/encyclopedia/book/%/service/6']);
});

test('missing-only commentary repair appends new entries and preserves existing authored text and order', async () => {
	const { replaceSharh } = require('../bin/utils/import-hdith-six-books-enrichment');
	const calls = [];
	const connection = { query(sql, values, callback) {
		calls.push({ sql, values });
		callback(null, sql.startsWith('SELECT source_entry_id') ? [{ source_entry_id: 10, ordinal: 3 }]
			: sql.includes('LAST_INSERT_ID() AS id') ? [{ id: 99 }] : []);
	} };
	await replaceSharh(connection, 123, [{ sourceEntryId: 10, text: 'changed source text' },
		{ sourceEntryId: 20, sourceBookId: 999, title: 'Book', author: 'Author', text: 'New passage', format: 'md', sourceUrl: 'https://hdith.com/source' }], [6, 12], { preserveExisting: true });
	expect(calls.some(call => call.sql.includes('DELETE'))).toBe(false);
	const insert = calls.find(call => call.sql.includes('INTO hdith_hadith_sharh'));
	expect(insert.sql).toContain('INSERT IGNORE');
	expect(insert.sql).not.toContain('ON DUPLICATE');
	expect(insert.values.slice(0, 4)).toEqual([123, 4, 99, 20]);
});

test('broken source XML is not promoted into the local searchable matn', () => {
	const { parseHadithPayload } = require('../bin/utils/import-hdith-six-books-enrichment');
	const record = parseHadithPayload({ id: 1, matn: 'fragment" نوع="موقوف"/>', isnad_prefix: 'حدثنا زيد' });
	expect(record.bodyStart).toBeNull();
	expect(record.comparisonText).toBe('حدثنا زيد');
});

test('batched narrator writes preserve repeated narrators, chain order, formulas, and flags', async () => {
	const { replaceNarrators } = require('../bin/utils/import-hdith-six-books-enrichment');
	const calls = [];
	const connection = { query(sql, values, callback) {
		calls.push({ sql, values });
		callback(null, sql.startsWith('SELECT') ? [{ id: 22, source_slug: 'p-bulk-b' }, { id: 11, source_slug: 'p-bulk-a' }] : {});
	} };
	const narrator = (sourceSlug, ordinal) => ({ sourceSlug, ordinal, name: 'Name', fullname: null, reliability: null, generation: null, death: null, formula: `formula-${ordinal}`, flags: [ordinal] });
	await replaceNarrators(connection, 7, [narrator('p-bulk-a', 1), narrator('p-bulk-b', 2), narrator('p-bulk-a', 3)]);
	expect(calls[0].values[0]).toHaveLength(2);
	expect(calls.at(-1).values).toEqual([[[7, 11, 1, 'formula-1', '[1]'], [7, 22, 2, 'formula-2', '[2]'], [7, 11, 3, 'formula-3', '[3]']]]);
});

test('batched subject writes associate IDs by slug rather than database return order', async () => {
	const { replaceSubjects } = require('../bin/utils/import-hdith-six-books-enrichment');
	const calls = [];
	const connection = { query(sql, values, callback) {
		calls.push({ sql, values });
		callback(null, sql.includes('SELECT id,source_slug') ? [{ id: 2, source_slug: 'bulk-b' }, { id: 1, source_slug: 'bulk-a' }]
			: sql.includes('SELECT id,text_en') ? [{ id: 12, text_en: 'hdith:bulk-b' }, { id: 11, text_en: 'hdith:bulk-a' }] : {});
	} };
	await replaceSubjects(connection, 7, [{ slug: 'bulk-a', title: 'A' }, { slug: 'bulk-b', title: 'B' }]);
	expect(calls.at(-2).values).toEqual([[[7, 1], [7, 2]]]);
	expect(calls.at(-1).values).toEqual([[[7, 11], [7, 12]]]);
});

test('Abu Dawud grading searches use the edition citation rather than the drifting display number', () => {
	const { gradingReference, parseGraderOpinions } = require('../bin/utils/import-hdith-six-books-enrichment');
	expect(gradingReference({ sourceSlug: 'b-3' }, { num: '5124', editionReference: '5140' }, '5140')).toBe('5140');
	expect(gradingReference({ sourceSlug: 'b-3' }, { num: '5124' }, '5140')).toBe('5140');
	const opinions = parseGraderOpinions([{ slug: 'grade-test', source: 'ضعيف سنن أبي داود', book_page: '5140', muhaddith: 'الألباني', degree: 'ضعيف' }], 'b-3', '5140');
	expect(opinions).toHaveLength(1);
	expect(opinions[0].grader).toBe('الألباني');
});

test('Tirmidhi grading searches use the confirmed local citation', () => {
	const { gradingReference, parseGraderOpinions } = require('../bin/utils/import-hdith-six-books-enrichment');
	expect(gradingReference({ sourceSlug: 'b-4' }, { num: '16', editionReference: '14' }, '14')).toBe('14');
	expect(gradingReference({ sourceSlug: 'b-4' }, { num: '16' }, '14')).toBe('14');
	expect(gradingReference({ sourceSlug: 'b-4' }, { num: '398', editionReference: '391' }, '391a')).toBe('391');
	expect(gradingReference({ sourceSlug: 'b-4' }, { num: '399', editionReference: '391 (م)' }, '391b')).toBe('391b');
	expect(parseGraderOpinions([{ slug: 'tirmidhi-grade', source: 'صحيح الترمذي', book_page: '14', muhaddith: 'الألباني', degree: 'صحيح' }], 'b-4', '14')).toHaveLength(1);
});

test('Ibn Majah includes linked explanations and retains edition references', () => {
	const { SIX_BOOKS, HDITH_LOCAL_BOOKS, gradingReference } = require('../bin/utils/import-hdith-six-books-enrichment');
	expect(SIX_BOOKS.find(book => book.sourceSlug === 'b-6').commentaryServices).toEqual([6, 12]);
	expect(HDITH_LOCAL_BOOKS[6].commentaryServices).toEqual([6, 12]);
	expect(gradingReference({ sourceSlug: 'b-6' }, { num: '31', editionReference: '30' }, '30')).toBe('30');
	expect(gradingReference({ sourceSlug: 'b-6' }, { num: '63', editionReference: '57 (م)' }, '57')).toBe('57');
	expect(gradingReference({ sourceSlug: 'b-6' }, { num: '1700', editionReference: '1654' }, '1655')).toBe('1654');
});

test('Ibn Majah grading requires the ordered matn and narrator despite independent citations', () => {
	const { parseGraderOpinions } = require('../bin/utils/import-hdith-six-books-enrichment');
	const record = { narrator: 'أبو سعيد الخدري', bodyStart: 'إن الله ليضحك إلى ثلاثة للصف في الصلاة' };
	const opinion = { slug: 'verified', source: 'ضعيف ابن ماجه', book_page: '35', rawi: record.narrator,
		hadith: 'إنَّ اللهَ ليضحك إلى ثلاثة للصف في الصلاة', muhaddith: 'الألباني', degree: 'ضعيف' };
	expect(parseGraderOpinions([opinion], 'b-6', '200', record)).toHaveLength(1);
	expect(parseGraderOpinions([opinion], 'b-6', '35')).toEqual([]);
	expect(parseGraderOpinions([{ ...opinion, hadith: 'الندم توبة' }], 'b-6', '200',
		{ ...record, bodyStart: 'الندم توبة' })).toHaveLength(1);
	expect(parseGraderOpinions([{ ...opinion, book_page: '200', rawi: 'أنس بن مالك' }], 'b-6', '200', record)).toEqual([]);
	expect(parseGraderOpinions([{ ...opinion, hadith: 'إن الله ليضحك للصف إلى ثلاثة في الصلاة' }], 'b-6', '200', record)).toEqual([]);
	expect(parseGraderOpinions([{ ...opinion, hadith: 'إن الله ليضحك' }], 'b-6', '200', record)).toEqual([]);
	expect(parseGraderOpinions([opinion], 'b-6', '200', { ...record, narrator: null })).toEqual([]);
	expect(parseGraderOpinions([{ ...opinion, rawi: 'أبو هريرة' }], 'b-6', '200',
		{ ...record, narrator: 'أبو هريرة الدوسي', narratorAliases: ['أبو هريرة'] })).toHaveLength(1);
});
