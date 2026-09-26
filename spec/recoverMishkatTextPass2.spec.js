'use strict';
const {canonical,sourceExtract,exactEvidence}=require('../bin/recover-mishkat-text-pass2');
const h={number:99999,sources:['abudawud'],text:'عن أنس قال: «لا يؤمن أحدكم حتى يحب لأخيه ما يحب لنفسه من الخير والبر والصلاح»'};
const c={id:99999,alias:'abudawud',chain:'عن أنس',body:'لا يؤمن أحدكم حتى يحب لأخيه ما يحب لنفسه من الخير والبر والصلاح'};
test('honorific normalization preserves negation and content',()=>{
 expect(canonical('إن الله تعالى لا يقبل')).toBe('ان الله لا يقبل');
 expect(canonical('الأنبياء النبيين النبي')).toBe('الانبياء النبيين رسول الله');
 expect(exactEvidence(h,c)).not.toBeNull();
 expect(exactEvidence(h,{...c,body:c.body.replace('لا ','')})).toBeNull();
 expect(exactEvidence(h,{...c,alias:'muslim'})).toBeNull();
 expect(exactEvidence(h,{...c,chain:'عن عمر'})).toBeNull();
});
test('explicit collection variants remain source-specific',()=>{
 const e={sources:['bukhari','muslim'],text:'عن أنس قال: «هذا النص الأول كاملا» هذا لفظ البخاري ولمسلم قال: «هذا النص الثاني مختلف»'};
 expect(sourceExtract(e,'bukhari').segments).toEqual(['هذا النص الاول كاملا']);
 expect(sourceExtract(e,'muslim').segments).toEqual(['هذا النص الثاني مختلف']);
 expect(sourceExtract(e,'muslim').narrator).toBe('انس');
});
test('a mismatching second quoted segment is not ignored',()=>{
 expect(exactEvidence({...h,text:h.text+' وقال: «عبارة أخرى مختلفة»'},c)).toBeNull();
});
test('review approval is bound to the full source and target hashes',()=>{
 const r=require('../docs/imports/mishkat-text-pass2-reviewed.json')[0];
 expect(exactEvidence({...h,number:r.number},{...c,id:r.id,alias:r.ref.split(':')[0],num:r.ref.split(':')[1]})).toBeNull();
});

test('accepts the inspected transcription pair but rejects changed content or citation',()=>{
 const source={"number":23,"text":"[22] (مُتَّفَقٌ عَلَيْهِ) وَعَنْ أَبِي مُوسَى الْأَشْعَرِيِّ قَالَ: قَالَ رَسُولُ اللَّهِ صَلَّى اللَّهُ عَلَيْهِ وَسَلَّمَ: «مَا أَحَدٌ أَصْبَرُ عَلَى أَذًى يَسْمَعُهُ مِنَ اللَّهِ يَدْعُونَ لَهُ الْوَلَدَ ثُمَّ يُعَافِيهِمْ وَيَرْزُقُهُمْ»","sources":["bukhari","muslim"]};
 const target={"id":102638,"bookId":1,"num":"7378","chain":"حَدَّثَنَا عَبْدَانُ عَنْ أَبِي حَمْزَةَ عَنِ الأَعْمَشِ عَنْ سَعِيدِ بْنِ جُبَيْرٍ عَنْ أَبِي عَبْدِ الرَّحْمَنِ السُّلَمِيِّ عَنْ أَبِي مُوسَى الأَشْعَرِيِّ قَالَ قَالَ النَّبِيُّ ﷺ","body":"مَا أَحَدٌ أَصْبَرُ عَلَى أَذًى سَمِعَهُ مِنَ اللَّهِ يَدَّعُونَ لَهُ الْوَلَدَ ثُمَّ يُعَافِيهِمْ وَيَرْزُقُهُمْ","text":"حَدَّثَنَا عَبْدَانُ عَنْ أَبِي حَمْزَةَ عَنِ الأَعْمَشِ عَنْ سَعِيدِ بْنِ جُبَيْرٍ عَنْ أَبِي عَبْدِ الرَّحْمَنِ السُّلَمِيِّ عَنْ أَبِي مُوسَى الأَشْعَرِيِّ قَالَ قَالَ النَّبِيُّ ﷺ مَا أَحَدٌ أَصْبَرُ عَلَى أَذًى سَمِعَهُ مِنَ اللَّهِ يَدَّعُونَ لَهُ الْوَلَدَ ثُمَّ يُعَافِيهِمْ وَيَرْزُقُهُمْ","alias":"bukhari"};
 expect(exactEvidence(source,target).method).toBe('individually-reviewed-wording-variant');
 expect(exactEvidence({...source,text:source.text+' changed'},target)).toBeNull();
 expect(exactEvidence(source,{...target,body:'changed',text:'changed'})).toBeNull();
 expect(exactEvidence({...source,sources:['abudawud']},target)).toBeNull();
});
