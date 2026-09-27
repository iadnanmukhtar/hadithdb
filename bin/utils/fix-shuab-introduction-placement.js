#!/usr/bin/env node
'use strict';
require('dotenv').config();
const fs=require('fs'),assert=require('assert/strict');
const db=require('mysql').createConnection(require('../initializeHadithAttributions').connectionSettings());
const q=require('util').promisify(db.query).bind(db);
(async()=>{try{
 await q('START TRANSACTION');
 const rows=await q('SELECT * FROM toc WHERE bookId=100420 AND h1=0 ORDER BY ordinal FOR UPDATE');
 const parent=rows.find(r=>r.id===169895),reality=rows.find(r=>r.id===169897);
 assert(parent&&reality);
 const existing=rows.find(r=>r.lastmod_user==='shuab:book-intro');
 if(existing&&!parent.intro&&!parent.intro_en){await q('ROLLBACK');console.log({unchanged:true,articleId:existing.id});return;}
 assert(parent.intro?.startsWith('مقدمة'));assert(reality.intro?.startsWith('بَابُ حَقِيقَةِ'));
 const backup=`temp/shuab/intro-placement-backup-${Date.now()}.json`;
 fs.writeFileSync(backup,JSON.stringify(rows,null,2));
 const h2=Math.max(...rows.map(r=>Number(r.h2)||0))+1;
 const inserted=await q('INSERT INTO toc SET ?',{bookId:100420,ordinal:parent.ordinal-1,level:2,h1:0,h2,h3:null,title:parent.title,title_en:parent.title_en,intro:parent.intro,intro_en:parent.intro_en,count:0,lastmod_user:'shuab:book-intro'});
 await q('UPDATE toc SET intro=NULL,intro_en=NULL WHERE id=?',[parent.id]);
 const after=await q('SELECT * FROM toc WHERE bookId=100420 AND h1=0 ORDER BY ordinal');
 const article=after.find(r=>r.id===inserted.insertId);
 assert.equal(article.intro,parent.intro);assert.equal(article.intro_en,parent.intro_en);
 for(const old of rows){const now=after.find(r=>r.id===old.id);for(const k of Object.keys(old)){if(k==='lastmod')continue;assert.deepEqual(now[k],old.id===parent.id&&['intro','intro_en'].includes(k)?null:old[k],`${old.id}:${k}`);}}
 await q('UPDATE books SET content_lastmod=NOW() WHERE id=100420');
 await q('COMMIT');
 const result={backup,articleId:article.id,h2,sourceId:parent.id,chapterIntroId:reality.id,verified:true};
 fs.writeFileSync('temp/shuab/intro-placement-applied.json',JSON.stringify(result,null,2));console.log(result);
}catch(e){await q('ROLLBACK');throw e;}finally{db.end();}})().catch(e=>{console.error(e.message);process.exitCode=1;});
