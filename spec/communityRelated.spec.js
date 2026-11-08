'use strict';
const Related=require('../lib/CommunityRelated');
const guid='f37d0f36-7a95-4e2c-9f08-5a7d97cdb9e1';
beforeEach(()=>{global.settings={site:{url:'https://example.test'}};});
test.each(['/community/p/'+guid,'https://example.test/community/p/'+guid,'/blog/faith%20and%20prayer','/community/@amina/7'])('resolves published article links: %s',async link=>{
 const q=jest.fn().mockResolvedValue([{id:7}]);expect(await Related.resolve(q,link,8,null)).toBe(7);
 expect(q.mock.calls[0][0]).toContain("p.status='published' AND p.kind='article'");
});
test.each(['https://evil.test/community/p/'+guid,'javascript:alert(1)','/community/write?post=7','/blog/%FF',{},null])('rejects invalid or external links: %j',async link=>{
 const q=jest.fn();await expect(Related.resolve(q,link,8,null)).rejects.toMatchObject({status:400});expect(q).not.toHaveBeenCalled();
});
test('rejects self-links, unpublished targets, and missing articles',async()=>{
 await expect(Related.resolve(jest.fn().mockResolvedValue([{id:7}]),'/blog/faith',7)).rejects.toMatchObject({status:400});
 await expect(Related.resolve(jest.fn().mockResolvedValue([]),'/blog/faith',8)).rejects.toMatchObject({status:400});
});
test('omission preserves links and clearing removes them without a lookup',async()=>{
 const q=jest.fn();expect(await Related.resolve(q,undefined,8,7)).toBe(7);expect(await Related.resolve(q,'',8,7)).toBeNull();expect(q).not.toHaveBeenCalled();
});
test('editor returns canonical published links and hides unavailable targets',async()=>{
 expect(await Related.editorUrl(jest.fn().mockResolvedValue([{id:7,guid,slug:'faith & prayer'}]),7)).toBe('/blog/faith%20%26%20prayer');
 expect(await Related.editorUrl(jest.fn().mockResolvedValue([]),7)).toBe('');
});
test('migration tolerates existing columns and index but not connection failures',async()=>{
 const q=jest.fn(sql=>Promise.reject({code:sql.includes('ADD INDEX')?'ER_DUP_KEYNAME':'ER_DUP_FIELDNAME'}));
 await expect(Related.migrate(q)).resolves.toBeUndefined();expect(q).toHaveBeenCalledTimes(4);
 await expect(Related.migrate(jest.fn().mockRejectedValue(new Error('offline')))).rejects.toThrow('offline');
});
