const fs = require('fs');
const {repairEntry,manifest,contentHash} = require('../bin/utils/yqsirah-arabic-repairs');
const {build} = require('../bin/utils/import-yqsirah');
const sourcePath = 'var/imports/yqsirah/extracted.json';
const corpusTest = fs.existsSync(sourcePath) ? test : test.skip;

test('repair refuses changed source text before making replacements',()=>{
  expect(()=>repairEntry({num:981,title:'edited',body:'edited',footnotes:'',h1:1,h2:1})).toThrow(/changed source/);
});

corpusTest('full import retains coverage, notes, quotation scope and separates English',()=>{
  const plan = build(JSON.parse(fs.readFileSync(sourcePath)),require('../data/yqsirah-topics.json'));
  expect(plan.entries).toHaveLength(1023);
  expect(plan.chapters).toHaveLength(53);
  expect(plan.entries.flatMap(e=>e.provenance.notes)).toHaveLength(1866);
  const entry = n=>plan.entries.find(e=>e.num===n);
  const verse = manifest.repairs.find(r=>r.passage===981 && r.evidence.references?.includes('9:5'));
  expect(entry(981).body).toContain(verse.new.trim()+'\n\n 9:5.');
  expect(entry(73).body).toContain('كلا! والله ما يخزيك الله أبدا');
  const partial = manifest.repairs.find(r=>r.passage===14 && r.evidence.references?.includes('33:21'));
  expect(partial.new).not.toMatch(/يَرْجُو/);
  for (const e of plan.entries) expect(e.sha256).toBe(contentHash(e));
});
