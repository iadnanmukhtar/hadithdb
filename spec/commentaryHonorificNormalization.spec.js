'use strict';
const {normalize,candidatePattern} = require('../bin/utils/normalize-commentary-honorifics');
describe('commentary honorific repair',()=>{
 test.each([
  ['قال صَلَّى اللَّهُ عَلَيْهِ وَسَلَّمَ:','قال ﷺ:'],
  ['Anas (may Allah be pleased with him).','Anas ؓ.'],
  ['The Prophet (peace be upon him) said','The Prophet ﷺ said'],
  ['    quoted  text\n\nقال صلى الله عليه وسلم','    quoted  text\n\nقال ﷺ'],
  ['The Prophet (peace and blessings be upon him).','The Prophet ﷺ.'],
  ['The Prophet (PBUH).','The Prophet ﷺ.'],
  ['قال ﷺ : نص','قال ﷺ : نص'],
  ["Muhammad (Allah's peace be upon him).",'Muhammad ﷺ.'],
  [String.raw`Anas \(may Allah be pleased with him\).`,'Anas ؓ.'],
  ['قال عليه الصلاة والسلام','قال ﷺ'],
  ['رَضِيَ اللَّهُ عَنْهُمْ وَرَضُوا عَنْهُ','رَضِيَ اللَّهُ عَنْهُمْ وَرَضُوا عَنْهُ'],
  ['﴿رضي الله عنهم﴾ عن أنس رضي الله عنه','﴿رضي الله عنهم﴾ عن أنس ؓ'],
  ["Muhammad (may Allah's peace and blessings be upon him).",'Muhammad ﷺ.'],
  [String.raw`Muhammad \(Allah\'s peace be upon him\).`,'Muhammad ﷺ.'],
  ['قال (((صلى الله عليه\nوسلم)))','قال ﷺ'],
  [String.raw`Anas \(may Allah be pleased
with him\).`,'Anas ؓ.'],
  ['See https://example.test/PBUH and the Prophet (PBUH).','See https://example.test/PBUH and the Prophet ﷺ.'],
  [null,null],['ordinary  text','ordinary  text']
 ])('preserves surrounding content: %s',(input,expected)=>{if(input!==expected)expect(new RegExp(candidatePattern,'iu').test(input)).toBe(true);expect(normalize(input)).toBe(expected);expect(normalize(normalize(input))).toBe(expected);});
});
