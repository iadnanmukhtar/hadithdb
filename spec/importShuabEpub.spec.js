'use strict';
const fs=require('fs'),Zip=require('adm-zip'),cheerio=require('cheerio');
const {parse}=require('../bin/import-shuab-epub');
const describeSource=fs.existsSync('temp/shuab/shuab.epub')?describe:describe.skip;
describeSource('Shuab supplied EPUB import',()=>{
 let data;
 beforeAll(()=>{data=parse();},30000);
 test('retains numbered source reports including gaps and duplicate labels',()=>{
  expect(data.entries).toHaveLength(10725);
  expect(new Set(data.entries.map(e=>e.num)).size).toBe(10725);
  expect(data.stats.missing).toHaveLength(46);
  expect(data.stats.duplicates).toHaveLength(15);
  expect(data.entries.filter(e=>e.number===1283).map(e=>e.num)).toEqual(['1283a','1283b']);
  expect(data.entries.find(e=>e.num==='3447').text).toMatch(/\S/);
 });
 test('uses actual chapter starts instead of displaced EPUB navigation anchors',()=>{
  expect(data.headings).toHaveLength(421);
  expect(data.headings.filter(h=>h.level===1)).toHaveLength(78);
  expect(data.headings.find(h=>h.key==='C8').page).toBe(85);
  expect(data.entries.find(e=>e.num==='70').headingKey).toBe('C8');
  expect(data.headings.find(h=>h.h1===46&&h.level===1).page).toBe(7127);
  expect(data.headings.find(h=>h.h1===43&&h.level===1).page).toBe(6714);
  expect(data.entries.find(e=>e.num==='6936').text).not.toContain('الثَّامِنُ وَالْأَرْبَعُونَ');
  expect(data.headings.find(h=>h.h1===48&&h.level===1).intro).toMatch(/^الثَّامِنُ وَالْأَرْبَعُونَ/);
 });
 test('preserves every source character except whitespace, report labels and page markers',()=>{
  const zip=new Zip('temp/shuab/shuab.epub');let expected='';
  for(const p of data.pageAudit){const $=cheerio.load(zip.readAsText(p.file)),b=$('#book-container');
   b.find('span.red').each((i,e)=>{if(/^\s*\d+\s*-\s*(?:-\s*)?$/.test($(e).text()))$(e).remove();});
   b.find('span.title').each((i,e)=>{if(/^\[ص:/.test($(e).text()))$(e).remove();});
   expected+=b.text();
  }
  const actual=[...data.headings.map(h=>h.intro+(h.footnote||'')),...data.entries.map(e=>e.text+e.footnote)].join('');
  function counts(s){const c={};for(const ch of s.replace(/\s/g,''))c[ch]=(c[ch]||0)+1;return c;}
  expect(counts(actual)).toEqual(counts(expected));
 });
});
