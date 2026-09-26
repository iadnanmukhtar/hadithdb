'use strict';
const {normalize,extract,narratorMatches,exactEvidence,isTextRejection}=require('../bin/recover-mishkat-text-matches');
test('normalizes honorifics without deleting matn negation',()=>{
 expect(normalize('عُمَر رضي الله عنه قال رسول الله صلى الله عليه وسلم لا يؤمن')).toBe('عمر قال رسول الله لا يومن');
});
test('requires all substantive quoted segments, not just the longest one',()=>{
 const h={text:'عن أنس قال: «من كان يؤمن بالله واليوم الآخر فليقل خيرا أو ليصمت» وقال: «لا يؤمن أحدكم حتى يحب لأخيه ما يحب لنفسه»'};
 const c={chain:'عن أنس',body:'من كان يؤمن بالله واليوم الآخر فليقل خيرا أو ليصمت'};
 expect(exactEvidence(h,c)).toBeNull();
});
test('does not accept a changed negation or a different narrator',()=>{
 const h={text:'عن أنس قال: «لا يؤمن أحدكم حتى يحب لأخيه ما يحب لنفسه»'};
 expect(exactEvidence(h,{chain:'عن أنس',body:'يؤمن أحدكم حتى يحب لأخيه ما يحب لنفسه'})).toBeNull();
 expect(exactEvidence(h,{chain:'عن عمر',body:'لا يؤمن أحدكم حتى يحب لأخيه ما يحب لنفسه'})).toBeNull();
 expect(exactEvidence(h,{chain:'عن أنس',body:'لا يؤمن أحدكم حتى يحب لأخيه ما يحب لنفسه'})).not.toBeNull();
});
test('supports Abu grammatical forms and unquoted complete passages',()=>{
 expect(narratorMatches('ابي هريره','حدثنا ابو هريره')).toBe(true);
 const h={text:'عن أنس قال: كان النبي صلى الله عليه وسلم إذا أراد الحاجة لم يرفع ثوبه حتى يدنو من الأرض. رواه أبو داود'};
 expect(extract(h).method).toBe('unquoted-passage-exact');
 expect(exactEvidence(h,{chain:'عن أنس',body:'كان النبي ﷺ إذا أراد الحاجة لم يرفع ثوبه حتى يدنو من الأرض'})).not.toBeNull();
});
test('limits recovery to original text-threshold rejections',()=>{
 const h={numbers:[10],sources:['abudawud'],links:[],review:[{candidates:[{hits:7,recall:.83,score:.41}]}]};
 expect(isTextRejection(h)).toBe(true);
 expect(isTextRejection({...h,sources:[]})).toBe(false);
 expect(isTextRejection({...h,numbers:[10,11]})).toBe(false);
 expect(isTextRejection({...h,review:[{candidates:[{hits:12,recall:.9,score:.8}]}]})).toBe(false);
});
