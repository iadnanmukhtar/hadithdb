'use strict';
test.each(['mirqat','miraat','lamaat'])('%s normalizes stored commentary while retaining the source witness',name=>{
 const {planImport}=require(`../bin/utils/import-${name}-sharh`);
 const text='قال صلى الله عليه وسلم عن عمر رضي الله عنه';
 const passage={kind:'hadith',number:1,numbers:[1],text,file:161,page:165,volume:1};
 const source={segments:[passage],entries:[passage]};
 const plan=planImport(source,[{id:1,hadithId:2,num:'1',bookId:100419,h1:1,h2:1,h3:1}],[]);
 expect(plan.entries[0].text).toBe('قال ﷺ عن عمر ؓ');
 expect(source.segments[0].text).toBe(text);
});
