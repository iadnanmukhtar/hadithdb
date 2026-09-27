'use strict';
const fs=require('fs'),path=require('path');
const {extract,planImport}=require('../bin/utils/import-miraat-sharh');
const alignment=require('../bin/utils/miraat-alignment.json');
const row=(id,hadithId,num)=>({id,hadithId,num:String(num),bookId:100419,h1:1,h2:1,h3:1});
test('edition numbering is translated, not attached by equal printed number',()=>{
 const s={segments:[{kind:'hadith',numbers:[283],text:'Explanation',file:411,page:1,volume:2}]};
 const p=planImport(s,[row(10,100,281),row(11,200,283)],[]);
 expect(p.entries.map(e=>e.hadithId)).toEqual([100]);
});
test('co-numbered reports are not duplicated and ownership survives replacing the original',()=>{
 const s={segments:[{kind:'hadith',numbers:[199,200],text:'Explanation',file:304,page:302,volume:1}]};
 const before=planImport(s,[row(10,100,199)],[]).entries[0];
 const after=planImport(s,[row(10,200,199)],[]).entries[0];
 expect(after).toEqual({...before,hadithId:200});expect(after.text).toBe('Explanation');
});
test('explicitly combined variants link to both corresponding Mishkat references',()=>{
 const s={segments:[{kind:'hadith',numbers:[396],text:'Combined explanation',file:500,page:90,volume:2}]};
 expect(planImport(s,[row(10,100,393),row(11,200,394)],[]).entries).toHaveLength(2);
});
test('unreviewed source numbers and missing target links fail closed',()=>{
 expect(()=>planImport({segments:[{kind:'hadith',numbers:[9999]}]},[],[])).toThrow('Unreviewed');
 expect(()=>planImport({segments:[]},[row(1,null,1)],[])).toThrow('Unexpected');
});
const epub=path.resolve(__dirname,'../temp/miraat/miraat.epub');
(fs.existsSync(epub)?describe:describe.skip)('reviewed Mirat edition',()=>{
 let s;beforeAll(()=>{s=extract(epub);});
 test('imports all nine supplied volumes without inventing later coverage',()=>{
  expect(s.pages).toBe(4545);expect(s.entries.at(-1).numbers).toEqual([2783]);
  expect(alignment.mappings[2783]).toEqual([2758]);expect(alignment.mappings[2784]).toBeUndefined();
  const ns=new Set(s.entries.flatMap(e=>e.numbers));expect(Array.from({length:2783},(_,i)=>i+1).filter(n=>!ns.has(n))).toEqual([232,314]);
 });
 test('a chapter title mentioning the Book remains chapter commentary',()=>{
  const h=s.segments.find(e=>e.kind==='heading'&&e.file===238);
  expect(h.title).toContain('بالكتاب والسنة');expect(h.level).toBe(2);
  expect(alignment.headingTargets['238:2'].level).toBe(2);
 });
 test('printed misnumbers change mapping only, preserving the source wording',()=>{
  expect(s.entries.find(e=>e.numbers.includes(745)).text).toMatch(/^754-/);
  expect(s.entries.find(e=>e.numbers.includes(994)).text).toMatch(/^94-/);
  expect(s.entries.find(e=>e.numbers.includes(2638)).text).toMatch(/^2639-/);
 });
 test('separates chapter commentary and volume-one appendices from hadith explanations',()=>{
  const h=s.segments.filter(e=>e.kind==='heading');expect(h).toHaveLength(139);
  expect(h.find(e=>e.file===366).text).toContain('كلمة الناشر');
  expect(h.find(e=>e.file===38).text).toMatch(/^\(كتاب الإيمان\)/);
  expect(s.entries.find(e=>e.numbers.includes(1)).text).not.toContain('(كتاب الإيمان)');
  expect(s.entries.at(-1).text).toContain('تم الجزء التاسع');
 });
});
test('keeps the short Second Section explanation while skipping bare labels',()=>{
 const target=alignment.headingTargets['100:3'];
 const toc=[{id:target.tocId,bookId:100419,...target}];
 const h={kind:'heading',file:100,level:3,title:'الفصل الثاني',text:'(الفصل الثاني) أي المعبر به عن قوله من الحسان في المصابيح.'};
 expect(planImport({segments:[h]},[],toc).headings).toHaveLength(1);
 expect(planImport({segments:[{...h,text:'(الفصل الثاني)'}]},[],toc).headings).toHaveLength(0);
});
