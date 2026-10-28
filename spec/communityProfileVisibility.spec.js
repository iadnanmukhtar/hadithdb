'use strict';
const Visibility=require('../lib/CommunityProfileVisibility');
const Community=require('../lib/Community');

test('public profiles require sign-in and private profiles allow only their owner',()=>{
 for(const visibility of ['public','private']) {
  const author={uid:'owner',profile_visibility:visibility};
  expect(()=>Visibility.check(author,null)).toThrow('sign in');
  expect(()=>Visibility.check(author,{uid:'owner'})).not.toThrow();
  if(visibility==='private') {
   expect(()=>Visibility.check(author,{uid:'reader'})).toThrow('unavailable');
   expect(()=>Visibility.check(author,{uid:'moderator',admin:true})).toThrow('unavailable');
  } else expect(()=>Visibility.check(author,{uid:'reader'})).not.toThrow();
 }
 expect(Visibility.value(undefined,'private')).toBe('private');
 for(const value of [null,true,'friends','PUBLIC'])expect(()=>Visibility.value(value)).toThrow();
});

test('profile details and author feeds enforce visibility before returning personal data',async()=>{
 const original=global.dbPool;
 let visibility='private';
 global.dbPool={query(statement,values,callback){
  if(typeof values==='function'){callback=values;values=[];}
  const author={uid:'owner',handle:'writer',name:'Writer Name',bio:'Private biography',profile_visibility:visibility};
  callback(null,statement.includes('SELECT a.uid, a.handle')||statement.startsWith('SELECT uid, profile_visibility')?[author]:[]);
 }};
 try {
  await expect(Community.profile('writer')).rejects.toMatchObject({status:401});
  await expect(Community.profile('writer',{uid:'reader'})).rejects.toMatchObject({status:404});
  await expect(Community.feed({author:'writer'})).rejects.toMatchObject({status:401});
  await expect(Community.feed({author:'writer'},{uid:'reader'})).rejects.toMatchObject({status:404});
  expect((await Community.profile('writer',{uid:'owner'})).bio).toBe('Private biography');
  visibility='public';
  expect((await Community.profile('writer',{uid:'reader'})).bio).toBe('Private biography');
  await expect(Community.profile('writer')).rejects.toMatchObject({status:401});
 }finally{global.dbPool=original;}
});
