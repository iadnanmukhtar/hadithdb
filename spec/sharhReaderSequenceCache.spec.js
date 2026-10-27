'use strict';
const Sharh = require('../lib/Sharh');
const Utils = require('../lib/Utils');
const Index = require('../lib/Index');
const Navigation = require('../lib/SharhNavigationIndex');
const book = {id:100,alias:'test-sharh'};
const rows = [
 {id:1,kind:'hadith',reference:'bukhari:1',source_alias:'riyad'},
 {id:2,kind:'hadith',reference:'muslim:8a',source_alias:'riyad'}
];
let disk;
beforeEach(() => {
 disk = '';
 jest.spyOn(Navigation,'read').mockResolvedValue(null);
 jest.spyOn(Utils,'diskCacheEnabled').mockReturnValue(true);
 jest.spyOn(Utils,'readCachedTextFile').mockImplementation(()=>disk);
 jest.spyOn(Utils,'writeCachedTextFile').mockImplementation((_path,text)=>{disk=text;});
 jest.spyOn(Utils,'indexCachedItem').mockResolvedValue();
 jest.spyOn(Index,'docsFromQueryFields').mockResolvedValue([]);
 global.query=jest.fn().mockResolvedValue(rows);
});
afterEach(()=>{jest.restoreAllMocks();delete global.query;});
test('different passages reuse one book sequence without SQL or ES on cache hits',async()=>{
 expect((await Sharh.readerNavigation({book,kind:'hadith',owner:{id:1}})).next).toBe('/sharh/test-sharh/muslim:8a');
 expect((await Sharh.readerNavigation({book,kind:'hadith',owner:{id:2}})).prev).toBe('/sharh/test-sharh/bukhari:1');
 expect(global.query).toHaveBeenCalledTimes(1);
 expect(Index.docsFromQueryFields).not.toHaveBeenCalled();
 expect(Utils.writeCachedTextFile.mock.calls[0][0]).toContain('/sharh.');
 expect(Utils.indexCachedItem).toHaveBeenCalledWith(expect.arrayContaining(['test-sharh','book:test-sharh','riyad','book:riyad','bukhari','muslim']),expect.any(String));
});
test('concurrent requests share a single build',async()=>{
 await Promise.all(Array.from({length:10},()=>Sharh.readerSequence(book)));
 expect(global.query).toHaveBeenCalledTimes(1);
});
test('source-book invalidation causes a rebuild, rather than retaining a stale memory copy',async()=>{
 await Sharh.readerSequence(book);
 disk='';
 await Sharh.readerSequence(book);
 expect(global.query).toHaveBeenCalledTimes(2);
});
test('failed builds are not cached and can retry',async()=>{
 global.query.mockRejectedValueOnce(new Error('offline'));
 await expect(Sharh.readerSequence(book)).rejects.toThrow('offline');
 expect(disk).toBe('');
 await expect(Sharh.readerSequence(book)).resolves.toEqual(rows);
});
test('corrupt or different-book caches are rebuilt',async()=>{
 disk=JSON.stringify({version:1,bookId:99,rows:[]});
 await expect(Sharh.readerSequence(book)).resolves.toEqual(rows);
 expect(global.query).toHaveBeenCalledTimes(1);
});


test('a cold disk cache uses ES navigation without SQL and warm passages reuse it',async()=>{
 Navigation.read.mockResolvedValue(rows);
 expect((await Sharh.readerNavigation({book,kind:'hadith',owner:{id:1}})).next).toBe('/sharh/test-sharh/muslim:8a');
 expect((await Sharh.readerNavigation({book,kind:'hadith',owner:{id:2}})).prev).toBe('/sharh/test-sharh/bukhari:1');
 expect(global.query).not.toHaveBeenCalled();
 expect(Navigation.read).toHaveBeenCalledTimes(1);
});
test('disk caching disabled still uses ES instead of SQL',async()=>{
 Utils.diskCacheEnabled.mockReturnValue(false);
 Navigation.read.mockResolvedValue(rows);
 await Sharh.readerSequence(book);
 await Sharh.readerSequence(book);
 expect(global.query).not.toHaveBeenCalled();
 expect(Navigation.read).toHaveBeenCalledTimes(2);
});
test('a new HTML cache version reloads ES without rebuilding navigation in SQL',async()=>{
 const files=new Map();
 Utils.readCachedTextFile.mockImplementation(path=>files.get(path));
 Utils.writeCachedTextFile.mockImplementation((path,text)=>files.set(path,text));
 Navigation.read.mockResolvedValue(rows);
 const original=Utils.ASSET_SUFFIX_SLUG;
 try {
  await Sharh.readerSequence(book);
  Utils.ASSET_SUFFIX_SLUG=original+'-navigation-test';
  await Sharh.readerSequence(book);
  expect(Navigation.read).toHaveBeenCalledTimes(2);
  expect(global.query).not.toHaveBeenCalled();
 } finally { Utils.ASSET_SUFFIX_SLUG=original; }
});
test('an empty indexed book does not trigger SQL fallback',async()=>{
 Navigation.read.mockResolvedValue([]);
 expect(await Sharh.readerSequence(book)).toEqual([]);
 expect(global.query).not.toHaveBeenCalled();
});
test('publishing new navigation prevents an in-flight old read repopulating disk',async()=>{
 let finish;
 Navigation.read.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 jest.spyOn(Utils,'flushCachedFile').mockResolvedValue();
 const pending=Sharh.readerSequence(book);
 await Sharh.invalidateReaderSequence(book);
 finish(rows);
 await pending;
 expect(Utils.writeCachedTextFile).not.toHaveBeenCalled();
 Navigation.read.mockResolvedValue([rows[0]]);
 expect(await Sharh.readerSequence(book)).toEqual([rows[0]]);
});
