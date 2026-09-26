'use strict';
const {parse,sources,match,separateEditorial}=require('../bin/import-mishkat-epub');
const fs=require('fs');
describe('Mishkat import source boundaries',()=>{
 test('attributes only to cited collections and excludes other works by the same author',()=>{
 expect(sources('متفق عليه')).toEqual(['bukhari','muslim']);
 expect(sources('رواه البيهقي في شعب الإيمان')).toEqual(['shuab']);
 expect(sources('رواه البيهقي في السنن')).toEqual(['bayhaqi']);
 expect(sources('رواه البخاري في الأدب المفرد')).toEqual([]);
 expect(sources('رواه أحمد في الزهد')).toEqual([]);
 expect(sources('رواه مسلم')).toEqual(['muslim']);
 });
 test('does not match a shared matn to a conflicting named narrator',()=>{
 const text='عن أنس قال قال رسول الله إنما الأعمال بالنيات وإنما لكل امرئ ما نوى فمن كانت هجرته إلى الله ورسوله فهجرته إلى الله ورسوله رواه مسلم';
 const source={sha256:'x',headings:[],missing:[],entries:[{number:1,numbers:[1],text}]};
 const corpus=[{id:1,bookId:2,num:'1',chain:'عن عمر قال',body:'قال رسول الله إنما الأعمال بالنيات وإنما لكل امرئ ما نوى فمن كانت هجرته إلى الله ورسوله فهجرته إلى الله ورسوله',text:''}];
 expect(match(source,corpus,[{id:2,alias:'muslim'}]).entries[0].links).toEqual([]);
 });
 test('never searches outside the explicitly cited collection',()=>{
 const body='عن أنس قال من حسن إسلام المرء تركه ما لا يعنيه ومن كان يؤمن بالله واليوم الآخر فليقل خيرا أو ليصمت';
 const source={sha256:'x',headings:[],missing:[],entries:[{number:1,numbers:[1],text:body+' رواه أبو داود'}]};
 const report=match(source,[{id:1,bookId:1,num:'1',chain:'',body,text:body}],[{id:1,alias:'bukhari'}]);
 expect(report.entries[0].sources).toEqual(['abudawud']);
 expect(report.entries[0].links).toEqual([]);
 });
 const available=fs.existsSync('temp/مشكاة المصابيح.epub');
 (available?test:test.skip)('accounts for every printed hadith number and retains the non-hadith appendix',()=>{
 const p=parse();expect(p.entries).toHaveLength(6283);expect(p.missing).toEqual([]);
 const h28=p.entries.find(h=>h.number===28);
 expect(h28.text).toContain('الْإِسْلَامَ يَهْدِمُ');
 expect(h28.text).not.toContain('وَالْحَدِيثَانِ');
 expect(h28.footnote).toContain('وَالْحَدِيثَانِ الْمَرْوِيَّانِ');
 expect(h28.footnote).toContain('الْكِبْرِيَاء رِدَائي');
 expect(separateEditorial(h28)).toEqual(h28);
 const extraction=require('../bin/recover-mishkat-narrators').extract({...h28,sources:[]},p.entries);
 expect(extraction.segments).toHaveLength(1);
 expect(extraction.segments.join(' ')).not.toContain('اغني الشركاء');
 const numbers=p.entries.flatMap(h=>h.numbers);expect(numbers).toHaveLength(6294);expect(new Set(numbers).size).toBe(6294);
 expect(p.headings.filter(h=>h.level===1)).toHaveLength(30);
 expect(p.headings.find(h=>h.key==='C1').intro).toContain('فُصُولٍ ثَلَاثَةٍ');
 expect(p.headings.find(h=>h.key==='C1146').intro).toContain('45 -');
 expect(p.entries.find(h=>h.number===4316).numbers).toEqual([4316,4317,4318,4319]);
 expect(new Set(p.headings.map(h=>[h.level,h.h1,h.h2,h.h3].join(':'))).size).toBe(p.headings.length);
 expect(p.headings.find(h=>h.key==='embedded-funeral-prayer').h2).toBe(5);
 expect(p.entries.find(h=>h.number===1645).text).not.toContain('الْمَشْي بالجنازة');
 const positions=new Map(p.headings.map((h,i)=>[h.key,i]));
 expect(p.entries.every((h,i)=>!i||positions.get(h.headingKey)>=positions.get(p.entries[i-1].headingKey))).toBe(true);
 });
});
