'use strict';
const {parseReference,words,prepare,identify,evidence}=require('../bin/utils/identify-abuamina-hadiths');
const body='من صلى الغداة في جماعة ثم قعد يذكر الله حتى تطلع الشمس ثم صلى ركعتين كانت له كأجر حجة وعمرة';
const post={id:10,url:'https://www.abuaminaelias.com/dailyhadithonline/test/',title:'A title',sources:['Source: Sunan al-Tirmidhi 586'],arabic:'عن أنس قال قال رسول الله صَلَّى اللهُ عَلَيْهِ وَسَلَّمَ '+body,singleReport:true};
const row=prepare({id:20,num:'586',body});
test('normalizes both blessing ligatures and vocalized phrases after stripping marks',()=>{
 expect(words('قال ﷺ من صَلَّى')).toEqual(words('قال صَلَّى اللهُ عَلَيْهِ وَسَلَّمَ من صلى'));
});
test('resolves verified additional collections and preserves volume/page locators',()=>{
 expect(parseReference('Source: Muṣannaf Ibn Abī Shaybah 123')).toMatchObject({alias:'ibnabishaybah',number:'123'});
 expect(parseReference('Source: al-Mu’jam al-Awsaṭ 222')).toMatchObject({alias:'tabarani-awsat',number:'222'});
 expect(parseReference('Source: Ṣaḥīḥ al-Bukhārī 1/20')).toMatchObject({alias:'bukhari',number:null,locator:'1/20'});
 expect(parseReference('Source: al-Sunan al-Kubra 123').alias).toBeNull();
});
test('identifies full Arabic body despite narrator and blessing prefix',()=>{
 expect(identify(post,[row])).toMatchObject({status:'identified',hadithId:20,titleEligibility:'eligible'});
});
test('same number never confirms different text',()=>{
 expect(identify(post,[prepare({id:20,num:'586',body:'نص آخر لا يشبه هذه الرواية'})]).status).toBe('reference-text-mismatch');
});
test('different or alternate numbering and excerpts stay review-only',()=>{
 expect(identify(post,[{...row,num:'999'}])).toMatchObject({status:'review-required',matches:[{numberMatch:'different'}]});
 expect(identify(post,[{...row,num:'999',numActual:'586'}])).toMatchObject({status:'review-required',matches:[{numberMatch:'alternate'}]});
 const long=prepare({id:20,num:'586',body:post.arabic+' '+body+' '+body});
 expect(identify(post,[long]).status).toBe('review-required');
});
test('duplicate confirmed bodies are ambiguous',()=>{
 expect(identify(post,[row,{...row,id:21}]).status).toBe('ambiguous');
});
test('identification is independent of title and revision eligibility',()=>{
 expect(identify(post,[{...row,title_en:'Existing'}])).toMatchObject({status:'identified',titleEligibility:'protected'});
 expect(identify(post,[{...row,arabic_revised:1}])).toMatchObject({status:'identified',titleEligibility:'protected'});
 expect(identify({...post,singleReport:false},[row])).toMatchObject({status:'identified',titleEligibility:'multiple-source-blocks'});
});
test('short generic wording cannot establish identity',()=>{
 expect(identify({...post,arabic:'قال رسول الله'},[prepare({id:20,num:'586',body:'قال رسول الله'})]).status).not.toBe('identified');
});
test('negation is not normalized away',()=>{
 const negated=prepare({id:20,num:'586',body:body.replace('ثم صلى ركعتين','ثم لم يصل ركعتين')});
 expect(evidence(words(post.arabic),negated).method).not.toBe('full-body-contained');
 expect(identify(post,[negated]).status).toBe('review-required');
});
test.each(['أَوْ كَمَا قَالَ','او كما قال','أَو كَما قَالَ'])('ignores reporting phrase %s and identifies Bukhari 4644',phrase=>{
 const text='أَمَرَ اللَّهُ نَبِيَّهُ ﷺ أَنْ يَأْخُذَ الْعَفْوَ مِنْ أَخْلاَقِ النَّاسِ';
 const p={...post,sources:['Source: Sahih al-Bukhari 4644'],arabic:'عن عبد الله بن الزبير قال '+text};
 expect(identify(p,[prepare({id:99979,num:'4644',body:text+' '+phrase})])).toMatchObject({status:'identified',hadithId:99979,titleEligibility:'eligible'});
 expect(words(text+' '+phrase)).toEqual(words(text));
});
test('phrase normalization preserves other substantive wording and short-text guard',()=>{
 expect(words('أو كما قالوا')).toEqual(['او','كما','قالوا']);
 expect(identify({...post,arabic:'قال رسول الله'},[prepare({id:20,num:'586',body:'قال رسول الله أو كما قال'})]).status).not.toBe('identified');
});
test('parses parallel Bukhari/Muslim citations and trailing punctuation',()=>{
 expect(parseReference('Source: Sahih al-Bukhari 5997, Sahih Muslim 2318')).toMatchObject({alias:'bukhari',number:'5997',additionalReferences:[{alias:'muslim',number:'2318'}]});
 expect(parseReference('Source: Sunan Abi Dawud 4765,')).toMatchObject({alias:'abudawud',number:'4765'});
});
test('matches complete short report at cited number while retaining substantive wording',()=>{
 const text='الرجل على دين خليله فلينظر أحدكم من يخالل';
 const p={...post,arabic:'عن عائشة قالت قال رسول الله '+text};
 expect(identify(p,[prepare({id:20,num:'586',body:text})]).status).toBe('identified');
 expect(identify(p,[prepare({id:20,num:'586',body:text.replace('دين','مال')})]).status).not.toBe('identified');
});
test('matches a complete quotation despite different introductory narration formulas',()=>{
 const p={...post,arabic:'عن أنس قال قال رسول الله '+body};
 expect(identify(p,[prepare({id:20,num:'586',body:'كان يقول '+body})])).toMatchObject({status:'identified',matches:[{method:'full-speech-contained'}]});
});
test('does not identify contradicted or small excerpts from a much longer report',()=>{
 const p={...post,arabic:'عن أنس قال قال رسول الله '+body};
 const altered=body.replace('ثم صلى ركعتين','ثم لم يصل ركعتين');
 expect(identify(p,[prepare({id:20,num:'586',body:'كان يقول '+altered})]).status).not.toBe('identified');
 expect(identify(p,[prepare({id:20,num:'586',body:body+' '+body+' '+body})]).status).not.toBe('identified');
});
