'use strict';
const sqlite=require('sqlite3');
const Headings=require('../lib/CommentaryHeadings');
describe('authored introduction selection',()=>{
 let db,previousQuery;
 beforeEach(async()=>{
  db=new sqlite.Database(':memory:');previousQuery=global.query;
  global.query=sql=>new Promise((resolve,reject)=>db.all(sql,(e,r)=>e?reject(e):resolve(r)));
  await new Promise((resolve,reject)=>db.exec(`CREATE TABLE toc(id INT,bookId INT,level INT,h1 INT,h2 INT,ordinal INT);
   CREATE TABLE hadiths(id INT,tocId INT);CREATE TABLE hadiths_virtual(id INT,tocId INT);
   INSERT INTO toc VALUES(1,42,2,0,14,10),(2,42,2,0,1,20),(3,42,2,0,2,30);
   INSERT INTO toc VALUES(4,43,2,0,1,40);`,e=>e?reject(e):resolve()));
 });
 afterEach(async()=>{global.query=previousQuery;await new Promise(resolve=>db.close(resolve));});
 test.each(['hadiths','hadiths_virtual'])('keeps an empty chapter in place after %s begin',async table=>{
  await global.query(`INSERT INTO ${table} VALUES(10,2)`);
  expect((await Headings.introductionArticles(42)).map(r=>r.id)).toEqual([1]);
  expect((await Headings.introductionArticles(42,true)).map(r=>r.id)).toEqual([2,3,1]);
 });
 test('retains articles for a commentary book without hadiths',async()=>{
  await global.query('INSERT INTO hadiths VALUES(10,2)');
  expect((await Headings.introductionArticles(43)).map(r=>r.id)).toEqual([4]);
 });
});
