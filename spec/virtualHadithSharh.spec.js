'use strict';
const {plan}=require('../bin/utils/link-virtual-sharh');
const {linkRows}=require('../lib/VirtualHadithSharh');
const virtual=(id,bookId,num0,hadithId,h2=num0)=>({id,bookId,num0,hadithId,h2,textActual:null});
test('legacy source numbering identifies the virtual entry after a replacement',()=>{
 const rows=[{id:1,source_book_id:-5,source_entry_id:3330631,hadith_id:100}];
 const targets=[virtual(20,61,631,200)];
 expect(()=>plan(rows,targets,{})).toThrow('Ownership mismatch');
 expect(plan(rows,targets,{},true)).toEqual([{sharhId:1,virtualId:20,number:631,oldHadithId:100,hadithId:200}]);
});
test('Ibn Rajab primary selection skips an unlinked row and preserves chapter identity',()=>{
 const rows=[{id:1,source_book_id:-7,source_entry_id:-7000044,hadith_id:100}];
 expect(plan(rows,[virtual(1,57,44,null),virtual(2,57,44.001,100,44)],{})[0].virtualId).toBe(2);
});
test('Dalil links only the reviewed virtual id, not another reference to the same hadith',()=>{
 const rows=[{id:1,source_book_id:-9,source_entry_id:-9000096,hadith_id:100}];
 const alignment={segments:[{kind:'hadith',start:96,virtualId:2,number:1}]};
 expect(plan(rows,[virtual(1,61,1,100),virtual(2,61,1.001,100)],alignment)[0].virtualId).toBe(2);
});
test('ownership is idempotent and conflicts fail without overwriting',async()=>{
 const q=jest.fn().mockResolvedValue([{sharh_id:1,virtual_id:2,source_number:3}]);
 await linkRows(q,[{sharhId:1,virtualId:2,number:3}]);expect(q).toHaveBeenCalledTimes(1);
 await expect(linkRows(q,[{sharhId:1,virtualId:4,number:3}])).rejects.toThrow('Conflicting');
 expect(q).toHaveBeenCalledTimes(2);
});
test('source-scoped uniqueness permits independent commentaries with the same entry number',async()=>{
 const {ensureSchema,triggers}=require('../lib/VirtualHadithSharh');
 const q=jest.fn().mockResolvedValueOnce(['hadith_id','source_entry_id'].map((Column_name,i)=>({Key_name:'hdith_sharh_entry',Column_name,Seq_in_index:i+1})))
  .mockResolvedValueOnce({}).mockResolvedValueOnce({}).mockResolvedValueOnce(Object.entries(triggers).map(([Trigger,s])=>({Trigger,Statement:s.slice(s.indexOf('BEGIN'))})));
 await ensureSchema(q);
 expect(q.mock.calls[1][0]).toContain('(hadith_id,source_id,source_entry_id)');
});
