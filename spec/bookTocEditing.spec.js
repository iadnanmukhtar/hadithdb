'use strict';
const Editing=require('../lib/BookTocEditing');
function fixture(virtual=0) {
  const headings=[{id:1,level:1,h1:1,h2:null,h3:null,ordinal:100}, {id:2,level:2,h1:1,h2:1,h3:null,ordinal:101}, {id:3,level:3,h1:1,h2:1,h3:1,ordinal:102}, {id:4,level:2,h1:1,h2:2,h3:null,ordinal:103}, {id:5,level:1,h1:2,h2:null,h3:null,ordinal:104}];
  const items=[{id:10,tocId:3,h1:1,h2:1,h3:1,ordinal:1000,num:'1a',num0:1,numInChapter:1,hadithId:90}, {id:11,tocId:3,h1:1,h2:1,h3:1,ordinal:1001,num:'2',num0:2,numInChapter:2,hadithId:91}, {id:12,tocId:4,h1:1,h2:2,h3:null,ordinal:1002,num:'3',num0:3,numInChapter:3,hadithId:92}];
  return {book:{id:7,alias:'example',type:'hadith',virtual},headings,items};
}
test.each([1,2,3])('adds H%s under its correct parent without changing existing identities',level=>{
 const state=fixture(), result=Editing.plan(state,{action:'add',level,parentId:level===2?1:2,title:'عنوان'});
 expect(result.added).toMatchObject({level,title:'عنوان'});
 expect(result.added['h'+level]).toBe(level===1?3:level===2?3:2);
 expect(result.items).toEqual(state.items);
 expect(state.headings).toHaveLength(5);
});
test('validates parent level and book ownership',()=>{
 expect(()=>Editing.plan(fixture(),{action:'add',level:3,parentId:1,title_en:'Title'})).toThrow('one level above');
 expect(()=>Editing.plan(fixture(),{action:'assign',id:10,headingId:999})).toThrow('does not belong');
});
test('cannot delete populated headings or headings with children',()=>{
 for(const id of [1,2,3,4]) expect(()=>Editing.plan(fixture(),{action:'delete',id})).toThrow('child headings first');
 expect(Editing.plan(fixture(),{action:'delete',id:5}).headings.map(h=>h.id)).toEqual([1,2,3,4]);
});
test('moves item up, preserving references and changing reader order',()=>{
 const result=Editing.plan(fixture(),{action:'moveItem',id:11,direction:'up'});
 expect(result.items.map(i=>i.id)).toEqual([11,10,12]);
 expect(result.items.map(i=>i.num)).toEqual(['2','1a','3']);
 expect(result.items.map(i=>i.ordinal)).toEqual([1000,1001,1002]);
 expect(result.items.map(i=>i.numInChapter)).toEqual([1,2,3]);
});
test('up/down cannot silently move an item into another heading',()=>{
 expect(()=>Editing.plan(fixture(),{action:'moveItem',id:11,direction:'down'})).toThrow('Move to heading');
});
test('moving a heading moves its subtree and items as a block, preserving paths',()=>{
 const state=fixture(),result=Editing.plan(state,{action:'moveHeading',id:4,direction:'up'});
 expect(result.headings.map(h=>h.id)).toEqual([1,4,2,3,5]);
 expect(result.items.map(i=>i.id)).toEqual([12,10,11]);
 expect(result.headings.find(h=>h.id===4).h2).toBe(2);
 expect(result.items.map(i=>i.num)).toEqual(['3','1a','2']);
});
test('assigns an item to an empty chapter and repairs chapter-local positions',()=>{
 const result=Editing.plan(fixture(),{action:'assign',id:10,headingId:5});
 expect(result.items.map(i=>i.id)).toEqual([11,12,10]);
 expect(result.items[2]).toMatchObject({tocId:5,h1:2,h2:null,h3:null,num:'1a',numInChapter:1});
});
test('virtual assignment keeps all ordinals and references',()=>{
 const state=fixture(1),result=Editing.plan(state,{action:'assign',id:10,headingId:5});
 expect(result.items.map(i=>[i.id,i.num,i.ordinal])).toEqual(state.items.map(i=>[i.id,i.num,i.ordinal]));
 expect(result.items[0]).toMatchObject({tocId:5,h1:2,h2:null,h3:null});
 for(const action of ['moveHeading','moveItem']) expect(()=>Editing.plan(state,{action,id:10,direction:'up'})).toThrow('reference-number order');
});
describe('transaction boundary',()=>{
 const originalPool=global.dbPool;
 let connection,state,command,fail;
 beforeEach(()=>{
  state=fixture(); command={action:'assign',id:10,headingId:5,revision:Editing.revision(state)};
  fail=false;
  connection={beginTransaction:jest.fn(cb=>cb(null)),commit:jest.fn(cb=>cb(null)),rollback:jest.fn(cb=>cb(null)),release:jest.fn(),query:jest.fn((sql,args,cb)=>{
   if(fail && sql.startsWith('UPDATE hadiths')) return cb(new Error('write failed'));
   if(sql.startsWith('SELECT id,alias')) return cb(null,[state.book]);
   if(sql.includes('FROM toc WHERE bookId')) return cb(null,state.headings);
   if(sql.includes('FROM hadiths WHERE bookId')) return cb(null,state.items);
   cb(null,[]);
  })};
  global.dbPool={getConnection:cb=>cb(null,connection)};
 });
 afterEach(()=>{global.dbPool=originalPool;});
 test('commits item changes and all ancestor ranges on one connection',async()=>{
  await Editing.mutate(7,command,'admin');
  expect(connection.commit).toHaveBeenCalledTimes(1);
  const calls=connection.query.mock.calls;
  expect(calls.find(([sql])=>sql.startsWith('UPDATE toc') )[1]).toEqual([100,2,'2','3',2,3,'admin',1,7]);
  expect(calls.find(([sql,args])=>sql.startsWith('UPDATE hadiths')&&args[7]===10)[1]).toEqual([1002,5,2,null,null,1,'admin',10,7]);
  expect(connection.release).toHaveBeenCalled();
 });
 test('stale revisions reject before any write',async()=>{
  command.revision='stale';
  await expect(Editing.mutate(7,command,'admin')).rejects.toThrow('TOC changed');
  expect(connection.query.mock.calls.some(([sql])=>sql.startsWith('UPDATE'))).toBe(false);
  expect(connection.rollback).toHaveBeenCalled();
 });
 test('a failed write rolls back the complete change',async()=>{
  fail=true;
  await expect(Editing.mutate(7,command,'admin')).rejects.toThrow('write failed');
  expect(connection.rollback).toHaveBeenCalledTimes(1);
  expect(connection.commit).not.toHaveBeenCalled();
  expect(connection.release).toHaveBeenCalledTimes(1);
 });
 test('attached commentary prevents deletion',async()=>{
  const normal=connection.query.getMockImplementation();
  connection.query.mockImplementation((sql,args,cb)=>sql.includes('FROM hdith_toc_sharh')?cb(null,[{id:9}]):normal(sql,args,cb));
  await expect(Editing.mutate(7,{action:'delete',id:5,revision:Editing.revision(state)},'admin')).rejects.toThrow('commentary attached');
  expect(connection.query.mock.calls.some(([sql])=>sql.startsWith('DELETE'))).toBe(false);
 });
});
