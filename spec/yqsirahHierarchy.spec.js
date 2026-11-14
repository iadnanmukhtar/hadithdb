'use strict';
const fs=require('fs');
const {build}=require('../bin/utils/import-yqsirah');
const sourcePath='var/imports/yqsirah/extracted.json';
const corpusTest=fs.existsSync(sourcePath)?test:test.skip;
corpusTest('topical hierarchy covers the transcript once without changing prose, notes, or passage identities',()=>{
 const source=JSON.parse(fs.readFileSync(sourcePath)),topics=require('../data/yqsirah-topics.json');
 const flat=build(source,topics,{flat:true}),plan=build(source,topics);
 expect(plan.entries).toHaveLength(1023);
 expect(plan.chapters).toHaveLength(53);
 expect(plan.entries.filter(e=>e.level===2)).toHaveLength(490);
 expect(plan.entries.filter(e=>e.level===3)).toHaveLength(533);
 for(let i=0;i<plan.entries.length;i++){
  const e=plan.entries[i],before=flat.entries[i];
  for(const key of ['num','h1','body','footnotes','blocks'])expect(e[key]).toEqual(before[key]);
  expect(e.provenance.blocks).toEqual(before.provenance.blocks);
  expect(e.provenance.notes).toEqual(before.provenance.notes);
 }
 for(const chapter of plan.chapters){
  const parents=chapter.sections.filter(e=>e.level===2);
  expect(parents.flatMap(p=>Array.from({length:p.count},(_,i)=>p.start+i))).toEqual(chapter.sections.map(e=>e.num));
  for(const parent of parents){
   const children=chapter.sections.filter(e=>e.h2===parent.h2&&e.level===3);
   expect(children.map(e=>e.h3)).toEqual(children.map((_,i)=>i+1));
   expect(children.every(e=>e.start>parent.start&&e.end<=parent.end)).toBe(true);
  }
 }
 const revelation=plan.chapters[8].sections;
 expect(revelation.filter(e=>e.level===2).map(e=>e.title)).toEqual(['The Beginning of Revelation','After the First Revelation']);
 expect(revelation.filter(e=>e.h2===1).map(e=>e.num)).toEqual([68,69,70,71,72]);
 const bargain=plan.entries[88];
 expect(bargain).toMatchObject({level:2,h1:11,h2:3,start:89,end:92,count:4});
 expect(plan.entries.slice(89,92).map(e=>[e.level,e.h2,e.h3])).toEqual([[3,3,1],[3,3,2],[3,3,3]]);
 expect(plan.entries[92]).toMatchObject({level:2,h2:4,title:'3. Banning of the Recitation of the Quran in Public'});
});
