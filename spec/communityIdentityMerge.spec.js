'use strict';
const {planIdentities} = require('../bin/community-merge-identities');
const account={user_uid:'107361275714259666403',user_email:'person@example.test'};
const record={user_uid:'firebaseOld',user_email:'person@example.test',user_provider:'google.com',user_name:'A name'};
test('maps historical Google IDs to one current account and is idempotent',()=>{
 expect(planIdentities([record],[account])).toEqual([{oldUid:'firebaseOld',uid:account.user_uid,name:'A name'}]);
 expect(planIdentities([{...record,user_uid:account.user_uid}],[account])).toEqual([]);
});
test('never merges by name, anonymous IDs, conflicting emails/providers or ambiguous accounts',()=>{
 for(const rows of [[{...record,user_email:'other@example.test'}],[{...record,user_uid:null}],[record,{...record,user_email:'other@example.test'}],[{...record,user_provider:'password'}]]) expect(planIdentities(rows,[account])).toEqual([]);
 expect(planIdentities([record],[account,{...account,user_uid:'109787490490457066896'}])).toEqual([]);
});
