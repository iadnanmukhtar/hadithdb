#!/usr/bin/env node
'use strict';
const fs = require('fs');
const assert = require('assert/strict');
function cleanTitle(title, number) {
 if (typeof title !== 'string') return title;
 const match = title.match(/^(\s*(?:✧\s*)?)([0-9٠-٩]+)\s*[-–—]\s*/);
 if (!match) return title;
 const n = Number(match[2].replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
 return n === Number(number) ? match[1] + title.slice(match[0].length) : title;
}
async function main() {
 require('dotenv').config();
 const db = require('mysql').createConnection(require('../initializeHadithAttributions').connectionSettings());
 const q = require('util').promisify(db.query).bind(db);
 try {
  const book = (await q("SELECT id FROM books WHERE alias='shuab'"))[0];
  assert(book, 'Shuab not found');
  await q('START TRANSACTION');
  const rows = await q('SELECT * FROM toc WHERE bookId=? ORDER BY ordinal FOR UPDATE', [book.id]);
  const patches = rows.filter(r => r.level === 1).map(r => ({id:r.id, title:cleanTitle(r.title,r.h1), title_en:cleanTitle(r.title_en,r.h1)})).filter(p => {const r=rows.find(r=>r.id===p.id);return p.title!==r.title||p.title_en!==r.title_en;});
  console.log(JSON.stringify({bookId:book.id,headings:patches.length,apply:process.argv.includes('--apply')}));
  if (!process.argv.includes('--apply') || !patches.length) {await q('ROLLBACK');return;}
  const backup=`temp/shuab/heading-numbers-before-${Date.now()}.json`;
  fs.writeFileSync(backup,JSON.stringify(rows,null,2));
  for(const p of patches) await q('UPDATE toc SET title=?,title_en=? WHERE id=? AND bookId=?',[p.title,p.title_en,p.id,book.id]);
  const after=await q('SELECT * FROM toc WHERE bookId=? ORDER BY ordinal',[book.id]);
  const byId=new Map(patches.map(p=>[p.id,p]));
  after.forEach((r,i)=>{for(const key of Object.keys(r).filter(k=>k!=='lastmod'))assert.deepEqual(r[key],byId.get(r.id)?.[key]??rows[i][key],`${r.id}:${key}`);});
  await q('UPDATE books SET content_lastmod=NOW() WHERE id=?',[book.id]);
  await q('COMMIT');
  const replacements={};for(const p of patches){const old=rows.find(r=>r.id===p.id);for(const key of ['title','title_en'])if(old[key]!==p[key])replacements[old[key]]=p[key];}
  fs.writeFileSync('temp/shuab/heading-numbers-applied.json',JSON.stringify({bookId:book.id,backup,patches,replacements},null,2));
  console.log(JSON.stringify({updated:patches.length,backup,verified:true}));
 }catch(e){await q('ROLLBACK');throw e;}finally{db.end();}
}
module.exports={cleanTitle};
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});
