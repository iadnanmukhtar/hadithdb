'use strict';
const {policy,extract,evidence}=require('../bin/recover-mishkat-priority');
const books=[{id:2,alias:'muslim',ordinal:102,virtual:0},{id:1,alias:'bukhari',ordinal:101,virtual:0},{id:3,alias:'outside',ordinal:200,virtual:0},{id:4,alias:'abudawud',ordinal:103,virtual:0}];
const entry=(text,sources=[])=>({number:99999,headingKey:'C1',text,sources,links:[],numbers:[99999]});
test('unreferenced reports use ascending ordinal 100 through 199 only',()=>{
 const p=policy(entry('عن أنس قال: «نص الحديث هنا»'),books);
 expect(p.mode).toBe('ordinal-fallback');expect(p.aliases).toEqual(['bukhari','muslim','abudawud']);
});
test('known references never broaden to fallback books',()=>{
 expect(policy(entry('رواه مسلم',['muslim']),books).aliases).toEqual(['muslim']);
 expect(policy(entry('رواه في شرح السنة'),books).mode).toBe('cited-books');
 expect(policy(entry('رواه في شرح السنة'),books).aliases).toEqual([]);
 expect(policy(entry('رواه أبو داود عن أنس بن مالك'),books).aliases).toEqual(['abudawud']);
});
test('recognizes contextual narrator forms and unclosed quotations',()=>{
 const h=entry('ورواه أبو هريرة مع اختلاف وفيه: "وإذا رأيت الحفاة العراة ملوك الأرض');
 const e=extract(h,[h]);expect(e.narrator).toBe('ابو هريره');expect(e.segments).toEqual(['واذا رايت الحفاه العراه ملوك الارض']);
 const v=entry('وفي رواية ابن عباس: «ولا يقتل حين يقتل وهو مؤمن»');
 expect(extract(v,[v]).narrator).toBe('ابن عباس');
});
test('repairs a closing-only quotation for a short standalone report',()=>{
 const h=entry('عن ابن مسعود قال: قال رسول الله صلى الله عليه وسلم: الوائدة والموؤدة في النار ". رواه أبو داود',['abudawud']);
 expect(extract(h,[h]).segments).toEqual(['الوايده والمووده في النار']);
});
test('matching stays inside a known source and requires narrator identity',()=>{
 const h=entry('عن أنس قال: «لا يؤمن أحدكم حتى يحب لأخيه ما يحب لنفسه» رواه مسلم',['muslim']);
 const c={alias:'muslim',chain:'عن أنس قال',body:'لا يؤمن أحدكم حتى يحب لأخيه ما يحب لنفسه'};
 expect(evidence(h,c,[h],books)).not.toBeNull();
 expect(evidence(h,{...c,alias:'bukhari'},[h],books)).toBeNull();
 expect(evidence(h,{...c,chain:'عن عمر قال'},[h],books)).toBeNull();
});
test('a short Quran quotation retains its surrounding hadith narrative',()=>{
 const h=entry('وعن أنس: أن النبي صلى الله عليه وسلم وأبا بكر وعمر رضي الله عنهما كانوا يفتتحون الصلاة ب «الحمد لله رب العالمين» رواه مسلم',['muslim']);
 const e=extract(h,[h]);expect(e.segments.join(' ')).toContain('يفتتحون الصلاه');
 expect(evidence(h,{alias:'muslim',num:'ir0',chain:'عن أنس',body:'الحمد لله رب العالمين'},[h],books)).toBeNull();
});
