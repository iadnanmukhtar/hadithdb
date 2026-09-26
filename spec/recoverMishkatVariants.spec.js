'use strict';
const {bodyEvidence,narratorEvidence,exactEvidence,choose,splitEntries}=require('../bin/recover-mishkat-variants');
test('accepts clause reordering but preserves the association of negation',()=>{
 const a='من مات لا يشرك بالله شيئا دخل الجنة ومن مات يشرك بالله شيئا دخل النار';
 expect(bodyEvidence(a,'من مات يشرك بالله شيئا دخل النار ومن مات لا يشرك بالله شيئا دخل الجنة')).not.toBeNull();
 expect(bodyEvidence(a,a.replace('لا يشرك','يشرك'))).toBeNull();
 expect(bodyEvidence(a,'من مات لا يشرك بالله شيئا دخل النار ومن مات يشرك بالله شيئا دخل الجنة')).toBeNull();
});
test('requires explicit narrator identity and the cited collection',()=>{
 const h={text:'عن جابر قال: «من مات لا يشرك بالله شيئا دخل الجنة ومن مات يشرك بالله شيئا دخل النار»',sources:['muslim']};
 const c={alias:'muslim',chain:'عن أبي سفيان عن جابر قال',body:'من مات يشرك بالله شيئا دخل النار ومن مات لا يشرك بالله شيئا دخل الجنة'};
 expect(exactEvidence(h,c)).not.toBeNull();
 expect(exactEvidence(h,{...c,chain:'عن عبد الله قال'})).toBeNull();
 expect(exactEvidence(h,{...c,alias:'bukhari'})).toBeNull();
 expect(narratorEvidence('عمر',{chain:'عن ابن عمر قال'})).toBeNull();
 expect(narratorEvidence('الزبير',{chain:'عن ابن الزبير قال'})).toBeNull();
});
test('selects best evidence then the lowest numeric book reference',()=>{
 const candidate=(num,score)=>({c:{num,id:Number.parseInt(num)},evidence:{score}});
 expect(choose([candidate('10',1),candidate('2',1),candidate('1',.9)]).c.num).toBe('2');
});
test('splits a numbered group in narrator order and preserves its original text',()=>{
 const text='وعن عمر وأنس وابن الزبير وأبي أمامة عن النبي قال: «من لبس الحرير في الدنيا لم يلبسه في الآخرة». متفق عليه';
 const h={number:4316,numbers:[4316,4317,4318,4319],text,sources:[],links:[],review:[]};
 const result=splitEntries([h]);
 expect(result.map(h=>h.number)).toEqual([4316,4317,4318,4319]);
 expect(result.map(h=>h.splitNarrator)).toEqual(['عمر','أنس','ابن الزبير','أبي أمامة']);
 expect(result.every(h=>h.numbers.length===1&&h.groupSource.text===text)).toBe(true);
 expect(result[0].sources).toContain('bukhari');
 expect(()=>splitEntries([{...h,links:[{id:1}]}])).toThrow();
});
