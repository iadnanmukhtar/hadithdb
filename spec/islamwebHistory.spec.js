'use strict';
const { parsePage, readerHeadings, headingRuns } = require('../bin/utils/import-islamweb-history');

describe('Islamweb history import', () => {
 test('preserves the page identity, hierarchy, title, and Arabic text', () => {
  const html = `<html><head><link rel="canonical" href="https://www.islamweb.net/ar/library/content/200/16068/example"></head><body>
   <ol id="topPath">
    <span itemprop="name">موسوعة السيرة النبوية والتاريخ الإسلامي</span>
    <span itemprop="name">بداية الخلق وقصص الأنبياء</span><span itemprop="name">خلق السماوات والأرض</span><span itemprop="name">ملخص الخلق</span>
   </ol><div itemscope itemtype="http://schema.org/Article"><input id="currentpage" value="16068">
   <div class="bookcontent-dic" id="pagebody" itemprop="articleBody">نص غير مشكول</div>
   <div class="bookcontent-dic" id="pagebody_thaskeel" style="display:none">النَّصُّ <span class="quran"><span class="quranatt" style="display:none">hidden</span>آيَةٌ</span><br><br>تَكْمِلَةٌ</div></div></body></html>`;
  expect(parsePage(html, 16068)).toEqual({
   source_page_id: 16068,
   title: 'ملخص الخلق',
   headings: ['بداية الخلق وقصص الأنبياء', 'خلق السماوات والأرض'],
   source_headings: ['بداية الخلق وقصص الأنبياء', 'خلق السماوات والأرض'],
   body: 'النَّصُّ آيَةٌ\n\nتَكْمِلَةٌ',
   source_url: 'https://www.islamweb.net/ar/library/content/200/16068/example'
  });
  expect(() => parsePage(html, 16069)).toThrow('Wrong Islamweb page identity');
  expect(() => parsePage(html.replace('id="pagebody_thaskeel"', 'id="other"'), 16068)).toThrow('Expected one vocalized article body');
 });

 test('preserves source heading depth while fitting the three-level reader schema', () => {
  expect(readerHeadings(['السيرة', 'النسب', 'أصول العرب', 'سياقة النسب'])).toEqual(['السيرة', 'النسب', 'أصول العرب — سياقة النسب']);
 });

 test('builds contiguous nested heading ranges without flattening the history divisions', () => {
  const pages = [
   { headings: ['الخلق', 'السماوات'] }, { headings: ['الخلق', 'السماوات'] },
   { headings: ['السيرة', 'النسب'] }, { headings: ['الخلافة', 'أبو بكر', 'السنة الأولى'] }
  ];
  const roots = headingRuns(pages);
  expect(roots.map(node => node.title)).toEqual(['الخلق', 'السيرة', 'الخلافة']);
  expect(roots[0]).toMatchObject({ startIndex: 0, endIndex: 1 });
  expect(roots[2].children[0].children[0]).toMatchObject({ level: 3, startIndex: 3, endIndex: 3 });
  expect(pages[3].headingNode.title).toBe('السنة الأولى');
 });
});
