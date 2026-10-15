'use strict';
const Sharh = require('../lib/Sharh');
const Utils = require('../lib/Utils');
const Index = require('../lib/Index');
const book = {id:100,alias:'test-sharh'};
const rows = [
 {id:1,kind:'hadith',reference:'bukhari:1',source_alias:'riyad'},
 {id:2,kind:'hadith',reference:'muslim:8a',source_alias:'riyad'}
];
let disk;
beforeEach(() => {
 disk = '';
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
