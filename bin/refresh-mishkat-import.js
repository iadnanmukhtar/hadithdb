#!/usr/bin/env node
'use strict';
require('dotenv').config();
require('../lib/Globals');
const axios=require('axios'),SearchHttp=require('../lib/SearchHttp'),Index=require('../lib/Index');
(async()=>{
 const book=(await global.query("SELECT id FROM books WHERE alias='mishkat'"))[0];if(!book)throw Error('Mishkat has not been imported');
 const rows=await global.query(`SELECT DISTINCT h.id,h.books FROM hadiths h JOIN hadiths_virtual hv ON hv.hadithId=h.id WHERE hv.bookId=${Number(book.id)}`);
 for(let i=0;i<rows.length;i+=200){const data=rows.slice(i,i+200).map(h=>JSON.stringify({update:{_id:String(h.id)}})+'\n'+JSON.stringify({doc:{books:h.books}})+'\n').join('');const response=await axios.post(`${global.settings.search.domain}/hadiths/_bulk`,data,SearchHttp.axiosConfig({headers:{'Content-Type':'application/x-ndjson'}}));if(response.data.errors)throw Error('Membership index update failed: '+JSON.stringify(response.data.items.filter(x=>x.update.error)));}
 await Index.refresh('hadiths');
 const Utils=require('../lib/Utils');await Utils.flushBookDiskCache('mishkat',{strict:true});await Utils.flushCacheContaining('_books');await require('../lib/RuntimeRefresh').publish();
 console.log(JSON.stringify({bookId:book.id,indexedMemberships:rows.length}));
 process.exit(0);
})().catch(e=>{console.error(e.stack);process.exit(1);});
