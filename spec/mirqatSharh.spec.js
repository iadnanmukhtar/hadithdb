'use strict';
const { planImport } = require('../bin/utils/import-mirqat-sharh');
const { ensureSchema, triggers } = require('../lib/VirtualHadithSharh');
const row = (id,hadithId,num='1') => ({id,hadithId,num,bookId:100419,h1:1,h2:1,h3:1});
const source = { entries:[{number:1,numbers:[1]}],segments:[{kind:'hadith',number:1,numbers:[1],text:'Commentary',file:39,page:40,volume:1}] };
test('ownership and source identity survive replacement and convergence',()=>{
  const before=planImport(source,[row(10,100,'1a'),row(11,200,'1b')],[]).entries;
  const after=planImport(source,[row(10,200,'1a'),row(11,200,'1b')],[]).entries;
  expect(after[0]).toEqual({...before[0],hadithId:200});
  expect(after[1]).toEqual(before[1]);
  expect(new Set(after.map(e=>e.sourceEntryId)).size).toBe(2);
});
test('missing commentary is not inferred from a nearby numbered entry',()=>{
  const p=planImport(source,[row(10,100),row(11,200,'2')],[]);
  expect(p.missing).toEqual([2]);expect(p.entries).toHaveLength(1);
});
test('combined explanation is explicitly shared and unresolved targets fail closed',()=>{
  const combined={entries:[{numbers:[1,2]}],segments:[{...source.segments[0],numbers:[1,2]}]};
  expect(planImport(combined,[row(10,100),row(11,200,'2')],[]).entries).toHaveLength(2);
  expect(()=>planImport(source,[row(10,null)],[])).toThrow('Unexpected Mishkat entry');
});
test('chapter title selects the matching chapter when a repeated hadith precedes its first new number',()=>{
  const s={...source,segments:[{kind:'heading',file:38,title:'[باب الحذر]',text:'Intro'},...source.segments]};
  const p=planImport(s,[row(10,100)],[{id:1,level:2,h1:1,h2:1,title:'باب سابق'},{id:2,level:2,h1:1,h2:2,title:'باب الحذر'}]);
  expect(p.headings[0].tocId).toBe(2);
});
test('schema installation preserves existing triggers and rejects drift',async()=>{
  const existing=Object.entries(triggers).map(([Trigger,sql])=>({Trigger,Statement:sql.slice(sql.indexOf('BEGIN'))}));
  const identity=['hadith_id','source_id','source_entry_id'].map((Column_name,i)=>({Key_name:'hdith_sharh_entry',Column_name,Seq_in_index:i+1}));
  const q=jest.fn().mockResolvedValueOnce(identity).mockResolvedValueOnce({}).mockResolvedValueOnce(existing);
  await ensureSchema(q);expect(q).toHaveBeenCalledTimes(3);
  const drift=jest.fn().mockResolvedValueOnce(identity).mockResolvedValueOnce({}).mockResolvedValueOnce([{Trigger:'virtual_sharh_after_update',Statement:'BEGIN END'}]);
  await expect(ensureSchema(drift)).rejects.toThrow('Unexpected existing trigger');
});

