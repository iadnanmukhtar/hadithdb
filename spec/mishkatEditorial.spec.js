'use strict';
const fs=require('fs'),{separateReviewedEditorial:separate,reviewed,sha}=require('../bin/utils/mishkat-editorial');
const {parse,norm}=require('../bin/import-mishkat-epub');
test('reviewed editorial boundaries are exact, conserve their source, and are idempotent',()=>{
 const baseline=JSON.parse(fs.readFileSync('temp/mishkat-import-review.json'));
 for(const d of reviewed){const entry=baseline.entries.find(h=>h.number===d.number);if(sha(entry.text)===d.afterTextSha256)continue;
 const h=separate(entry);expect(sha(h.text)).toBe(d.afterTextSha256);expect(h.footnote).toBe([entry.footnote,d.note].filter(Boolean).join('\n\n'));expect(separate(h)).toEqual(h);
 for(const r of d.ranges)expect(entry.text.slice(r.start,r.end).trim()).toBe(r.text);
 expect(()=>separate({...entry,text:entry.text+' changed'})).toThrow('source changed');}
});
test('genuine variants following a grading note remain in the hadith body',()=>{
 const entries=parse().entries;
 const h=entries.find(h=>h.number===801);expect(h.footnote).toContain('هَذَا حَدِيثٌ حَسَنٌ صَحِيحٌ');expect(h.text).toContain('ثُمَّ رَكَعَ');expect(h.text).toContain('وَفِي رِوَايَةٍ');
 const c=entries.find(h=>h.number===2442);expect(c.text).toContain('اللَّهُمَّ إِنِّي أَعُوذُ بِكَ');expect(c.footnote).not.toContain('اللَّهُمَّ إِنِّي أَعُوذُ بِكَ');
});
test('narrator speech and standalone numbered cross-references are not deleted',()=>{
 const entries=parse().entries;expect(norm(entries.find(h=>h.number===101).text)).toContain('اقول');expect(norm(entries.find(h=>h.number===5575).text)).toContain('وذكر حديث الشفاعه');expect(norm(entries.find(h=>h.number===5032).text)).toContain('حديث جابر');
});
