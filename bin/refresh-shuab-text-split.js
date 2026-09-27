#!/usr/bin/env node
'use strict';
require('dotenv').config();
require('../lib/Globals');
const fs=require('fs'),assert=require('assert/strict'),axios=require('axios'),zlib=require('zlib');
const Index=require('../lib/Index'),SearchHttp=require('../lib/SearchHttp'),Utils=require('../lib/Utils'),Arabic=require('../lib/Arabic');
(async()=>{
 const virtuals=await global.query("SELECT DISTINCT b.id,b.alias FROM hadiths_virtual v JOIN hadiths h ON h.id=v.hadithId JOIN books b ON b.id=v.bookId WHERE h.bookId=100420");
 for(const b of virtuals){await global.query(`CALL refresh_v_hadiths_virtual_snapshot(${Number(b.id)})`);console.log('Refreshed virtual snapshot '+b.alias);}
 const docs=await global.query('SELECT id,chain,body,footnote FROM v_hadiths WHERE book_id=100420 ORDER BY ordinal');
 assert.equal(docs.length,10725);
 const plan=JSON.parse(fs.readFileSync('temp/shuab/split-plan.json'));
 for(let i=0;i<docs.length;i++){
  for(const k of ['id','chain','body','footnote'])assert.equal(docs[i][k],plan.patches[i][k],`Database plan mismatch ${docs[i].id}:${k}`);
  docs[i].body_search_ar=Utils.trimToEmpty(Arabic.normalize(docs[i].body,false));
 }
 for(let offset=0;offset<docs.length;offset+=300){
  const batch=docs.slice(offset,offset+300);
  const body=batch.map(({id,...doc})=>JSON.stringify({update:{_id:String(id)}})+'\n'+JSON.stringify({doc})).join('\n')+'\n';
  const result=await axios.post(global.settings.search.domain+'/hadiths/_bulk',zlib.gzipSync(body),SearchHttp.axiosConfig({headers:{'Content-Type':'application/x-ndjson','Content-Encoding':'gzip'},timeout:120000}));
  assert(!result.data.errors,JSON.stringify(result.data.items.filter(x=>x.update.error).slice(0,2)));
  if(offset%1500===0)console.log('Indexed '+Math.min(offset+300,docs.length)+'/'+docs.length);
 }
 await Index.refresh('hadiths');
 for(let offset=0;offset<docs.length;offset+=500){
  const batch=docs.slice(offset,offset+500),keys=['chain','body','footnote','body_search_ar'];
  const r=await axios.post(global.settings.search.domain+'/hadiths/_mget',{docs:batch.map(d=>({_id:String(d.id),_source:keys}))},SearchHttp.axiosConfig({timeout:120000}));
  r.data.docs.forEach((doc,i)=>{assert(doc.found);for(const k of keys)assert.equal(doc._source[k],batch[i][k],`Index mismatch ${batch[i].id}:${k}`);});
 }
 for(const alias of ['shuab',...virtuals.map(b=>b.alias)])await Utils.flushBookDiskCache(alias,{strict:true});
 await Utils.flushCacheContaining('_books');
 await require('../lib/RuntimeRefresh').publish();
 fs.writeFileSync('temp/shuab/text-split-index-verification.json',JSON.stringify({reports:docs.length,virtuals,allFieldsVerified:true},null,2));
 console.log('Verified all Shuab text fields in Elasticsearch; caches refreshed');
 process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1);});
