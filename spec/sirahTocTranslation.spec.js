'use strict';
const {validate}=require('../bin/utils/translate-sirah-toc');
const rows=[{id:1,title:'هجرة الرسول ﷺ'},{id:2,title:'أبو بكر ؓ'}];
const translated=[{id:1,title:rows[0].title,title_en:'The Messenger’s ﷺ emigration'},{id:2,title:rows[1].title,title_en:'Abū Bakr ؓ'}];
test('accepts complete source-aligned English headings with retained honorifics',()=>{
 expect(()=>validate(rows,translated)).not.toThrow();
});
test.each([
 ['missing heading', translated.slice(0,1)],
 ['reordered identities', [...translated].reverse()],
 ['changed source', [{...translated[0],title:'different'},translated[1]]],
 ['missing honorific', [{...translated[0],title_en:'The emigration'},translated[1]]],
 ['untranslated Arabic', [{...translated[0],title_en:'هجرة ﷺ'},translated[1]]],
 ['empty English', [{...translated[0],title_en:''},translated[1]]]
])('rejects %s before any database writes',(_,data)=>expect(()=>validate(rows,data)).toThrow());
