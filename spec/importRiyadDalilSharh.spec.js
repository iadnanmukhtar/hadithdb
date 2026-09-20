'use strict';
const {extract,materialize,validateTargets,sha256,textFor}=require('../bin/utils/import-riyad-dalil-sharh');
const alignment=require('../bin/utils/riyad-dalil-alignment.json');
let parts;
beforeAll(()=>{parts=extract();});
test('reviewed partial crosswalk has intact boundaries and excludes every page gap',()=>{
 const entries=materialize(alignment,parts);
 expect(entries.filter(e=>e.kind==='hadith')).toHaveLength(1548);
 expect(entries.filter(e=>e.kind==='heading')).toHaveLength(284);
 expect(entries.filter(e=>e.kind==='book-sharh')).toHaveLength(1);
 for(const entry of entries)expect(parts.slice(entry.start,entry.end).some(p=>p.kind==='gap')).toBe(false);
 expect(entries.some(e=>e.kind==='hadith'&&e.filePage===1835)).toBe(false);
 expect(entries.find(e=>e.kind==='heading'&&e.start===4696).targetTitle).toContain('باب سلام الرجل');
});
test('source quotes and footnotes remain separate from the top-of-page matn',()=>{
 const entry=alignment.segments.find(e=>e.number===1890);
 const text=textFor(parts,entry.start,entry.end);
 expect(text).toContain('[^p2245n4]');
 expect(text).toContain('[^p2245n4]:');
 expect(text).not.toContain('1889- وعنه');
});
test('source or boundary edits cannot silently change an import',()=>{
 const edited=structuredClone(parts);edited[alignment.segments.find(e=>e.number===1).start].text+=' altered';
 expect(()=>materialize(alignment,edited)).toThrow('Source text changed');
 const changed=structuredClone(alignment);changed.segments[1].end++;
 expect(()=>materialize(changed,parts)).toThrow('Boundary changed');
});
test('actual hadith identity is checked independently of the virtual row ID',()=>{
 const row={id:10,hadithId:20,tocId:30,num0:5,textActual:'matn',chain:'chain',body:'body',actualBookId:1};
 const entry={kind:'hadith',virtualId:10,hadithId:20,number:5,targetSha256:sha256(JSON.stringify([20,30,5,'matn','chain','body']))};
 expect(()=>validateTargets([entry],[row],[])).not.toThrow();
 expect(()=>validateTargets([{...entry,hadithId:10}],[row],[])).toThrow('Actual hadith identity changed');
 expect(()=>validateTargets([entry],[{...row,body:'changed'}],[])).toThrow('Actual hadith identity changed');
});
test('honorific normalization preserves source witnesses and is idempotent',()=>{
 const {normalizeHonorifics}=require('../bin/utils/import-riyad-dalil-sharh');
 const entries=materialize(alignment,parts);
 expect(normalizeHonorifics('النبي - صَلَّى اللَّهُ عَلَيْهِ وَسَلَّمَ - وعائشة رضي الله عنها')).toBe('النبي ﷺ وعائشة ؓ');
 for(const entry of entries){
  expect(sha256(entry.sourceText)).toBe(entry.textSha256);
  expect(normalizeHonorifics(entry.text)).toBe(entry.text);
  expect(entry.text.match(/\[\^p\d+n\d+\]/g)).toEqual(entry.sourceText.match(/\[\^p\d+n\d+\]/g));
 }
 expect(entries.filter(e=>e.text!==e.sourceText).length).toBeGreaterThan(928);
});

test('second pass repairs the misplaced paragraph without changing the existing entry key',()=>{
 const entries=materialize(alignment,parts),a=entries.find(e=>e.number===74),b=entries.find(e=>e.number===75);
 expect(a.end).toBe(b.start);
 expect(a.text).toContain('والثاني: أنه قلّ أن يصدر');
 expect(b.text).not.toContain('والثاني: أنه قلّ أن يصدر');
 expect(b.text).toMatch(/^الحديث الثاني/);
 expect(b.entryId).toBe(-9000920);
 for(let i=1;i<entries.length;i++){
  const previous=entries[i-1];
  expect(entries[i].start).toBeGreaterThanOrEqual(previous.end-(previous.endTextOffset===undefined?0:1));
 }
});
test('complete book introduction commentary stays on the existing introduction',()=>{
 const intro=materialize(alignment,parts).find(e=>e.kind==='book-sharh');
 expect(intro.tocId).toBe(166738);
 expect(intro.entryId).toBe(-9000000);
 expect(intro.text).toContain('قال المصنف');
 expect(intro.text).toContain('العزيز الحكيم');
 expect(intro.text.length).toBeGreaterThan(35000);
});
test('reviewed corrections reject edited data and require the dedicated flag',()=>{
 const {replacementKind}=require('../bin/utils/import-riyad-dalil-sharh');
 const entry={text:'corrected',previousTextSha256:sha256('old')};
 expect(()=>replacementKind('old',entry)).toThrow('refusing overwrite');
 expect(replacementKind('old',entry,{corrections:true})).toBe('reviewed-correction');
 expect(()=>replacementKind('user edit',entry,{corrections:true})).toThrow('refusing overwrite');
});
test('short hadith uses a validated actual record instead of its unlinked placeholder',()=>{
 const entry=alignment.segments.find(e=>e.number===134);
 expect(entry.hadithId).toBe(101334);
 expect(entry.virtualId).toBe(65616);
 expect(entry.shortCompleteMatn).toBe(true);
});

