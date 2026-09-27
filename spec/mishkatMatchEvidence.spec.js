const Match=require('../bin/utils/mishkat-match-evidence');
test('fixes the split qala that contaminated Mishkat 5597 narrator extraction',()=>{
 const entries=Match.prepareEntries([{number:5597,text:'وعن المغيرة بن شعبة قا ل: قال رسول الله ﷺ شعار المؤمنين يوم القيامة على الصراط رب سلم سلم " . رواه الترمذي',sources:['tirmidhi']}]);
 const e=Match.extract(entries[0],entries);expect(e.narrator).toBe('المغيره بن شعبه');
 const evidence=Match.evidence(e,{chain:'عن المغيرة بن شعبة قال',body:'قال رسول الله ﷺ شعار المؤمن على الصراط رب سلم سلم'});
 expect(evidence.narrator).toBe(true);expect(evidence.coverage).toBe(1);
});
test('does not approve an opposite-polarity short variant',()=>{
 expect(Match.segmentEvidence('لا يقبل الله صلاة احدكم اذا احدث حتى يتوضا','يقبل الله صلاة احدكم اذا احدث حتى يتوضا',true)).toBeNull();
});
test('accepts spacing variation across chain and body',()=>{
 const e=Match.evidence({narrator:'ابي هريره',segments:['قال الله يوذيني ابن ادم يسب الدهر وانا الدهر بيدي الامر اقلب الليل والنهار']},{chain:'عن ابي هريرة قال قال الله',body:'يؤذيني ابن آدم يسب الدهر وأنا الدهر بيدي الأمر أقلب الليل والنهار'});expect(e.coverage).toBe(1);
});
test('keeps the short rain prayer that distinguishes Mishkat 1520 from a generic supplication',()=>{
 const entries=Match.prepareEntries([{number:1520,text:'وعن عائشة قالت: كان النبي إذا أبصر السحاب قال: «اللهم إني أعوذ بك من شر ما فيه» فإن مطرت قال: «اللهم سقيا نافعا». رواه أبو داود',sources:['abudawud']}]);
 const e=Match.extract(entries[0],entries);expect(e.segments).toContain('اللهم سقيا نافعا');
 expect(Match.evidence(e,{chain:'عن عائشة',body:'اللهم إني أعوذ بك من شر ما عملت ومن شر ما لم أعمل'}).coverage).toBeLessThan(1);
});
test('excludes the terminal muttafaq source label from Mishkat 4884 matching',()=>{
 const entries=Match.prepareEntries([{number:4884,text:'[1] (متفق عليه) عن أنس قال: إن كان النبي ﷺ ليخالطنا حتى يقول لأخ لي صغير: «يا أبا عمير ما فعل النغير؟» كان له نغير يلعب به فمات. متفق عليه',sources:['bukhari','muslim']}]);
 const e=Match.extract(entries[0],entries);expect(e.segments.join(' ')).not.toContain('متفق عليه');
 const evidence=Match.evidence(e,{chain:'عن أنس بن مالك يقول',body:'إن كان النبي ﷺ ليخالطنا حتى يقول لأخ لي صغير يا أبا عمير ما فعل النغير'});expect(evidence.narrator).toBe(true);expect(evidence.coverage).toBe(1);
});
test('matches the primary narration separately from an explicitly introduced Muslim variant',()=>{
 const entries=Match.prepareEntries([{number:86,text:'عن أبي هريرة عن النبي ﷺ: «إن الله كتب على ابن آدم حظه من الزنا أدرك ذلك لا محالة فزنا العين النظر وزنا اللسان المنطق» وفي رواية لمسلم قال: «والأذنان زناهما الاستماع واليد زناها البطش»'}]);
 const e=Match.mainWording(entries[0],entries);expect(e.boundary).toBe(true);expect(e.segments.join(' ')).not.toContain('البطش');expect(e.segments.join(' ')).toContain('فزنا العين النظر');expect(entries[0].text).toContain('البطش');
});
test('retains the original vocalized variant for alias footnotes',()=>{
 const entries=[{number:1,text:'عن أنس قال: «لا يؤمن أحدكم حتى يحب لأخيه ما يحب لنفسه» وَفِي رِوَايَةٍ: «لِجَارِهِ»'}];
 expect(Match.mainWording(entries[0],entries).excludedText).toBe('وَفِي رِوَايَةٍ: «لِجَارِهِ»');
});
test('does not split narration at faqila',()=>{
 const entries=[{number:1,text:'عن أنس قال: قال النبي ﷺ عرضت علي الأمم فقيل: هؤلاء أمتك يدخلون الجنة'}];
 expect(Match.mainWording(entries[0],entries).boundary).toBe(false);
});
test('allows a short same-narrator wording variant without dropping negation',()=>{
 expect(Match.segmentEvidence('من مات وعليه صوم صام عنه وليه','من مات وعليه صيام صام عنه وليه',true)).not.toBeNull();
 expect(Match.segmentEvidence('لا صلاه لمن لم يقرا بفاتحه الكتاب','صلاه لمن لم يقرا بفاتحه الكتاب',true)).toBeNull();
});
test('recognizes وفى and rebuilds split segments from the original main wording',()=>{
 const entries=[{number:474,text:'عن أبي هريرة قال: «لا يبولن أحدكم في الماء الدائم الذي لا يجري ثم يغتسل فيه» وَفِى رِوَايَةٍ لِمُسْلِمٍ: «لا يغتسل أحدكم في الماء الدائم وهو جنب»',splitNarrator:'ابي هريره',splitSegments:['لا يبولن أحدكم في الماء الدائم','لا يغتسل أحدكم في الماء الدائم وهو جنب']}];
 const e=Match.mainWording(entries[0],entries);expect(e.boundary).toBe(true);expect(e.segments.join(' ')).not.toContain('جنب');expect(e.excludedText).toContain('وَفِى رِوَايَةٍ');
});
test('keeps an entry that itself starts with a variant introduction',()=>{
 const entries=[{number:2716,text:'[2] (متفق عليه) وفي رواية لأبي هريرة: «لا يعضد شجرها ولا يلتقط ساقطتها إلا منشد»'}];
 const e=Match.mainWording(entries[0],entries);expect(e.boundary).toBe(false);expect(e.segments.join(' ')).toContain('لا يعضد شجرها');
});
test('scores Mishkat 3660 on Abu Musa statement without its reporting clause',()=>{
 const entries=[{number:3660,text:'[27] (لم تتمّ دراسته) وَعَنْ أَبِي مُوسَى أَنَّهُ كَانَ يَقُولُ: مَا أُبالي شرِبتُ الخمرَ أَو عبدْتُ هذهِ السَّارِيةَ دونَ اللَّهِ. رَوَاهُ النَّسَائِيّ',sources:['nasai']}];
 const e=Match.extract(entries[0],entries);
 expect(e.segments).toEqual(['ما ابالي شربت الخمر او عبدت هذه الساريه دون الله']);
 const result=Match.evidence(e,{chain:'عن أبي بردة بن أبي موسى عن أبيه أنه كان يقول',body:'ما أبالي شربت الخمر أو عبدت هذه السارية من دون الله'});
 expect(result.narrator).toBe(true);expect(result.coverage).toBe(1);expect(result.score).toBeGreaterThanOrEqual(.9);
});
test('accepts sparse transcription errors and Abu Masud without his nisba',()=>{
 const e={narrator:'ابي مسعود الانصاري',segments:['استووا ولا تختلفوا فتختلف قلوبكم ليليني منكم اولوا الاحلام والنهي ثم الذين يلونهم ثم الذين يلونهم']};
 const result=Match.evidence(e,{chain:'عن أبي مسعود قال',body:'استووا ولا تختلفوا فتختلف قلوبكم ليلني منكم أولو الأحلام والنهى ثم الذين يلونهم ثم الذين يلونهم'});
 expect(result.narrator).toBe(true);expect(result.score).toBeGreaterThan(.9);
});
test('resolves citation-only entries recursively while retaining their narrator',()=>{
 const entries=[{number:3367,headingKey:'a',text:'عن عبد الله بن عمر قال: «اعفوا عنه كل يوم سبعين مرة». رواه أبو داود'}, {number:3368,headingKey:'a',text:'ورواه الترمذي عن عبد الله بن عمرو'}, {number:3369,headingKey:'a',text:'ورواه أحمد'}];
 const result=Match.contextualWording(entries[1],entries);expect(result.segments).toEqual(['اعفوا عنه كل يوم سبعين مره']);expect(result.narrator).toBe('عبد الله بن عمرو');expect(result.contextNumbers).toEqual([3367]);
 expect(Match.contextualWording(entries[2],entries).contextNumbers).toEqual([3368,3367]);
 entries[1].headingKey='b';expect(Match.contextualWording(entries[1],entries).segments).toEqual([]);
});
test('does not treat explicit omission or variant instructions as bare references',()=>{
 expect(Match.isReferenceOnly({text:'ورواه النسائي عن بسرة إلا أنه لم يذكر «ليس بينه بينها شيء»'})).toBe(false);
 expect(Match.segmentEvidence('ما يقبل الله صلاة احدكم اذا احدث حتى يتوضا بالماء الطاهر','من يقبل الله صلاة احدكم اذا احدث حتى يتوضا بالماء الطاهر',true)?.method).not.toBe('sparse-transcription-errors');
});
test('keeps Arabic names and book titles out of the editorial-clause detector',()=>{
 expect(Match.isReferenceOnly({text:'ورواه أبو داود والدارمي عن ناجية الأسلمي'})).toBe(true);
 expect(Match.isReferenceOnly({text:'ورواه البيهقي في شعب الإيمان عن أبي هريرة'})).toBe(true);
 expect(Match.isReferenceOnly({text:'والبيهقي في «شعب الإيمان» عن سعد بن أبي وقاص'})).toBe(true);
});
test('uses the new reference book rather than inherited source metadata',()=>{
 const {sourceScope}=require('../bin/recover-mishkat-context');
 const books=[{alias:'tirmidhi'},{alias:'ibnmajah'}];
 const scope=sourceScope({text:'ورواه ابن ماجه عن ابن عمر',sources:['tirmidhi','ibnmajah'],editorialCitationKeys:['tirmidhi']},books);
 expect(scope.mode).toBe('cited-books');expect(scope.aliases).toEqual(['ibnmajah']);
});
test('matches Ibn Umm Maktum abbreviation and ranks the complete Mishkat 1078 wording',()=>{
 const entries=[{number:1078,text:'[27] (صحيح) وعن عبد الله بن أم مكتوم قال: يا رسول الله إن المدينة كثيرة الهوام والسباع وأنا ضرير البصر فهل تجد لي من رخصة؟ قال: «هل تسمع حي على الصلاة حي على الفلاح؟» قال: نعم. قال: «فحيهلا». ولم يرخص له. رواه أبو داود والنسائي'}];
 const source=Match.rankingText(entries[0],entries);expect(source).toContain('فحيهلا');expect(source).toContain('كثيره الهوام');expect(source).not.toContain('رواه');
 const e=Match.extract(entries[0],entries);expect(Match.evidence(e,{chain:'عن ابن أم مكتوم',body:'هل تسمع حي على الصلاة حي على الفلاح'}).narrator).toBe(true);
 const nasai={alias:'nasai',ref:'nasai:851',wording:Match.wordingSimilarity(source,'يا رسول الله إن المدينة كثيرة الهوام والسباع قال هل تسمع حي على الصلاة حي على الفلاح قال نعم قال فحيهلا ولم يرخص له')};
 const abu={alias:'abudawud',ref:'abudawud:553',wording:Match.wordingSimilarity(source,'قال يا رسول الله إن المدينة كثيرة الهوام والسباع فقال النبي أتسمع حي على الصلاة حي على الفلاح فحيهلا')};
 expect(Match.compareCandidates(nasai,abu,[{alias:'abudawud',ordinal:102},{alias:'nasai',ordinal:103}])).toBeLessThan(0);
});
test('breaks equal wording scores by book ordinal then numeric hadith number',()=>{
 const books=[{alias:'nasai',ordinal:105},{alias:'abudawud',ordinal:103}];
 const a={alias:'nasai',ref:'nasai:1',wording:{score:.95}},b={alias:'abudawud',ref:'abudawud:999',wording:{score:.95}};
 expect(Match.compareCandidates(a,b,books)).toBeGreaterThan(0);
 expect(Match.compareCandidates({...b,ref:'abudawud:10'},{...b,ref:'abudawud:9'},books)).toBeGreaterThan(0);
});
test('does not strip a malformed narrator containing the substantive narration',()=>{
 const entries=[{number:5144,text:'وعن أبي ثعلبة في قوله تعالى: عليكم أنفسكم لا يضركم من ضل إذا اهتديتم فقال: أما والله لقد سألت عنها رسول الله فقال: «ائتمروا بالمعروف وتناهوا عن المنكر» قال: «أجر خمسين منكم». رواه الترمذي وابن ماجه'}];
 expect(Match.rankingText(entries[0],entries)).toContain('ايتمروا بالمعروف');
});
test('separates Mishkat 4630 compiler lookup comment and keeps its positive attribution',()=>{
 const h={number:4630,text:'[3] و (لم تتم دراسته) عن أبي هريرة قال: قال رسول الله: " للمؤمن على المؤمن ست خصال: يعوده إذا مرض ويشهده إذا مات ويجيبه إذا دعاه ويسلم عليه إذا لقيه ويشمته إذا عطس وينصح له إذا غاب أو شهد «لم أجده» في الصحيحين «ولا في كتاب الحميدي ولكن ذكره صاحب» الجامع " برواية النسائي'};
 const entries=Match.prepareEntries([h]),e=Match.mainWording(entries[0],entries);
 expect(e.narrator).toContain('هريره');expect(e.segments.join(' ')).not.toContain('لم اجده');
 expect(Match.wordingSimilarity(Match.rankingText(entries[0],entries),'للمؤمن على المؤمن ست خصال يعوده إذا مرض ويشهده إذا مات ويجيبه إذا دعاه ويسلم عليه إذا لقيه ويشمته إذا عطس وينصح له إذا غاب أو شهد').score).toBe(1);
 expect(require('../bin/recover-mishkat-context').sourceScope(h,[{alias:'nasai'},{alias:'bukhari'},{alias:'muslim'}]).aliases).toEqual(['nasai']);
});
test('flags a short explanatory gloss for review without altering source evidence',()=>{
 const original={narrator:'ابي هريره',segments:['حفظت من رسول الله وعاءين فاما احدهما فبثثته فيكم واما الاخر فلو بثثته قطع هذا البلعوم يعني مجرى الطعام']};
 const variant=Match.glossReviewVariant(original);
 expect(variant.requiresReview).toBe(true);expect(variant.glosses[0].text).toBe('يعني مجري الطعام');
 expect(original.segments[0]).toContain('يعني');
 expect(Match.evidence(variant,{chain:'عن أبي هريرة',body:'حفظت من رسول الله وعاءين فاما احدهما فبثثته واما الاخر فلو بثثته قطع هذا البلعوم'}).score).toBeGreaterThan(.9);
 const embedded={segments:['نهانا يعني رسول الله أن نستقبل القبلة لغائط أو بول أو أن نستنجي باليمين']};
 expect(Match.glossReviewVariant(embedded).segments).toEqual(embedded.segments);
});
test('excludes Tirmidhi compiler cross-references from matching and narrator evidence',()=>{
 const c={alias:'tirmidhi',chain:'عن علقمة عن عبد الله قال',body:'نام رسول الله على حصير فقال ما لي وما للدنيا ما أنا في الدنيا إلا كراكب استظل تحت شجرة ثم راح وتركها قال وفي الباب عن عمر وابن عباس'};
 expect(Match.sourceMatn(c)).not.toContain('وفي الباب');
 expect(Match.evidence({narrator:'ابن مسعود',segments:['كراكب استظل تحت شجرة ثم راح وتركها']},c).narrator).toBe(true);
 expect(Match.evidence({narrator:'ابن عباس',segments:['كراكب استظل تحت شجرة ثم راح وتركها']},c).narrator).toBe(false);
 expect(Match.evidence({narrator:'ابن مسعود',segments:['كراكب استظل تحت شجرة ثم راح وتركها']},{...c,chain:'عن عبد الله قال'}).narrator).toBe(false);
 expect(Match.sourceMatn({...c,body:'لا تزال طائفة من أمتي قال أبو عيسى هذا حديث حسن صحيح'})).toBe('لا تزال طايفه من امتي');
 expect(Match.sourceMatn({...c,body:'الحسن أشبه برسول الله هذا حديث حسن غريب'})).toBe('الحسن اشبه برسول الله');
 expect(c.body).toContain('وفي الباب');
});
