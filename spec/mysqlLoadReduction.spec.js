'use strict';
const Mushaf = require('../lib/QuranMushaf');
const View = require('../lib/HadithTranslationIndexView');
const { run } = require('../bin/utils/add-grade-lookup-indexes');
const previous = global.query;
afterEach(() => { global.query = previous; Mushaf.invalidateAll(); jest.restoreAllMocks(); });
const words = [{global_word_id:1,surah:1,ayah:1},{global_word_id:3,surah:1,ayah:1},{global_word_id:4,surah:1,ayah:2}];
const ranges = [{page_number:1,first_word_id:1,last_word_id:1},{page_number:2,first_word_id:3,last_word_id:4}];
function queries() { return jest.fn(async sql => sql.includes('FROM quran_mushaf_words') ? words : ranges); }

test('concurrent and subsequent lookups share two corpus reads, including negative and surah-start results', async () => {
  global.query = queries();
  expect(await Promise.all([Mushaf.pageForRef(1,1),Mushaf.pageForRef(1,1,{last:true}),Mushaf.pageForRef(1,2),Mushaf.pageForRef(2,1)])).toEqual([1,2,2,null]);
  expect(await Mushaf.firstPagesForSurahs()).toEqual({1:1});
  expect(await Mushaf.pageForRef(2,1)).toBeNull();
  expect(global.query).toHaveBeenCalledTimes(2);
  expect(await Mushaf.pageForRef(115,1)).toBeNull();
  expect(global.query).toHaveBeenCalledTimes(2);
});

test('range mapping retains gaps, overlaps and ayahs spanning multiple pages', () => {
  expect([...Mushaf.buildReferenceMappings(words,[...ranges,{page_number:3,first_word_id:3,last_word_id:3}])]).toEqual([
    ['1:1',{first:1,last:3}],['1:2',{first:2,last:2}]
  ]);
});

test('failed loads retry and invalidation prevents an old in-flight snapshot from repopulating the cache', async () => {
  global.query = jest.fn().mockRejectedValueOnce(Error('offline')).mockResolvedValueOnce(ranges);
  await expect(Mushaf.pageForRef(1,1)).rejects.toThrow('offline');
  let finish;
  global.query = queries().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const old = Mushaf.pageForRef(1,1);
  Mushaf.invalidateMappings();
  global.query = jest.fn(async sql => sql.includes('FROM quran_mushaf_words') ? words : [{page_number:9,first_word_id:1,last_word_id:4}]);
  expect(await Mushaf.pageForRef(1,1)).toBe(9);
  finish(words);
  expect(await old).toBe(1);
  expect(await Mushaf.pageForRef(1,1)).toBe(9);
  expect(global.query).toHaveBeenCalledTimes(2);
});

test('point lookup retains the view projection but restricts both materialized dependencies', async () => {
  const row = {hId:42,tId:55,body:'متن',body_en:'Body',grade_grade_ids:'1:2',body_warsh:'نص'};
  global.query = jest.fn().mockResolvedValueOnce([{id:42,tocId:55}]).mockResolvedValueOnce([row]);
  expect(await View.byId(42)).toEqual(row);
  const sql = global.query.mock.calls[1][0];
  expect(sql).toContain('SELECT * FROM v_toc WHERE tId=55');
  expect(sql).toContain('SELECT * FROM v_hadiths_grades WHERE id=42');
  expect(sql).toContain('WHERE h.id=42 LIMIT 1');
  expect(sql).toContain('h.body_warsh AS body_warsh');
  expect(await View.byId('1 OR 1=1')).toBeNull();
  global.query.mockResolvedValueOnce([]);
  expect(await View.byId(43)).toBeNull();
  expect(global.query).toHaveBeenCalledTimes(3);
});

test('index migration is a no-write dry run by default and skips existing exact indexes', async () => {
  jest.spyOn(console,'log').mockImplementation(() => {});
  const query = jest.fn().mockResolvedValue([]);
  await run(query);
  expect(query).toHaveBeenCalledTimes(1);
  await run(query,true);
  expect(query.mock.calls.filter(([sql]) => sql.startsWith('ALTER TABLE'))).toHaveLength(2);
  expect(query.mock.calls.filter(([sql]) => sql.startsWith('ALTER TABLE')).every(([sql]) => sql.includes('LOCK=NONE'))).toBe(true);
  query.mockClear().mockResolvedValue([
    {Key_name:'by_source',Seq_in_index:1,Column_name:'grader_source_id'},
    {Key_name:'by_source',Seq_in_index:2,Column_name:'id'},
    {Key_name:'by_name',Seq_in_index:1,Column_name:'grader'},
    {Key_name:'by_name',Seq_in_index:2,Column_name:'id'}
  ]);
  await run(query,true);
  expect(query).toHaveBeenCalledTimes(1);
});
