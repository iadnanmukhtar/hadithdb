'use strict';
jest.mock('../lib/UserSettings',()=>({isAdminUser:jest.fn()}));
const Settings=require('../lib/UserSettings'),C=require('../lib/Community');
const original=process.env.COMMUNITY_MODERATOR_UIDS;
beforeEach(()=>{Settings.isAdminUser.mockReset();Settings.isAdminUser.mockResolvedValue(false);process.env.COMMUNITY_MODERATOR_UIDS='configured-moderator';});
afterAll(()=>{if(original===undefined)delete process.env.COMMUNITY_MODERATOR_UIDS;else process.env.COMMUNITY_MODERATOR_UIDS=original;});
test('persisted site administrators inherit moderation access',async()=>{
 Settings.isAdminUser.mockResolvedValue(true);expect(await C.canModerate({uid:'site-admin'})).toBe(true);expect(Settings.isAdminUser).toHaveBeenCalledWith('site-admin');
});
test('explicit moderators retain access without an admin lookup',async()=>{
 expect(await C.canModerate({uid:'configured-moderator'})).toBe(true);expect(Settings.isAdminUser).not.toHaveBeenCalled();
});
test('anonymous users and ordinary authors do not acquire moderator privileges',async()=>{
 expect(await C.canModerate(null)).toBe(false);expect(Settings.isAdminUser).not.toHaveBeenCalled();
 expect(await C.canModerate({uid:'ordinary',email:'configured-moderator'})).toBe(false);
 await expect(C.moderation({uid:'ordinary'})).rejects.toMatchObject({status:403});
 await expect(C.moderate({uid:'ordinary'},3,{action:'approve',admin:true})).rejects.toMatchObject({status:403});
});

test('moderation is disabled by default and an administrator cannot invoke disabled actions',async()=>{
 const previous=process.env.COMMUNITY_MODERATION_ENABLED;delete process.env.COMMUNITY_MODERATION_ENABLED;
 try {
  Settings.isAdminUser.mockResolvedValue(true);expect(C.moderationEnabled()).toBe(false);
  await expect(C.moderation({uid:'site-admin'})).rejects.toMatchObject({status:404});
  await expect(C.moderate({uid:'site-admin'},3,{action:'approve'})).rejects.toMatchObject({status:404});
  process.env.COMMUNITY_MODERATION_ENABLED='true';expect(C.moderationEnabled()).toBe(true);
 } finally {if(previous===undefined)delete process.env.COMMUNITY_MODERATION_ENABLED;else process.env.COMMUNITY_MODERATION_ENABLED=previous;}
});
