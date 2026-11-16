'use strict';
const {args,checkReport,fieldPlan,verifyPatch}=require('../bin/utils/yqsirah-guarded-batch');
const state='a'.repeat(64);
const select=[159,347];
const before={bookId:100427,id:647,num:'159',h1:15,h2:1,h3:null,title_en:'The Night Journey',body_en:'Old',text_en:'Old',footnote_en:'Earlier note'};
const source={num:159,h1:15,h2:1,h3:null,title:'The Night Journey'};
const draft={fields:{body:{text:'New\n\n%%\nOld\n%%'},footnotes:{text:'New note'},title:{text:source.title}}};
const doc={_id:'647',_seq_no:1,_primary_term:2,_source:{num:'159',book_id:100427,book_alias:'yqsirah',hId:647,path:'yqsirah/15/1',ref:'yqsirah:159',title_en:source.title,body_en:'Old',text:'Old',body_en_search:'Old',footnote_en:'Earlier note',footnote_en_search:'Earlier note',unrelated:'keep exact'}};
test('defaults to dry-only and requires exact bounded IDs and explicit state for either with-write mode',()=>{
 expect(args(['--ids=347,159'])).toEqual({ids:select,mode:'dry',state:undefined});
 expect(args(['--ids=159,347','--apply','--expected-state='+state]).mode).toBe('apply');
 expect(args(['--ids=159,347','--resume-index-only','--expected-state='+state]).mode).toBe('resume');
 expect(()=>args(['--ids=159,347','--apply'])).toThrow('Exact --expected-state');
 expect(()=>args(['--ids=159,159'])).toThrow('Duplicate');
 expect(()=>args(['--ids=1024'])).toThrow('bounded');
 expect(()=>args(['--ids=159','--apply','--resume-index-only','--expected-state='+state])).toThrow('separate modes');
});
test('rejects any surprise candidate, book, state, or receipt without backup',()=>{
 const good={applied:true,bookId:100427,changed:select,state,backup:'yqsirah_format_h_42'};
 expect(()=>checkReport(good,select,{applied:true,state})).not.toThrow();
 expect(()=>checkReport({...good,changed:[159,347,576]},select,{applied:true,state})).toThrow('exactly match');
 expect(()=>checkReport({...good,bookId:2},select,{applied:true,state})).toThrow();
 expect(()=>checkReport({...good,state:'b'.repeat(64)},select,{applied:true,state})).toThrow('Live state changed');
 expect(()=>checkReport({...good,backup:null},select,{applied:true,state})).toThrow('backup');
});
test('patches only scoped body/note fields, rejects unexpected versions or identity, and preserves unrelated fields',()=>{
 const plan=fieldPlan(before,before,doc,source,draft);
 const expectedPatch={body_en:draft.fields.body.text,text:draft.fields.body.text,body_en_search:draft.fields.body.text,footnote_en:'New note',footnote_en_search:'New note'};
 expect(plan.patch).toEqual(expectedPatch);
 for(const [key,value] of Object.entries({title_en:'Wrong',path:'yqsirah/15/2',book_id:5,ref:'bukhari:159',hId:88,body_en:'Unexpected intervening update'}))
  expect(()=>fieldPlan(before,before,{...doc,_source:{...doc._source,[key]:value}},source,draft)).toThrow();
 expect(()=>fieldPlan(before,before,{...doc,_seq_no:null},source,draft)).toThrow('conditional');
 const after={...doc,_source:{...doc._source,...expectedPatch}};
 expect(()=>verifyPatch(plan,after)).not.toThrow();
 expect(fieldPlan(before,before,after,source,draft).patch).toEqual({});
 expect(()=>verifyPatch(plan,{...after,_source:{...after._source,unrelated:'changed'}})).toThrow('Unrelated');
 expect(()=>verifyPatch(plan,{...after,_source:{...after._source,inserted:'surprise'}})).toThrow('Unrelated');
});

test('separator correction removes only adjacent matching Arabic-to-English quote separators outside archives',()=>{
 const {stripQuoteSeparators,renderSignature}=require('../bin/utils/yqsirah-quote-separator');
 const url='https://quran.islamunlocked.com/quran:94:6';
 const q='> ﴿إِنَّ مَعَ الْعُسْرِ يُسْرًا﴾ ([الشرح ٦]('+url+'))\n\n<!-- -->\n\n> Indeed, with hardship comes ease. ([al-Sharh 94:6]('+url+'))';
 const reverse='> English ([check]('+url+'))\n\n<!-- -->\n\n> العربية ([آية]('+url+'))';
 const unrelated='Paragraph.\n\n<!-- -->\n\n> Unrelated quotation.';
 const original=q+'\n\n'+reverse+'\n\n'+unrelated+'\n\n%%\n'+q+'\n%%';
 const result=stripQuoteSeparators(original);
 expect(result.removed).toBe(1);
 expect(result.body).toBe(q.replace('<!-- -->\n\n','')+'\n\n'+reverse+'\n\n'+unrelated+'\n\n%%\n'+q+'\n%%');
 expect(renderSignature(result.body,'')).toEqual(renderSignature(original,''));
 expect(stripQuoteSeparators(q.replace(/94:6\)\)$/, '94:5))')).removed).toBe(0);
});