// Optional edition-level regression: the copyrighted EPUB is intentionally not
// checked into the repository. The importer itself always enforces its hash.
const fs=require('fs'),path=require('path');
const epub=path.resolve(__dirname,'../temp/mirqat/mirqat.epub');
(fs.existsSync(epub)?describe:describe.skip)('reviewed EPUB',()=>{
  let parsed;
  beforeAll(()=>{parsed=require('../bin/utils/import-mirqat-sharh').extract(epub);});
  test('covers exactly the available source numbers, including co-numbered reports',()=>{
    const numbers=new Set(parsed.entries.flatMap(e=>e.numbers));
    expect(Array.from({length:6294},(_,i)=>i+1).filter(n=>!numbers.has(n))).toEqual([3342,3343,3344,5610]);
    expect(parsed.pages).toBe(8767);
  });
  test('printed numbering errors do not relink the wrong report',()=>{
    expect(parsed.entries.find(e=>e.number===2367).text).toMatch(/^3367 -/);
    expect(parsed.entries.find(e=>e.number===5232).text).toMatch(/^3232 -/);
    expect(parsed.entries.find(e=>e.number===3036).text).toMatch(/^- \(عَنْ عَمْرِو/);
  });
  test('out-of-order explanations retain their own identities',()=>{
    expect(parsed.entries.find(e=>e.number===4239).text).toContain('أَنَسِ بْنِ مَالِكٍ');
    expect(parsed.entries.find(e=>e.number===5611).text).toContain('عُثْمَانَ بْنِ عَفَّانَ');
  });
  test('preserves the book opening and closing colophon',()=>{
    expect(parsed.segments[0].kind).toBe('heading');
    expect(parsed.segments[0].text.length).toBeGreaterThan(180000);
    expect(parsed.entries.find(e=>e.number===6294).text).toContain('عَلِيُّ بْنُ سُلْطَانٍ مُحَمَّدٌ');
  });
  test('audits the whole edition and moves introductions before and after numbered explanations',()=>{
    expect(parsed.introductionAudit.moves).toHaveLength(28);
    expect(parsed.introductionAudit.rejected).toEqual([expect.objectContaining({number:2555,file:3660,matches:0})]);
    for(const [number,witness] of [[526,'وَهُوَ لُغَةٌ: الْقَصْدُ'],[35,'الْمُرَادُ بِهِ الْأَحَادِيثُ الْمُلْحَقَةُ'],[3613,'الْخَمْرُ سَتْرُ الشَّيْءِ']]) {
      expect(parsed.entries.filter(e=>e.number===number).map(e=>e.text).join('\n')).not.toContain(witness);
      expect(parsed.introductionAudit.moves.find(m=>m.number===number).text).toContain(witness);
    }
    expect(parsed.entries.filter(e=>e.number===2555).map(e=>e.text).join('\n')).toContain('(كِتَابَ اللَّهِ) بِالنَّصْبِ');
  });
});
test('an empty second section maps to its own heading rather than the following third section',()=>{
 const s={entries:source.entries,segments:[{kind:'heading',file:100,title:'الفصل الثاني',level:3,sectionNumber:2,text:'الفصل الثاني\nليس فيه إلا حديث سبق'},...source.segments]};
 const v={...row(10,100),h3:3};
 const p=planImport(s,[v],[{id:22,level:3,h1:1,h2:1,h3:2},{id:23,level:3,h1:1,h2:1,h3:3}]);
 expect(p.headings[0].tocId).toBe(22);
});
test('promoted sections retain their level-two destinations',()=>{
 const s={entries:source.entries,segments:[{kind:'heading',file:128,title:'الفصل الثاني',level:3,sectionNumber:2,text:'الفصل الثاني\nأي الحسان'},...source.segments]};
 const p=planImport(s,[{...row(10,100),h2:2,h3:null}],[{id:22,level:2,h1:1,h2:2,h3:null,title:'الحسان'}]);
 expect(p.headings[0].tocId).toBe(22);
});
test('bare section labels never become commentary cards',()=>{
 const s={...source,segments:[{kind:'heading',file:128,title:'الفصل الثاني',text:'الْفَصْلُ الثَّانِي',level:3},...source.segments]};
 const p=planImport(s,[row(10,100)],[]);
 expect(p.headings).toEqual([]);expect(p.entries).toHaveLength(1);
});
(fs.existsSync(epub)?test:test.skip)('Faith introduction belongs to its chapter, outside hadith 2',()=>{
 const parsed=require('../bin/utils/import-mirqat-sharh').extract(epub);
 const heading=parsed.segments.find(s=>s.kind==='heading'&&s.file===50);
 expect(heading.text).toContain('الْكِتَابُ إِمَّا مَأْخُوذٌ');
 expect(heading.text).toContain('كُتُبُ الْكَلَامِ');
 expect(parsed.entries.filter(e=>e.number===2).map(e=>e.text).join('\n')).not.toContain('الْكِتَابُ إِمَّا مَأْخُوذٌ');
});
