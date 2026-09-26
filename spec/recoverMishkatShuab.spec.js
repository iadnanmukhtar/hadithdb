'use strict';
const {citations,eligible,entryExtract,exactEvidence}=require('../bin/recover-mishkat-shuab');
const {sources}=require('../bin/import-mishkat-epub');
const entry=(number,text,numbers=[number])=>({number,text,numbers,links:[],sources:[]});
test('distinguishes Shuab from Sunan and unspecified Bayhaqi citations',()=>{
 expect(sources('رواه البيهقي في شعب الإيمان')).toEqual(['shuab']);
 expect(sources('رواه البيهقي في سننه الكبير')).toEqual(['bayhaqi']);
 expect(sources('رواه البيهقي في الدعوات الكبير')).toEqual([]);
 expect(sources('رواه البيهقي')).toEqual([]);
 expect(citations([entry(1,'عن شعبة قال رواه مسلم')]).size).toBe(0);
});
test('shared citations cover the specified passages including a grouped passage',()=>{
 const es=[entry(1,'غير ذلك'),entry(2,'الأول'),entry(3,'الثاني'),entry(4,'روى البيهقي الأحاديث الثلاثة في شعب الإيمان',[4,5])];
 expect([...citations(es).keys()].sort()).toEqual([2,3,4]);
 expect(eligible(es[1],es)).toBe(true);
 expect(eligible(es[3],es)).toBe(false);
 expect(eligible({...es[1],links:[{id:1}]},es)).toBe(false);
});
test('the inspected dual citation covers its preceding report',()=>{
 const es=[entry(2307,'الحمد رأس الشكر'),entry(2308,'رواهما البيهقي في شعب الإيمان')];
 expect(citations(es).get(2307).citationNumber).toBe(2308);
});
test('extracts the explicit narrator without the following prophetic attribution',()=>{
 expect(entryExtract(entry(1,'[7] عن أنس عن النبي صلى الله عليه وسلم قال: «لا يؤمن أحدكم حتى يحب لأخيه ما يحب لنفسه» رواه البيهقي في شعب الإيمان')).narrator).toBe('انس');
});
test('exact matching retains narrator, negation and collection constraints',()=>{
 const h={...entry(99999,'عن أنس قال: «لا يؤمن أحدكم حتى يحب لأخيه ما يحب لنفسه»'),sources:['shuab']};
 const c={id:99999,alias:'shuab',chain:'عن أنس',body:'لا يؤمن أحدكم حتى يحب لأخيه ما يحب لنفسه'};
 expect(exactEvidence(h,c)).not.toBeNull();
 expect(exactEvidence(h,{...c,alias:'bayhaqi'})).toBeNull();
 expect(exactEvidence(h,{...c,body:c.body.replace('لا ','')})).toBeNull();
 expect(exactEvidence(h,{...c,chain:'عن عمر'})).toBeNull();
});
