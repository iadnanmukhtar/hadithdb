'use strict';

const GradeIndex = require('../lib/HadithGradeIndex');
const SearchHttp = require('../lib/SearchHttp');
const Metadata = require('../lib/HdithMetadata');
const Pairs = require('../lib/HadithBilingualPairs');

const grade = { id: 18, grader_en: null, grader: 'مسلم', grade: 'صحيح', grade_category_id: 1, source_name: 'Book', source_slug: 'book' };
const doc = {hId: 7, grader_opinions_version: 1, grader_opinions: []};
const settings = global.settings, query = global.query;
afterEach(() => { jest.restoreAllMocks(); global.settings = settings; global.query = query; });

test('builds complete ordered opinions and distinguishes empty, virtual and legacy records', async () => {
	const rows = [{hId: 7}, {hId: 8}, {hId: 9, book_virtual: 1}];
	await GradeIndex.attach(rows, async () => [{hadith_id: 7, ...grade}]);
	expect(rows[0].grader_opinions[0]).toMatchObject({ ...grade, source: 'Book' });
	expect(GradeIndex.indexedRows(rows[0], 7)[0]).toMatchObject({ id: 18, source_name: 'Book' });
	expect(GradeIndex.indexedRows(rows[1], 8)).toEqual([]);
	expect(GradeIndex.indexedRows(rows[2], 9)).toBeNull();
	expect(GradeIndex.indexedRows(rows[0], 9)).toBeNull();
	expect(GradeIndex.indexedRows({...doc, grader_opinions_version: undefined}, 7)).toBeNull();
});

test('single reader skips grade SQL for an indexed empty array and downloads query only missing IDs', async () => {
	global.settings = {search:{domain:'http://test'}};
	global.query = jest.fn(async sql => sql.includes('FROM hdith_hadith_grades hg') ? [{hadith_id: 8, ...grade}] : []);
	jest.spyOn(Pairs,'managed').mockResolvedValue([]);
	await Metadata.forHadith(7, doc);
	expect(global.query.mock.calls.some(([s]) => s.includes('FROM hdith_hadith_grades hg'))).toBe(false);
	const fetch = jest.spyOn(SearchHttp,'post').mockResolvedValue({data:{docs:[{_id:'7', _source:doc},{_id:'8',found:false}]}});
	const result = await Metadata.forHadiths([7,8]);
	expect(fetch).toHaveBeenCalledTimes(1);
	expect(global.query.mock.calls.filter(([s]) => s.includes('FROM hdith_hadith_grades hg'))[0][0]).toContain('IN (8)');
	expect(result.get(7).grades).toEqual([]);
	expect(result.get(8).grades[0]).toMatchObject({id:18});
});

test('refresh rereads SQL after a concurrent edit and never upserts an absent document', async () => {
	global.settings = {search:{domain:'http://test'}};
	const source = seq => ({data:{docs:[{_id:'7',found:true,_seq_no:seq,_primary_term:1,_source:{hId:7}}]}});
	const post = jest.spyOn(SearchHttp,'post').mockResolvedValueOnce(source(4))
		.mockResolvedValueOnce({data:{items:[{update:{_id:'7',status:409}}]}})
		.mockResolvedValueOnce(source(5)).mockResolvedValueOnce({data:{items:[{update:{_id:'7',status:200}}]}});
	const sql = jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{hadith_id:7,...grade}]);
	expect(await GradeIndex.refresh([7],sql)).toBe(1);
	expect(sql).toHaveBeenCalledTimes(2);
	const payload = require('zlib').gunzipSync(post.mock.calls.at(-1)[1]).toString();
	expect(payload).toContain('"if_seq_no":5');
	expect(payload).toContain('"id":18');
	expect(payload).not.toContain('upsert');
});

test('virtual reader uses canonical grades and recovers through SQL when Elasticsearch is down', async () => {
	global.settings = {search:{domain:'http://test'}};
	global.query = jest.fn(async () => []);
	jest.spyOn(Pairs, 'managed').mockResolvedValue([]);
	const post = jest.spyOn(SearchHttp, 'post').mockResolvedValueOnce({data:{docs:[
		{_id:'7', _source:{...doc, grader_opinions:[grade]}}
	]}}).mockRejectedValueOnce(Error('offline'));
	const virtual = {...doc, hId:999, actual:{id:7}};
	expect((await Metadata.forHadith(7, virtual)).grades[0]).toMatchObject({id:18, source_name:'Book'});
	expect(post.mock.calls[0][1]).toEqual({ids:['7']});
	expect(global.query.mock.calls.some(([s]) => s.includes('FROM hdith_hadith_grades hg'))).toBe(false);
	await Metadata.forHadith(7, virtual);
	expect(global.query.mock.calls.some(([s]) => s.includes('FROM hdith_hadith_grades hg'))).toBe(true);
});
