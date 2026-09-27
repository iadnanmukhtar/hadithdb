'use strict';
const fs=require('fs'),path=require('path');
const {extract,planImport}=require('../bin/utils/import-lamaat-sharh');
const row=(id,hadithId,num)=>({id,hadithId,num:String(num),bookId:100419,h1:1,h2:1,h3:1});
test('Lamaat follows the stable virtual reference when its original is replaced',()=>{
 const source={segments:[{kind:'hadith',numbers:[1],text:'Explanation',file:161,page:165,volume:1}]};
 const before=planImport(source,[row(1,100,1)],[]).entries[0];
 const after=planImport(source,[row(1,200,1)],[]).entries[0];
 expect(after).toEqual({...before,hadithId:200});
});
test('combined source numbers share commentary and bare headings produce no cards',()=>{
 const source={segments:[{kind:'heading',title:'الفصل الثاني',text:'الفصل الثاني',file:1,level:3},{kind:'hadith',numbers:[303,304],text:'Combined explanation',file:641,page:1,volume:2}]};
 const p=planImport(source,[row(1,100,303),row(2,200,304)],[]);
 expect(p.headings).toEqual([]);expect(p.entries.map(e=>e.hadithId)).toEqual([100,200]);
});
test('a section without numbered hadiths belongs to its named section',()=>{
 const source={segments:[{kind:'heading',title:'الفصل الثاني',text:'الفصل الثاني\nشرح الفصل',file:3975,level:3},{kind:'hadith',numbers:[4054],text:'Explanation',file:3976}]};
 const p=planImport(source,[{...row(1,100,4054),h3:3}],[{id:1,h1:1,h2:1,h3:2,level:3},{id:2,h1:1,h2:1,h3:3,level:3}]);
 expect(p.headings[0].tocId).toBe(1);
});
const epub=path.resolve(__dirname,'../temp/lamaat/lamaat.epub');
(fs.existsSync(epub)?describe:describe.skip)('reviewed Lamaat EPUB',()=>{
 let source;beforeAll(()=>{source=extract(epub);});
 test('conserves the source and covers only explicitly explained numbers',()=>{
  expect(source.pages).toBe(6316);expect(source.entries).toHaveLength(6103);
  const covered=new Set(source.entries.flatMap(e=>e.numbers));
  expect(Array.from({length:6294},(_,i)=>i+1).filter(n=>!covered.has(n))).toEqual([1901,2410,2797,6078]);
 });
 test('corrects numbering metadata without rewriting source spellings',()=>{
  expect(source.entries.find(e=>e.numbers.includes(68)).text).toMatch(/^468 -/);
  expect(source.entries.find(e=>e.numbers.includes(4335)).numbers).toEqual([4334,4335]);
  expect(source.entries.find(e=>e.numbers.includes(4665)).text).toMatch(/^46665,/);
  expect(source.entries.find(e=>e.numbers.includes(5661)).text).toMatch(/^5761 -/);
 });
 test('separates chapter definitions and appendices from neighboring hadiths',()=>{
  expect(source.segments.find(e=>e.kind==='heading'&&e.file===284).text).toContain('الكبائر جمع كبيرة');
  expect(source.entries.find(e=>e.numbers.includes(48)).text).not.toContain('الكبائر جمع كبيرة');
  const appendix=source.segments.find(e=>e.file===6021);expect(appendix.intro).toBe(true);expect(appendix.volume).toBe(10);
  expect(source.entries.at(-1).text).not.toContain('الإكمال في أسماء الرجال للتبريزي\n');
  expect(source.entries.at(-1).text).toContain('تم تسويد هذا الشرح');
 });
 test('footnote descriptions of books do not become chapter headings',()=>{
  expect(source.segments.filter(e=>e.kind==='heading'&&e.file===5709)).toEqual([]);
  expect(source.entries.some(e=>e.text.includes('سقطت الواو في نسخة'))).toBe(true);
 });
});
