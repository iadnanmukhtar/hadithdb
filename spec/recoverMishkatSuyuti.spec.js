'use strict';
const {footerEvidence,eligible,exactEvidence}=require('../bin/recover-mishkat-suyuti');
const text='عن أنس قال: «لا يؤمن أحدكم حتى يحب لأخيه ما يحب لنفسه» رواه أبو داود';
const h={number:999999,text,sources:['abudawud'],numbers:[999999],links:[]};
const c={id:999999,alias:'suyuti',bookId:1000,num:'test',body:'لا يؤمن أحدكم حتى يحب لأخيه ما يحب لنفسه',footnote:'[د] أبو داود عن أنس'};
test('requires the cited collection and narrator in the same footer attribution',()=>{
 expect(exactEvidence(h,c)).not.toBeNull();
 expect(exactEvidence(h,{...c,footnote:'[م] مسلم عن أنس'})).toBeNull();
 expect(exactEvidence(h,{...c,footnote:'[د] أبو داود عن عمر، [م] مسلم عن أنس'})).toBeNull();
 expect(exactEvidence(h,{...c,footnote:'[د] أبو داود عَنْ أنس'})).not.toBeNull();
});
test('matches the individual body rather than neighboring reports in raw text',()=>{
 expect(exactEvidence(h,{...c,body:'نص آخر',text:c.body})).toBeNull();
 expect(exactEvidence(h,{...c,body:c.body.replace('لا ','')})).toBeNull();
 expect(exactEvidence(h,{...c,alias:'muslim'})).toBeNull();
});
test('does not mistake a narrator or a different work for the cited collection',()=>{
 expect(footerEvidence({...h,sources:['malik']},{...c,footnote:'[د] أبو داود عن أنس بن مالك'})).toBeNull();
 expect(footerEvidence({...h,text:'رواه البخاري',sources:['bukhari']},{...c,footnote:'[خ] البخاري في الأدب عن أنس'})).toBeNull();
 expect(footerEvidence({...h,text:'رواه البيهقي في شعب الإيمان',sources:['shuab']},{...c,footnote:'[ق] البيهقي في السنن عن أنس'})).toBeNull();
 expect(footerEvidence({...h,text:'رواه الشافعي',sources:[]},{...c,footnote:'الشافعي عن أنس'}).sourceKeys).toEqual(['shafii']);
});
test('preserves existing aliases and leaves grouped reports for review',()=>{
 expect(eligible(h)).toBe(true);
 expect(eligible({...h,links:[{id:1}]})).toBe(false);
 expect(eligible({...h,numbers:[1,2]})).toBe(false);
});
test('reviewed exceptions remain bound to source, target, and footer hashes',()=>{
 const fs=require('fs'),crypto=require('crypto');
 const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
 const target={...c,body:c.body.replace('أحدكم','احدك')};
 const decision={number:h.number,id:c.id,sourceTextSha256:sha(h.text),
  targetSha256:sha(JSON.stringify([target.id,target.bookId,target.num,target.chain,target.body,target.text])),
  footerSha256:sha(target.footnote),note:'Reviewed transcription error'};
 const original=fs.readFileSync;
 const mock=jest.spyOn(fs,'readFileSync').mockImplementation((path,...args)=>path==='docs/imports/mishkat-suyuti-reviewed.json'?JSON.stringify([decision]):original(path,...args));
 try {jest.isolateModules(()=>{
  const match=require('../bin/recover-mishkat-suyuti').exactEvidence;
  expect(match(h,target)?.method).toBe('reviewed-suyuti-footer-match');
  expect(match(h,{...target,footnote:target.footnote+' changed'})).toBeNull();
  expect(match({...h,text:h.text+' changed'},target)).toBeNull();
  expect(match(h,{...target,body:target.body+' changed'})).toBeNull();
 });}finally{mock.mockRestore();}
});
