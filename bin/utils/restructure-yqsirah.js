#!/usr/bin/env node
'use strict';
// Changes only heading metadata and hierarchy. Stable item/TOC ids and all prose stay intact.
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),crypto=require('crypto');
const mysql=require('mysql'),{promisify}=require('util');
const manifest=require('../../data/yqsirah-hierarchy.json');
const {revision}=require('./yqsirah-hierarchy');
const {contentHash}=require('./yqsirah-arabic-repairs');
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const prose=row=>digest([row.id,row.num,row.ordinal,row.body,row.text,row.footnote,row.body_en,row.text_en,row.footnote_en]);
const json=value=>typeof value==='string'?JSON.parse(value):value;
async function main(){
 const db=mysql.createConnection(require(path.join(require('os').homedir(),'.hadithdb/settings.json')).mysql.connection);
 const query=promisify(db.query).bind(db),apply=process.argv.includes('--apply');
 try {
  await query('START TRANSACTION');
  const [book]=await query('SELECT id,type FROM books WHERE alias=? FOR UPDATE',['yqsirah']);assert.equal(book.type,'sirah');
  const rows=await query('SELECT h.*,s.source_json,s.content_sha256 FROM hadiths h JOIN yqsirah_source_entries s ON s.item_id=h.id AND s.book_id=h.bookId WHERE h.bookId=? ORDER BY h.ordinal FOR UPDATE',[book.id]);
  const toc=await query('SELECT * FROM toc WHERE bookId=? ORDER BY ordinal FOR UPDATE',[book.id]);
  assert.equal(rows.length,1023);assert.equal(toc.length,1076);
  const headings=new Map(toc.map(t=>[t.id,t]));const updates=[];const preservedTitles=[];
  for(const row of rows){
   const num=Number(row.num),chapter=manifest.chapters[Number(row.h1)-1];
   assert(chapter && num>=chapter.starts[0]);
   const h2=chapter.starts.filter(n=>n<=num).length;
   const h3=num-chapter.starts[h2-1] || null;
   const chapterEnd=(manifest.chapters[chapter.h1]?.starts[0] || 1024)-1;
   const end=h3?num:(chapter.starts[h2] || chapterEnd+1)-1;
   const heading=headings.get(row.tocId);assert(heading);assert.equal(Number(heading.start0),num);
   const source=json(row.source_json);const prior=source.hierarchy;
   assert(!prior || prior.revision===revision,'Unexpected hierarchy revision');
   if(!prior){assert.equal(Number(row.h2),num-chapter.starts[0]+1);assert(!Number(row.h3));assert.equal(Number(heading.level),2);}
   const rename=manifest.titles[num];
   const retitle=(title,kind)=>{
    if(!rename || title===rename.to)return title;
    if(title===rename.from)return rename.to;
    preservedTitles.push({num,kind});return title;
   };
   const title=retitle(row.title_en,'passage'),headingTitle=retitle(heading.title_en,'heading');
   const fields={h1:chapter.h1,h2,h3,numInChapter:num-chapter.starts[0]+1,title_en:title};
   const headingFields={level:h3?3:2,h1:chapter.h1,h2,h3,title_en:headingTitle,start:String(num),end:String(end),start0:num,end0:end,count:end-num+1};
   const expected={...row,...fields};
   const metadata={...source,hierarchy:prior || {revision,original:{h1:Number(row.h1),h2:Number(row.h2),title:row.title_en}}};
   const sha=contentHash({title,body:row.body_en,footnotes:row.footnote_en,h1:chapter.h1,h2});
   if(prior){
    for(const key of ['h1','h2','h3','numInChapter'])assert.equal(Number(row[key])||null,Number(fields[key])||null);
    for(const key of ['level','h1','h2','h3','start0','end0','count'])assert.equal(Number(heading[key])||null,Number(headingFields[key])||null);
    continue; // An idempotent rerun must also preserve subsequent editor changes.
   }
   updates.push({row,heading,fields,headingFields,metadata,sha,prose:prose(expected)});
  }
  let backup;
  if(apply && updates.length){
   const dir=path.resolve('var/imports/yqsirah');fs.mkdirSync(dir,{recursive:true});
   backup=path.join(dir,`hierarchy-before-${Date.now()}.json`);
   // Backup stays on the database host; it includes live edits for exact recovery.
   fs.writeFileSync(backup,JSON.stringify({book,toc,rows,revision}),{mode:0o600,flag:'wx'});
   for(const u of updates){
    await query('UPDATE toc SET ? WHERE id=?',[u.headingFields,u.heading.id]);
    await query('UPDATE hadiths SET ? WHERE id=?',[u.fields,u.row.id]);
    await query('UPDATE yqsirah_source_entries SET source_json=?,content_sha256=? WHERE book_id=? AND item_id=?',[JSON.stringify(u.metadata),u.sha,book.id,u.row.id]);
   }
   const stored=await query('SELECT * FROM hadiths WHERE bookId=? ORDER BY ordinal',[book.id]);
   assert.equal(stored.length,rows.length);
   for(let i=0;i<stored.length;i++)assert.equal(prose(stored[i]),prose(rows[i]),`Changed prose or identity: ${rows[i].num}`);
   const actual=await query('SELECT * FROM toc WHERE bookId=? ORDER BY ordinal',[book.id]);
   const byId=new Map(actual.map(t=>[t.id,t]));
   for(const u of updates)for(const [key,value] of Object.entries(u.headingFields))assert.equal(String(byId.get(u.heading.id)[key]),String(value),`Heading ${u.heading.id} ${key}`);
  }
  await query(apply?'COMMIT':'ROLLBACK');
  console.log(JSON.stringify({applied:apply,changed:updates.length,h2:manifest.chapters.reduce((n,c)=>n+c.starts.length,0),h3:1023-manifest.chapters.reduce((n,c)=>n+c.starts.length,0),preservedTitles,backup,revision}));
 }catch(error){await query('ROLLBACK').catch(()=>{});throw error;}finally{db.destroy();}
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
