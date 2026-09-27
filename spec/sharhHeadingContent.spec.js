'use strict';
const {isHeadingOnly,isMishkatHeadingOnly}=require('../lib/SharhHeadingContent');
test('excludes repeated structural labels including vocalization and numbering',()=>{
 expect(isHeadingOnly('[كِتَابُ الْإِيمَانِ]\n1 - كِتَابُ الْإِيمَانِ\n" الْفَصْلُ الْأَوَّلُ "','كتاب الإيمان')).toBe(true);
 expect(isHeadingOnly('الْفَصْلُ الثَّانِي','الفصل الثاني')).toBe(true);
});
test('retains brief explanations, even on the same line as the heading',()=>{
 expect(isHeadingOnly('(الفصل الثاني) أي المعبر به عن قوله من الحسان في المصابيح.','الفصل الثاني')).toBe(false);
 expect(isHeadingOnly('بَابُ الْقَضَاءِ\nأَيْ: حُكْمُهُ وَآدَابُهُ.\nالْفَصْلُ الْأَوَّلُ','باب القضاء')).toBe(false);
 expect(isHeadingOnly('[10] بَابٌ بِالرَّفْعِ وَالْإِسْكَانِ\nالْفَصْلُ الْأَوَّلُ','باب')).toBe(false);
});
test('reviewed title spelling differences are scoped to their source passage',()=>{
 const p={file:2735,title:'باب من لا تحل له المسألة ومن تحل له',text:'(باب من لا تحل له المسألة ومن تحله له)'};
 expect(isMishkatHeadingOnly('miraat',p)).toBe(true);
 expect(isMishkatHeadingOnly('mirqat',p)).toBe(false);
 expect(isMishkatHeadingOnly('miraat',{...p,text:p.text+' أي بيان الحكم'})).toBe(false);
});
