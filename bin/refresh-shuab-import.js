#!/usr/bin/env node
'use strict';
require('dotenv').config();
require('../lib/Globals');
const axios=require('axios');
const SearchHttp=require('../lib/SearchHttp');
const Index=require('../lib/Index');
const Utils=require('../lib/Utils');
(async()=>{
 const book=(await global.query("SELECT id FROM books WHERE alias='shuab'"))[0];
 if(!book)throw Error('Shuab has not been imported');
 const result={bookId:book.id};
 for(const [index,expected]of [['hadiths',10725],['toc',422]]){
  await Index.refresh(index);
  const response=await axios.post(`${global.settings.search.domain}/${index}/_count`,{query:{term:{book_alias:'shuab'}}},SearchHttp.axiosConfig());
  if(response.data.count!==expected)throw Error(`${index} count ${response.data.count}, expected ${expected}`);
  result[index]=response.data.count;
 }
 await Utils.flushBookDiskCache('shuab',{strict:true});
 await Utils.flushCacheContaining('_books');
 await require('../lib/RuntimeRefresh').publish();
 require('fs').writeFileSync('temp/shuab/index-verification.json',JSON.stringify(result,null,2));
 console.log(JSON.stringify(result));
 process.exit(0);
})().catch(e=>{console.error(e.stack);process.exit(1);});
