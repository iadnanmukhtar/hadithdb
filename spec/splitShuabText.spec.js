'use strict';
const fs=require('fs');
const {split}=require('../bin/utils/split-shuab-text');
const strip=s=>(s||'').replace(/[\u064b-\u065f\u0670\u06d6-\u06edـ]/g,'');
const source='temp/shuab/split-source.json';
(fs.existsSync(source)?describe:describe.skip)('Shuab reviewed source splits',()=>{
 let rows,patches;
 beforeAll(()=>{rows=JSON.parse(fs.readFileSync(source));patches=rows.map(split);});
 const byNum=(rows,num)=>rows.find(r=>r.num===num);
 test('preserves every character, existing footnotes, and report identity',()=>{
  expect(patches).toHaveLength(10725);
  patches.forEach((p,i)=>{
   const r=rows[i];
   expect(p.id).toBe(r.id);expect(p.num).toBe(r.num);
   const compact=s=>s.replace(/\s/g,'');
   expect(compact([p.chain,p.body,p.footnote].filter(Boolean).join(' '))).toBe(compact([r.body,r.footnote].filter(Boolean).join(' ')));
   expect(p.body.trim()).not.toBe('');
   expect(split(p).body).toBe(p.body);
  });
 });
 test('keeps Ibn Umar narrative before its internal transmission in matn',()=>{
  const p=byNum(patches,'19');
  expect(strip(p.body)).toMatch(/^قالا: لقينا عبد الله/);
  expect(strip(p.chain)).not.toContain('لقينا');
  expect(strip(p.footnote)).toMatch(/^رواه مسلم/);
 });
 test('keeps verse and interpretation together and moves short-report references',()=>{
  expect(byNum(patches,'111').chain).not.toContain('{');
  expect(byNum(patches,'111').body).toContain('{');
  for(const n of ['252','299','316','2517','3401'])expect(strip(byNum(patches,n).footnote)).toMatch(/^رواه/);
 });
 test('handles unmatched source quotes and moves farawahu per the requested convention',()=>{
  for(const n of ['265','309','5473'])expect(strip(byNum(patches,n).footnote)).toMatch(/^رواه/);
  expect(strip(byNum(patches,'4830').body)).not.toContain('فرواه');
  expect(strip(byNum(patches,'4830').footnote)).toMatch(/^فرواه من حديث الروم/);
 });
 test('leaves source-only chains intact without inventing a matn',()=>{
  for(const n of ['5594','10576'])expect(byNum(patches,n).body).toBe(byNum(rows,n).body);
 });
});

describe('Shuab splitter boundaries',()=>{
 test('preserves narrative speech before a later embedded transmission',()=>{
  const p=split({id:1,num:'example',chain:null,body:'أَخْبَرَنَا زيد، عَنْ عمرو قَالَ: لقينا رجلا فقال: أخبرني أبي أنه سمع الخبر. رَوَاهُ مُسْلِمٌ في الصحيح',footnote:'حاشية موجودة'});
  expect(p.chain).toBe('أَخْبَرَنَا زيد، عَنْ عمرو');
  expect(p.body).toBe('قَالَ: لقينا رجلا فقال: أخبرني أبي أنه سمع الخبر.');
  expect(p.footnote).toBe('رَوَاهُ مُسْلِمٌ في الصحيح\n\nحاشية موجودة');
 });
 test('moves farawahu even inside a quoted narrative',()=>{
  const p=split({id:2,num:'example2',chain:null,body:'أخبرنا زيد، عن عمرو قال: " وكان الرجل يقول فرواه من حديث الروم وفارس "',footnote:null});
  expect(p.footnote).toBe('فرواه من حديث الروم وفارس "');
  expect(p.body).not.toContain('فرواه');
 });
});