test('third pass splits joined narrations at the exact embedded narrator boundary',()=>{
 const entries=materialize(alignment,parts),first=entries.find(e=>e.number===1237),second=entries.find(e=>e.number===1238);
 expect(first.end-1).toBe(second.start);
 expect(first.endTextOffset).toBe(second.startTextOffset);
 expect(first.sourceText+second.sourceText).toBe(textFor(parts,first.start,second.end));
 expect(first.text).not.toContain('1236- (وعن سلمان)');
 expect(second.text).toMatch(/^1236- \(وعن سلمان/);
 expect(first.ref).toBe('muslim:1101b');
 expect(second.ref).toBe('abudawud:2355');
 const changed=structuredClone(alignment);changed.segments.find(e=>e.number===1237).endTextOffset++;
 expect(()=>materialize(changed,parts)).toThrow('Source text changed');
});
test('third pass pins alternate references with matching narrators and matn',()=>{
 expect(alignment.segments.find(e=>e.number===1676).ref).toBe('abudawud:3920');
 expect(alignment.segments.find(e=>e.number===1113).ref).toBe('bukhari:1172');
 expect(alignment.segments.find(e=>e.number===1877).ref).toBe('muslim:484d');
 expect(alignment.segments.find(e=>e.number===717).ref).toBe('bukhari:1166');
});
test('within-paragraph slicing keeps only footnotes referenced on its own side',()=>{
 const paragraph={text:'first[^a] second[^b]',refs:[{key:'a',text:'note a'},{key:'b',text:'note b'}]};
 expect(textFor([paragraph],0,1,{endTextOffset:10})).toBe('first[^a] \n\n[^a]: note a');
 expect(textFor([paragraph],0,1,{startTextOffset:10})).toBe('second[^b]\n\n[^b]: note b');
 expect(()=>textFor([paragraph],0,1,{startTextOffset:99})).toThrow('Invalid text slice');
});

test('full Arabic text and explicit cross-reference evidence are pinned',()=>{
 const row={id:10,hadithId:20,tocId:30,num0:5,textActual:'matn',chain:'chain',body:'body',actualText:'complete narration',actualBookId:2};
 const support={id:21,bookId:2,chain:'chain',body:'matn',text:'full cross-referenced narration'};
 const entry={kind:'hadith',virtualId:10,hadithId:20,number:5,targetSha256:sha256(JSON.stringify([20,30,5,'matn','chain','body'])),targetFullTextSha256:sha256(row.actualText),supportingTargets:[{id:21,sha256:sha256(JSON.stringify([21,2,support.chain,support.body,support.text]))}]};
 expect(()=>validateTargets([entry],[row],[],[support])).not.toThrow();
 expect(()=>validateTargets([entry],[{...row,actualText:'edited'}],[],[support])).toThrow('Actual hadith identity changed');
 expect(()=>validateTargets([entry],[row],[],[{...support,text:'edited'}])).toThrow('Supporting narration changed');
});
test('reference repairs preserve local numbering and reject changed user data',()=>{
 const {state}=require('../bin/utils/repair-riyad-dalil-references');
 const before={id:1,num:'717',num0:717,hadithId:2,ref_num:'bukhari:1162',textActual:'source'};
 const patch={hadithId:3,ref_num:'bukhari:1166'};
 expect(state(before,before,patch)).toBe('pending');
 expect(state({...before,...patch},before,patch)).toBe('applied');
 expect(()=>state({...before,textActual:'user edit'},before,patch)).toThrow('Reviewed row changed');
 expect(()=>state({...before,num:'1166'},before,patch)).toThrow('Reviewed row changed');
});
