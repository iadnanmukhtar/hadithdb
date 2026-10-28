'use strict';
const Bio=require('../public/static/js/community-bio');
const {JSDOM}=require('jsdom');
const Community=require('../lib/Community');
test('150 Unicode characters, Arabic, emoji, and normal newlines are supported',()=>{
 expect(Bio.error('😀'.repeat(150))).toBe('');expect(Bio.error('😀'.repeat(151))).toMatch(/150/);
 expect(Bio.error('قارئ للحديث\nLearning together\nhttps://example.com')).toBe('');
 expect(Bio.error('a\nb\nc\nd')).toMatch(/3 lines/);
 expect(Bio.normalize('  Hello\r\nWorld  ')).toBe('Hello\nWorld');
});
test('HTML, controls, and executable schemes are rejected',()=>{
 for(const bio of ['<script>alert(1)</script>','<img src=x onerror=alert(1)>','hi\u0000','name\u202eevil','javascript:alert(1)','data:text/html,test'])expect(Bio.error(bio)).not.toBe('');
 expect(Bio.error(Array(6).fill('https://a.co').join(' '))).toMatch(/5 links/);
});
test('rendering creates only safe web links, escapes legacy markup, and bounds legacy bios',()=>{
 const dom=new JSDOM('<p></p>'),p=dom.window.document.querySelector('p');
 try{
 Bio.render(p,'Read https://example.com/?a=1&b=2 and www.example.org.');
 expect(p.querySelectorAll('a')).toHaveLength(2);
 expect(p.querySelector('a').rel).toBe('ugc nofollow noopener noreferrer');
 expect(p.querySelectorAll('a')[1].href).toBe('https://www.example.org/');
 Bio.render(p,'<img src=x onerror=alert(1)> javascript:alert(1) https://user:pass@example.com');
 expect(p.querySelectorAll('img,script,a')).toHaveLength(0);
 Bio.render(p,'A'.repeat(145)+' https://example.com');expect(p.querySelector('a')).toBeNull();expect(Array.from(p.textContent)).toHaveLength(150);
 Bio.render(p,'One\nTwo\nThree\nFour');expect(p.textContent).toBe('One\nTwo\nThree');
 }finally{dom.window.close();}
});
test('profile saves enforce bio rules server-side',async()=>{
 const original=global.dbPool;
 global.dbPool={query(statement,values,cb){if(typeof values==='function')cb=values;cb(null,statement.startsWith('SELECT * FROM community_authors WHERE uid=')?[{uid:'owner',handle:'writer',name:'Writer'}]:[]);}};
 try {for(const bio of ['x'.repeat(151),'<script>x</script>','javascript:x'])await expect(Community.saveProfile({uid:'owner',name:'Writer'},{name:'Writer',handle:'writer',bio})).rejects.toMatchObject({status:400});}
 finally{global.dbPool=original;}
});
