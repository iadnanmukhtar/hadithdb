'use strict';
const Source=require('../lib/CommunityActivitySource');
const ContentItems=require('../lib/ContentItems');
afterEach(()=>jest.restoreAllMocks());
test('uses persisted commentary title and canonical URL without reader lookup',async()=>{
  const reader=jest.spyOn(ContentItems,'get');
  const q=jest.fn().mockResolvedValue([{source_title:'Actions by intentions',source_url:'/sharh/riyad-uthaymin/bukhari:1#note-sharh-42'}]);
  expect(await Source.resolve(q,{type:'content',hadithId:88,ref_num:'items/88'})).toEqual({title:'Actions by intentions',reference:'riyad-uthaymin/bukhari:1',url:'/sharh/riyad-uthaymin/bukhari:1#note-sharh-42'});
  expect(q).toHaveBeenCalledTimes(1);
  expect(reader).not.toHaveBeenCalled();
});
test('reads hadith titles and opening words from the existing source data',()=>{
  expect(Source.fromRow({type:'hadith',ref_num:'bukhari:1',source_title:'Actions by intentions',source_text:'Other words'})).toEqual({title:'Actions by intentions',reference:'bukhari:1'});
  expect(Source.fromRow({type:'hadith',ref_num:'bukhari:2',source_text:'<p>These are the <b>opening words</b> of this hadith with more detail.</p>'})).toEqual({title:'These are the opening words of this hadith…',reference:'bukhari:2'});
  expect(Source.fromRow({type:'content',ref_num:'items/88'})).toEqual({title:'a source passage',reference:''});
});
test('deep feed pages add no queries for title or reference hydration',async()=>{
  const reader=jest.spyOn(ContentItems,'get');
  const candidates=Array.from({length:1021},(_,i)=>({id:i+1,type:'content',hadithId:i+1,ref_num:'items/'+(i+1),handle:'reader',name:'Reader',source_title:'Title '+(i+1),source_url:'/sharh/riyad-uthaymin/bukhari:'+(i+1)}));
  const q=jest.fn(async sql=>sql.includes('FROM hadiths_likes l') ? candidates : []);
  const all=await require('../lib/CommunityLikes').feed(q,{scope:'everyone',limit:1021},()=>({html:'',excerpt:''}));
  expect(q).toHaveBeenCalledTimes(5); // The original five feed queries only.
  expect(reader).not.toHaveBeenCalled();
  expect(all[1000]).toMatchObject({title:'Title 1001',sourceRef:'riyad-uthaymin/bukhari:1001'});
  expect(all.some(item=>item.activitySource)).toBe(false);
  const html=await require('ejs').renderFile(require('path').join(__dirname,'../views/sub-views/community_card.ejs'),{item:all[87]});
  expect(html).toContain('Title 88');
  expect(html).toContain('riyad-uthaymin/bukhari:88');
  expect(html).not.toContain('items/88');
});
test('persists the first words when an explanation has no title',async()=>{
  jest.spyOn(require('../lib/Sharh'),'entryById').mockResolvedValue({entry:{text_en:'These are the opening words of this explanation with more detail.'},book:{alias:'riyad-uthaymin'},canonical:'/sharh/riyad-uthaymin/bukhari:1'});
  expect(await ContentItems.source('sharh:42')).toEqual({title:'These are the opening words of this explanation…',url:'/sharh/riyad-uthaymin/bukhari:1#note-sharh-42'});
});
test('one-time metadata refresh is read-only by default and protects concurrent edits on apply',async()=>{
  const refresh=require('../bin/community-refresh-item-metadata').refresh;
  const q=jest.fn(async sql=>sql.includes('FROM content_items ci JOIN hdith_hadith_sharh') ? [{id:88,entry_id:42,old_title:'Book alias',old_url:'/sharh/riyad-uthaymin/bukhari:1#note-sharh-42',text_en:'First few words of this explanation.',alias:'riyad-uthaymin',reference:'bukhari:1'}] : sql.startsWith('UPDATE') ? {affectedRows:1} : []);
  expect(await refresh(q)).toEqual({candidates:1,updated:0,apply:false});
  expect(q.mock.calls.some(([sql])=>sql.startsWith('UPDATE'))).toBe(false);
  expect(await refresh(q,true)).toEqual({candidates:1,updated:1,apply:true});
  expect(q.mock.calls.find(([sql])=>sql.startsWith('UPDATE'))).toEqual(['UPDATE content_items SET title=?,url=? WHERE id=? AND title=? AND url=?',['First few words of this explanation.','/sharh/riyad-uthaymin/bukhari:1#note-sharh-42',88,'Book alias','/sharh/riyad-uthaymin/bukhari:1#note-sharh-42']]);
});
