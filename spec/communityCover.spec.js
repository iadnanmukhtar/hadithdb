const Cover=require('../lib/CommunityCover');
const fallback=require('../lib/BlogCover');
test('missing and default covers can be saved without a media upload',async()=>{
 const q=jest.fn();expect(await Cover.validate(q,{uid:'owner'},'',null)).toBe('');expect(await Cover.validate(q,{uid:'owner'},fallback,null)).toBe('');expect(q).not.toHaveBeenCalled();
});
test('existing imported covers survive the encoded URL from an older editor',async()=>{
 expect(await Cover.validate(jest.fn(),{uid:'owner'},'/blog/Attachments/My%20cover.jpg','Attachments/My cover.jpg')).toBe('/blog/Attachments/My cover.jpg');
});
test('unrelated unowned images are still rejected',async()=>{
 await expect(Cover.validate(jest.fn(),{uid:'owner'},'https://example.test/new.jpg','')).rejects.toThrow('uploaded to your account');
 await expect(Cover.validate(jest.fn(async()=>[]),{uid:'owner'},'/community/media/'+'a'.repeat(32),'')).rejects.toThrow('uploaded to your account');
});
