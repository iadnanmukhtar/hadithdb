'use strict';
const Photo = require('../lib/CommunityProfilePhoto');
const Community = require('../lib/Community');
function png(width=512,height=512) {
  const data=Buffer.alloc(24);Buffer.from('89504e470d0a1a0a','hex').copy(data);data.write('IHDR',12);data.writeUInt32BE(width,16);data.writeUInt32BE(height,20);
  return 'data:image/png;base64,'+data.toString('base64');
}
test('only bounded square PNG crops are accepted; omitted and reset are distinct',()=>{
  expect(Photo.parse(undefined)).toBeUndefined();expect(Photo.parse(null)).toBeNull();
  expect(Photo.parse(png()).hash).toMatch(/^[a-f0-9]{64}$/);
  for(const bad of ['',{},'https://example.com/photo.png','data:image/svg+xml;base64,PHN2Zz4=',png(1024),png(512,1),'data:image/png;base64,'+'A'.repeat(1500000)])expect(()=>Photo.parse(bad)).toThrow();
});
test('saving or resetting a photo is scoped to the signed-in UID',async()=>{
  const q=jest.fn(async()=>[]),photo=Photo.parse(png());
  await Photo.save(q,'owner',undefined);expect(q).not.toHaveBeenCalled();
  await Photo.save(q,'owner',photo);expect(q.mock.calls[0][1]).toEqual(['owner',photo.hash,photo.data]);
  await Photo.save(q,'owner',null);expect(q.mock.calls[1][1]).toEqual(['owner']);
});
test('custom photo wins over refreshed account photo without replacing its fallback',async()=>{
  const ensure=jest.spyOn(Community,'ensure').mockResolvedValue();
  const sql=jest.spyOn(Community,'sql').mockResolvedValue([{handle:'writer',hash:'a'.repeat(64)}]);
  try {
    const author={handle:'writer',photo:'https://example.test/account.png',avatarFallback:'fallback'};
    await Photo.decorate([author]);
    expect(author.photo).toBe('/community/profile-photo/writer/'+'a'.repeat(64));
    expect(author.accountPhoto).toBe('https://example.test/account.png');expect(author.customPhoto).toBe(true);
    expect(author.avatarFallback).toBe('fallback');
    sql.mockResolvedValue([]);
    await expect(Photo.image('writer','a'.repeat(64))).rejects.toMatchObject({status:404});
  } finally {ensure.mockRestore();sql.mockRestore();}
});
