'use strict';
const crypto=require('crypto');
const {compare,desiredFields}=require('../bin/utils/reimport-yqsirah');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
function fixture(){
 const entries=[{num:1,h1:1,h2:1,h3:null,level:2,start:1,end:2,count:2,title:'First Revelation',body:'Full source text[^one].',footnotes:'[^one]: A source note.',sha256:'source1'},
 {num:2,h1:1,h2:1,h3:1,level:3,start:2,end:2,count:1,title:'Jibril',body:'Supporting topic.',footnotes:'',sha256:'source2'}];
 const plan={entries,chapters:[{title:'Revelation',start:1,end:2}]};
 const rows=entries.map(e=>({id:100+e.num,num:String(e.num),ordinal:e.num,tocId:200+e.num,h1:e.h1,h2:e.h2,h3:e.h3,content_sha256:e.sha256,...Object.fromEntries(Object.entries(desiredFields(e)).map(([k,v])=>[`${k}_hash`,hash(v)]))}));
 const toc=[{id:200,level:1,h1:1,title_en:'Revelation',start0:1,end0:2},...entries.map(e=>({id:200+e.num,level:e.level,h1:e.h1,h2:e.h2,h3:e.h3,start0:e.start,end0:e.end,count:e.count,title_en:e.title}))];
 return {plan,rows,toc};
}
test('restoration detects shortened body, stale search text and edited footnotes independently',()=>{
 const {plan,rows,toc}=fixture();rows[0].body_en_hash=hash('Shortened');rows[1].text_en_hash=hash('Stale index text');rows[1].footnote_en_hash=hash('Edited note');
 const diff=compare(plan,rows,toc);
 expect(diff.summary).toMatchObject({changedPassages:2,bodyChanges:1,searchTextChanges:1,footnoteChanges:1,titleChanges:0});
 expect(diff.changes.map(c=>[c.id,c.fields])).toEqual([[101,['body_en']],[102,['text_en','footnote_en']]]);
 expect(Object.keys(desiredFields(plan.entries[0]))).toEqual(['title_en','body_en','text_en','footnote_en']);
});
test('an exact rerun is a no-op and any concurrent text change changes the state fingerprint',()=>{
 const {plan,rows,toc}=fixture();const before=compare(plan,rows,toc);expect(before.changes).toHaveLength(0);
 rows[0].body_en_hash=hash('Another edit');expect(compare(plan,rows,toc).state).not.toBe(before.state);
});
test.each(['count','order','hierarchy','heading title','range'])('restoration refuses unexpected %s changes',kind=>{
 const {plan,rows,toc}=fixture();
 if(kind==='count')rows.pop();
 if(kind==='order')rows.reverse();
 if(kind==='hierarchy')rows[1].h3=2;
 if(kind==='heading title')toc[1].title_en='User heading';
 if(kind==='range')toc[1].end0=1;
 expect(()=>compare(plan,rows,toc)).toThrow();
});
