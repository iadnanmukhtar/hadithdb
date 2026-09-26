'use strict';
const { collectChapterSummaries, matchFullRecords, matchSummaries } = require('../bin/utils/repair-hdith-enrichment-gaps');
const { fullRecordMatchScore } = require('../bin/utils/import-hdith-six-books-enrichment');

const text = 'حدثنا محمد بن عبد الله عن مالك عن نافع عن ابن عمر قال الماء طهور لا ينجسه شيء';
const summary = (id, n) => ({ id, n, kind: 'hadith', text });

test('both Daraqutni enrichment entry points include linked explanations', () => {
	const { FOLLOWUP_BOOKS, HDITH_LOCAL_BOOKS } = require('../bin/utils/import-hdith-six-books-enrichment');
	expect(FOLLOWUP_BOOKS.find(book => book.sourceSlug === 'b-18').commentaryServices).toEqual([6, 12]);
	expect(HDITH_LOCAL_BOOKS[18].commentaryServices).toEqual([6, 12]);
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

test('broken source XML is not promoted into the local searchable matn', () => {
	const { parseHadithPayload } = require('../bin/utils/import-hdith-six-books-enrichment');
	const record = parseHadithPayload({ id: 1, matn: 'fragment" نوع="موقوف"/>', isnad_prefix: 'حدثنا زيد' });
	expect(record.bodyStart).toBeNull();
	expect(record.comparisonText).toBe('حدثنا زيد');
});
