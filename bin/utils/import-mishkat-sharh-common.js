'use strict';
const fs=require('fs'),path=require('path');
module.exports=async function run(options){
const {extract,planImport,SOURCE}=options;
async function main() {
  require('dotenv').config();
  const mysql=require('mysql'), {promisify}=require('util');
  const db=mysql.createConnection(require('../initializeHadithAttributions').connectionSettings()), query=promisify(db.query).bind(db);
  const dir=path.resolve(options.auditDir); fs.mkdirSync(dir,{recursive:true});
  const source=extract(path.resolve(options.epub));
  let sourceId;
  try {
    const [book]=await query('SELECT id,alias,`virtual` FROM books WHERE id=100419');
    if(book?.alias!=='mishkat' || Number(book.virtual)!==1) throw Error('Target Mishkat book identity changed');
    const virtual=await query('SELECT * FROM hadiths_virtual WHERE bookId=100419 ORDER BY ordinal');
    const toc=await query('SELECT * FROM toc WHERE bookId=100419 ORDER BY ordinal');
    const plan=planImport(source,virtual,toc);
    const summary={epubSha256:source.sha256,pages:source.pages,hadithLinks:plan.entries.length,headingPassages:plan.headings.length,missing:plan.missing,textConservation:true};
    fs.writeFileSync(path.join(dir,'plan.json'),JSON.stringify(plan));
    fs.writeFileSync(path.join(dir,'validated.json'),JSON.stringify(summary,null,2)); console.log({...summary,missing:undefined,missingCount:summary.missing.length});
    if (!process.argv.includes('--apply') && !process.argv.includes('--refresh')) return;
    if (process.argv.includes('--apply')) {
      await require('../../lib/HadithHeadingSharh').ensureSchema(query);
      await require('../../lib/VirtualHadithSharh').ensureSchema(query);
      if (Number((await query('SELECT GET_LOCK(?,30) locked',[options.lock]))[0].locked)!==1) throw Error('Import already running');
      await query('START TRANSACTION');
      try {
        // Same book-first lock order as the editor; the plan must survive concurrent edits.
        await query('SELECT id FROM books WHERE id=100419 FOR UPDATE');
        const locked=await query('SELECT * FROM hadiths_virtual WHERE bookId=100419 ORDER BY ordinal FOR UPDATE');
        const lockedToc=await query('SELECT * FROM toc WHERE bookId=100419 ORDER BY ordinal FOR UPDATE');
        const fresh=planImport(source,locked,lockedToc);
        if (JSON.stringify(fresh)!==JSON.stringify(plan)) throw Error('Mishkat changed during planning; rerun');
        let [ss]=await query('SELECT * FROM hdith_sharh_sources WHERE source_book_id=? FOR UPDATE',[SOURCE.bookId]);
        if(ss && ss.author!==SOURCE.author) throw Error('Source namespace belongs to another author');
        const before=ss?await query('SELECT * FROM hdith_hadith_sharh WHERE source_id=?',[ss.id]):[];
        const beforeHeadings=ss?await query('SELECT * FROM hdith_toc_sharh WHERE source_id=?',[ss.id]):[];
        const beforeLinks=ss?await query('SELECT vl.* FROM hdith_virtual_sharh_links vl JOIN hdith_hadith_sharh hs ON hs.id=vl.sharh_id WHERE hs.source_id=?',[ss.id]):[];
        fs.writeFileSync(path.join(dir,`backup-${Date.now()}.json`),JSON.stringify({ss,before,beforeHeadings,beforeLinks,virtual:locked,toc:lockedToc}));
        if(!ss){const inserted=await query('INSERT INTO hdith_sharh_sources (source_book_id,title,title_en,author,source_url) VALUES (?,?,?,?,?)',[SOURCE.bookId,SOURCE.title,SOURCE.titleEn,SOURCE.author,'']); ss={id:inserted.insertId};}
        sourceId=ss.id;
        const existing=new Map(before.map(r=>[r.source_entry_id,r]));
        const existingLinks=new Map(beforeLinks.map(r=>[r.sharh_id,r]));
        if (existing.size!==before.length || existingLinks.size!==before.length) throw Error('Existing source ownership is inconsistent');
        const newEntries=[];
        for(const e of plan.entries){
          const old=existing.get(e.sourceEntryId);
          if(old){if(old.text!==e.text || old.hadith_id!==e.hadithId || existingLinks.get(old.id)?.virtual_id!==e.virtualId || existingLinks.get(old.id)?.source_number!==e.number) throw Error(`Existing commentary differs: ${e.num}`);
            if(old.page_num!==e.page) await query('UPDATE hdith_hadith_sharh SET page_num=?,chapter=? WHERE id=?',[e.page,`مشكاة المصابيح: ${e.num} • ج ${e.volume}`,old.id]);
          }
          else newEntries.push(e);
        }
        for(let offset=0;offset<newEntries.length;offset+=100){
          const batch=newEntries.slice(offset,offset+100);
          await query(`INSERT INTO hdith_hadith_sharh (hadith_id,ordinal,source_id,source_entry_id,page_num,chapter,title,title_en,text,format,source_url) VALUES ?`,[batch.map(e=>[e.hadithId,e.number,sourceId,e.sourceEntryId,e.page,`مشكاة المصابيح: ${e.num} • ج ${e.volume}`,SOURCE.title,SOURCE.titleEn,e.text,'md',''])]);
          const saved=await query('SELECT id,source_entry_id FROM hdith_hadith_sharh WHERE source_id=? AND source_entry_id IN (?)',[sourceId,batch.map(e=>e.sourceEntryId)]);
          const ids=new Map(saved.map(r=>[r.source_entry_id,r.id]));
          await query('INSERT INTO hdith_virtual_sharh_links (sharh_id,virtual_id,source_number) VALUES ?',[batch.map(e=>[ids.get(e.sourceEntryId),e.virtualId,e.number])]);
          console.log(`Stored ${offset+batch.length}/${newEntries.length} new commentary links`);
        }
        const oldHeads=new Map(beforeHeadings.map(r=>[`${r.toc_id}:${r.source_entry_id}`,r])),newHeads=[];
        for(const h of plan.headings){
          const old=oldHeads.get(`${h.tocId}:${h.sourceEntryId}`);
          if(old){if(old.text!==h.text)throw Error(`Existing chapter commentary differs: ${h.file}`);}
          else newHeads.push(h);
        }
        for(let offset=0;offset<newHeads.length;offset+=100) await query(`INSERT INTO hdith_toc_sharh (toc_id,ordinal,source_id,source_entry_id,page_num,title,title_en,text,format,source_url) VALUES ?`,[newHeads.slice(offset,offset+100).map(h=>[h.tocId,1,sourceId,h.sourceEntryId,h.page,SOURCE.title,SOURCE.titleEn,h.text,'md',''])]);
        const stored=await query('SELECT hs.*,vl.virtual_id FROM hdith_hadith_sharh hs JOIN hdith_virtual_sharh_links vl ON vl.sharh_id=hs.id WHERE hs.source_id=?',[sourceId]);
        const heads=await query('SELECT * FROM hdith_toc_sharh WHERE source_id=?',[sourceId]);
        const indexed=new Map(stored.map(r=>[r.virtual_id,r]));
        if(stored.length!==plan.entries.length || heads.length!==plan.headings.length || plan.entries.some(e=>indexed.get(e.virtualId)?.text!==e.text || indexed.get(e.virtualId)?.hadith_id!==e.hadithId || indexed.get(e.virtualId)?.page_num!==e.page) || plan.headings.some(h=>!heads.some(r=>r.toc_id===h.tocId&&r.source_entry_id===h.sourceEntryId&&r.text===h.text))) throw Error('Exact readback failed');
        await query(`UPDATE books SET content_lastmod=CURRENT_TIMESTAMP() WHERE id=100419 OR id IN (SELECT h.bookId FROM hdith_hadith_sharh hs JOIN hadiths h ON h.id=hs.hadith_id WHERE hs.source_id=?)`,[sourceId]);
        await query('COMMIT');
        fs.writeFileSync(path.join(dir,'applied.json'),JSON.stringify({...summary,sourceId,exactReadback:true,appliedAt:new Date().toISOString()},null,2));
        console.log(`Imported/verified ${stored.length} links and ${heads.length} heading passages, source ${sourceId}`);
      } catch(error){await query('ROLLBACK');throw error;}
      finally{await query('SELECT RELEASE_LOCK(?)',[options.lock]);}
    } else sourceId=(await query('SELECT id FROM hdith_sharh_sources WHERE source_book_id=?',[SOURCE.bookId]))[0]?.id;
  } finally {db.end();}
  if(sourceId && !process.argv.includes('--skip-refresh')) await refresh(sourceId);
}
async function refresh(sourceId) {
  require('../../lib/Globals');
  const mysql=require('mysql'),{promisify}=require('util');
  try {
    console.log(await require('../../lib/SharhBooks').sync());
    const [book]=await global.query(mysql.format("SELECT b.id,b.alias FROM books b JOIN sharh_book_mappings m ON m.book_id=b.id WHERE m.source_id=? AND m.source_title=''",[sourceId]));
    if(!book)throw Error('Catalog source missing');
    if(book.alias===`sharh-${book.id}`) await global.query(mysql.format("UPDATE books SET alias=?,lang='ar',author_en=? WHERE id=?",[options.alias,options.authorEn,book.id]));
    const index=require('../../lib/HadithSharhIndex');await index.ensureIndex();
    let after=0,count=0;
    while(true){const docs=await index.documents(`hs.source_id=${Number(sourceId)} AND hs.id>${after}`,100);if(!docs.length)break;await index.writeBatch(docs);after=docs.at(-1).id;count+=docs.length;}
    const [{total}]=await global.query(`SELECT COUNT(*) total FROM hdith_hadith_sharh WHERE source_id=${Number(sourceId)}`);
    if(count!==Number(total))throw Error(`Sharh index projection count mismatch: ${count}/${total}`);
    await require('axios').post(`${global.settings.search.domain}/sharhs/_refresh`,null,require('../../lib/SearchHttp').axiosConfig());
    const Index=require('../../lib/Index');
    const headings=await global.query('SELECT * FROM v_toc WHERE book_id=100419');
    await Index.updateBulk('toc',headings);await Index.refresh('toc');
    const affected=await global.query(`SELECT DISTINCT h.id,b.alias FROM hdith_hadith_sharh hs JOIN hadiths h ON h.id=hs.hadith_id JOIN books b ON b.id=h.bookId WHERE hs.source_id=${Number(sourceId)}`);
    const {execFile}=require('child_process');
    for(let offset=0;offset<affected.length;offset+=500){
      const result=await promisify(execFile)(process.execPath,['bin/indexEnrichedHadithBatch.js',...affected.slice(offset,offset+500).map(r=>String(r.id))],{cwd:path.resolve(__dirname,'../..'),maxBuffer:1024*1024});
      console.log(result.stdout.trim());
    }
    await Index.refresh('hadiths');
    for(const alias of new Set(['mishkat',...affected.map(r=>r.alias)])) await require('../../lib/Utils').flushBookDiskCache(alias);

    await require('../../lib/RuntimeRefresh').publish();
    console.log(`Indexed ${count} commentary links; refreshed Mishkat TOC, cache and runtime catalog.`);
  } finally {await promisify(global.dbPool.end).call(global.dbPool);}
}

await main();
};
