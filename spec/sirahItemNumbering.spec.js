'use strict';
const {numbering}=require('../bin/utils/renumber-sirah-items');
const {sourceReference}=require('../lib/SirahReader');
const items=Array.from({length:1666},(_,n)=>({id:n+10,num:813787+n*2}));
test('numbers source-ordered passages from one and maps inclusive heading ranges',()=>{
 const plan=numbering(items,[{id:1,start:items[0].num,end:items.at(-1).num},{id:2,start:items[4].num,end:items[9].num}]);
 expect(plan.items[0]).toEqual({id:10,num:1});expect(plan.items.at(-1)).toEqual({id:1675,num:1666});
 expect(plan.ranges).toEqual([{id:1,start:1,end:1666},{id:2,start:5,end:10}]);
});
test('rejects unmapped heading boundaries before writes',()=>expect(()=>numbering(items,[{id:1,start:0,end:items[2].num}])).toThrow('Unmapped'));
test('rejects duplicate passage identities',()=>expect(()=>numbering([...items.slice(1),items[1]],[])).toThrow('identities'));
test('resolves old source references without querying ordinary current references',async()=>{
 const oldQuery=global.query;global.query=jest.fn().mockResolvedValue([{num:'1'}]);
 try{
  expect(await sourceReference({id:100412,alias:'ibnhisham',type:'sirah'},'813787')).toBe('1');
  expect(await sourceReference({id:100412,alias:'ibnhisham',type:'sirah'},'1')).toBeNull();
  expect(await sourceReference({alias:'bukhari',type:'hadith'},'813787')).toBeNull();
  expect(global.query).toHaveBeenCalledTimes(1);
 }finally{global.query=oldQuery;}
});
