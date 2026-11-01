'use strict';
const md=require('markdown-it')({html:true}).use(require('../lib/BlogArabic'));
const {clean}=require('../bin/community-clean-blog-markers');
test('removes only the obsolete marker bytes, preserving Arabic and Markdown',()=>{
 const text='~~**الصَّلَاةُ** [مصدر](/bukhari:1)~~\nEnglish';
 expect(clean(text)).toBe('**الصَّلَاةُ** [مصدر](/bukhari:1)\nEnglish');expect(clean(clean(text))).toBe(clean(text));
});
test('Arabic gets typography and block direction without strikethrough',()=>{
 const html=md.render('العَرَبِيَّةُ **نص**\n\nEnglish with عربي text.\n\n- العربية');
 expect(html).toContain('<p dir="rtl">');expect(html).toContain('<p dir="ltr">English');expect(html).toContain('<li dir="rtl">');expect(html).toContain('class="blog-arabic"');expect(html).not.toContain('<s>');expect(html).not.toContain('lang="ar">English');
});

test('quote direction follows its opening language independently of translations and nested quotes',()=>{
 const {load}=require('cheerio');
 const $=load(md.render('> **العربية**\n>\n> English translation.\n>\n> > English first.\n> >\n> > العربية'));
 expect($('blockquote').first().attr('dir')).toBe('rtl');
 expect($('blockquote blockquote').attr('dir')).toBe('ltr');
});
