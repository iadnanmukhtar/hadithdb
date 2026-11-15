'use strict';
const {formatField,undo}=require('../bin/utils/format-yqsirah');
test('keeps long indented list continuations intact at prose transitions',()=>{
 const continuation='    '+('The account continues with details. '.repeat(25))+'And '+('the remaining narrative stays within this list item. '.repeat(15));
 const source='1. First point.\n\n2. Second point.\n\n'+continuation;
 const result=formatField(source,[],{paragraphs:true});
 expect(result.text).toContain(continuation);
 expect(undo(result.text,result.ledger)).toBe(source);
});
test('inventories every grouped Quran citation while keeping singleton offsets stable',()=>{
 const {inventory}=require('../bin/utils/format-yqsirah');
 const body='One [Quran, 21:10]. Two [15:15, 51:52]. Three [see Quran 38:36–38; 27:16 and 27:17].';
 const refs=inventory({entries:[{num:1,body,footnotes:''}]}).filter(r=>r.kind==='quran');
 expect(refs.map(r=>[r.surah,r.from,r.to])).toEqual([[21,10,10],[15,15,15],[51,52,52],[38,36,38],[27,16,16],[27,17,17]]);
 expect(refs[0].offset).toBe(body.indexOf('[Quran'));
 expect(new Set(refs.map(r=>r.offset)).size).toBe(6);
 const variants=inventory({entries:[{num:2,body:'[17:90~93] and [see Quran 7:14 & 15:36] and [e.g., Quran, 8:31, 25:5]',footnotes:''}]}).filter(r=>r.kind==='quran');
 expect(variants.map(r=>[r.surah,r.from,r.to])).toEqual([[17,90,93],[7,14,14],[15,36,36],[8,31,31],[25,5,5]]);
 const descriptive=inventory({entries:[{num:3,body:'[idol mentioned in Quran, 53:20] [lecture time 53:20] [Bukhari 53:20]',footnotes:''}]}).filter(r=>r.kind==='quran');
 expect(descriptive.map(r=>[r.surah,r.from])).toEqual([[53,20]]);
});
test('inventories abbreviated hadith attributions without classifying ordinary Muslim nouns',()=>{
 const {inventory}=require('../bin/utils/format-yqsirah');
 const body='Sahih Bukhari reports. In Bukhari and Muslim. Narrated by Muslim. Imam Muslim says. Musnad Imam Ahmad. A Muslim and Muslim communities. Sahih Muslim.';
 const refs=inventory({entries:[{num:1,body,footnotes:''}]}).filter(r=>r.kind==='hadith-collection-mention');
 expect(refs.map(r=>r.reference)).toEqual(['Sahih Bukhari','Bukhari','Muslim','Muslim','Muslim','Musnad Imam Ahmad','Sahih Muslim']);
 expect(refs[0].offset).toBe(0);expect(refs.at(-1).offset).toBe(body.lastIndexOf('Sahih Muslim'));
 expect(new Set(refs.map(r=>r.offset)).size).toBe(refs.length);
});
test('normalizes honorifics and phrases without deleting repetition, dialogue, or markers',()=>{
 const source='Insha\'Allah[^n1], Aisha RA said, "Again, again." Musa AS. Alhamdulillah. https://example.org/RA\n\n[^n1]: Insha\'Allah means God willing.';
 const result=formatField(source);
 expect(result.text).toContain('in sha Allah[^n1], Aisha ᴿᴬ said, "Again, again." Musa ᴬˢ. al-hamdu lillah. https://example.org/RA');
 expect(undo(result.text,result.ledger)).toBe(source);
 expect(formatField(result.text).ledger).toHaveLength(0);
});
test('refuses condensation disguised as punctuation, spacing or evidence',()=>{
 for(const kind of ['punctuation','spacing','evidence'])expect(()=>formatField('Every substantive example.',[{kind,before:'Every substantive example.',after:'Example.',verification:{hadithdb:'a',independent:'b'}}])).toThrow();
 expect(()=>formatField('Quoted phrase.',[{kind:'evidence',before:'Quoted phrase.',after:'Quoted phrase.\n\nArabic'}])).toThrow(/two verified sources/);
});
test('PDF Arabic repair requires an exact visual transcription and stays reversible',()=>{
 const r=require('../data/yqsirah-formatting-pdf-repairs.json').repairs[0];
 const change={kind:'pdf-repair',repairId:r.id,before:r.before,after:r.after};
 const result=formatField(r.before,[change]);
 expect(result.text).toBe(r.after);
 expect(undo(result.text,result.ledger)).toBe(r.before);
 expect(()=>formatField(r.before,[{...change,repairId:'unverified'}])).toThrow(/visually verified/);
 expect(()=>formatField(r.before,[{...change,after:'Shortened narrative.'}])).toThrow(/page transcription/);
 expect(()=>formatField('Different source',[{...change,before:'Different source'}])).toThrow(/recorded extraction/);
});
test('repairs a visually verified footnote boundary without losing text or markers',()=>{
 const r=require('../data/yqsirah-formatting-pdf-repairs.json').repairs.find(r=>r.kind==='footnote-boundary');
 const change={kind:r.kind,repairId:r.id,before:r.before,after:r.after};
 const result=formatField(r.before,[change]);
 expect(undo(result.text,result.ledger)).toBe(r.before);
 expect(result.text).toContain('[^p343n135]: Du\'a to die in Madinah:');
 expect(result.text).not.toContain('[^p343n135]: Allah');
 expect(()=>formatField(r.before,[{...change,repairId:'unverified'}])).toThrow(/visually verified/);
 expect(()=>formatField(r.before,[{...change,after:r.after.replace('Allah','God')}])).toThrow(/page transcription/);
});
test('keeps evidence separate from both the English quotation and following paragraph',()=>{
 const e=require('../data/yqsirah-formatting.json').passages['1'];
 for(const c of e.body.filter(c=>c.kind==='evidence')){
  expect(c.after.startsWith(c.before+'\n\n> ﴿')).toBe(true);
  expect(c.after.endsWith('\n\n')).toBe(true);
  expect(c.after).not.toMatch(/Sahih|Hasan|Daif/);
 }
});
test('ordinary English emphasis is not styled as Prophetic speech; verified Arabic speech retains its styling',()=>{
 const source='He *personally* replied. *«أَنَا مُحَمَّدٌ»*';
 const result=formatField(source);expect(result.text).toBe('He _personally_ replied. *«أَنَا مُحَمَّدٌ»*');expect(undo(result.text,result.ledger)).toBe(source);
});
test('normalizes known name chains without changing standalone Ibn names or URLs',()=>{
 const source='Abdullah ibn Ubayy; Aisha bint Abi Bakr; Ibn Abbas; https://example.org/Abdullah';
 const result=formatField(source);
 expect(result.text).toBe('Abd Allah b. Ubayy; Aisha bt. Abi Bakr; Ibn Abbas; https://example.org/Abdullah');
 expect(undo(result.text,result.ledger)).toBe(source);
 expect(formatField(result.text).ledger).toHaveLength(0);
});
test('paragraph spacing preserves speech, asides and every non-whitespace character',()=>{
 const lead='word '.repeat(110)+'ends.';
 const tail='And '+ 'more '.repeat(90)+'ends.';
 const source=lead+' '+tail;
 const result=formatField(source,[],{paragraphs:true});
 expect(result.text).toContain('ends.\n\nAnd');
 expect(result.text.replace(/\s/g,'')).toBe(source.replace(/\s/g,''));
 expect(undo(result.text,result.ledger)).toBe(source);
 expect(formatField(result.text,[],{paragraphs:true}).ledger).toHaveLength(0);
 for(const protectedText of ['"'+source+'"','('+source+')','> '+source,'[^note]: '+source,'- '+source]){
  expect(formatField(protectedText,[],{paragraphs:true}).text).toBe(protectedText);
 }
});
test('repairs PDF sentence fragments while keeping roman and letter list labels separate',()=>{
 const source='He undertook a journey no\n\nother person had taken.\n\nExamples\n\ni) First\n\nii) Second\n\na) Third';
 const result=formatField(source,[],{paragraphs:true});
 expect(result.text).toBe('He undertook a journey no other person had taken.\n\nExamples\n\ni) First\n\nii) Second\n\na) Third');
 expect(undo(result.text,result.ledger)).toBe(source);
});
test('existing Quran layout preserves the exact source Arabic and cannot add a grade or prose',()=>{
 const changes=Object.values(require('../data/yqsirah-formatting.json').passages).flatMap(p=>p.body||[]).filter(c=>c.kind==='quran-layout');
 expect(changes.length).toBeGreaterThan(400);
 for(const original of changes){
  const c={...original,sourceOffset:undefined};
  const result=formatField(c.before,[c]);
  expect(undo(result.text,result.ledger)).toBe(c.before);
  expect(result.text).toContain(`﴿${c.before}﴾`);
  expect(()=>formatField(c.before,[{...c,after:c.after+'Sahih'}])).toThrow();
 }
});
test('repeated Quran phrases link to the occurrence explicitly cited by the transcript',()=>{
 const passages=require('../data/yqsirah-formatting.json').passages;
 for(const [num,reference]of [[42,'39:38'],[53,'12:102']]){
  const change=passages[num].body.find(c=>c.referenceCorrection);
  expect(change.url).toBe('https://quran.islamunlocked.com/quran:'+reference);
  expect(change.referenceCorrection.independent).toBe('https://quran.com/'+reference.replace(':','/'));
 }
 const range=passages[62].body.find(c=>c.before==='[Quran, 108:1-3].');
 expect(range.after).toContain('الكوثر ١–٣');
 expect(range.after).not.toContain('بِسْمِ');
 expect(range.verification.additional).toHaveLength(2);
});
test('completes an existing Quran range without replacing its source wording',()=>{
 const e=require('../data/yqsirah-formatting.json').passages[607].body.find(e=>e.kind==='quran-completion');
 const r=formatField(e.before,[e]);expect(undo(r.text,r.ledger)).toBe(e.before);expect(r.text).toContain('يس ٢٠–٢٧');
 expect(()=>formatField(e.before,[{...e,append:'different'}])).toThrow(/exact verified verse/);
 expect(()=>formatField(e.before,[{...e,after:e.after.replace('وَجَآءَ','حذف')}])).toThrow(/only append/);
});
test('restores a missing opening verse without altering the existing Arabic',()=>{
 const e=require('../data/yqsirah-formatting.json').passages[372].body.find(e=>e.kind==='quran-completion');
 const r=formatField(e.before,[e]);expect(undo(r.text,r.ledger)).toBe(e.before);
 expect(r.text).toContain('﴿الٓمٓ غُلِبَتِ');expect(r.text).toContain('[الروم ١–٥](https://quran.islamunlocked.com/quran:30:1)');
 expect(()=>formatField(e.before,[{...e,prepend:'different'}])).toThrow(/exact verified verse/);
 expect(()=>formatField(e.before,[{...e,after:e.after.replace('غُلِبَتِ','حذف')}])).toThrow(/only prepend/);
 expect(()=>formatField(e.before,[{...e,newUrl:e.oldUrl}])).toThrow(/verified first verse/);
});
test('restores an omitted Quran clause without rewriting surrounding text',()=>{
 const e=require('../data/yqsirah-formatting.json').passages[341].body.find(e=>e.kind==='quran-completion');
 const r=formatField(e.before,[e]);expect(undo(r.text,r.ledger)).toBe(e.before);
 expect(r.text).toContain(e.insert+e.anchor);
 expect(()=>formatField(e.before,[{...e,insert:'invented '}])).toThrow(/exact verified Quran clause/);
 expect(()=>formatField(e.before,[{...e,after:e.after+' deleted narrative'}])).toThrow(/only restore/);
 const misplaced={...e,anchor:'لَّا تَجِدُ'};
 misplaced.after=e.before.replace(misplaced.anchor,e.insert+misplaced.anchor);
 expect(()=>formatField(e.before,[misplaced])).toThrow(/complete verified verse/);
});
