#!/usr/bin/env node
'use strict';
const normalizeStoredHonorifics = require('./normalize-commentary-honorifics').normalize;
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const cheerio = require('cheerio');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const clean = s => s.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
const SOURCE = { bookId: -10, title: 'مرقاة المفاتيح (الملا علي قاري)', titleEn: 'Mirqāt al-Mafātīḥ (al-Mullā ʿAlī Qārī)', author: 'علي بن سلطان محمد القاري' };
function extract(filename, options = {}) {
  const bytes = fs.readFileSync(filename), zip = new AdmZip(bytes);
  if (sha(bytes) !== '66cb7a5baed7c77902ae3fe3e4198eaac15c9ae96aef450c13121e0f208ac88d') throw Error('EPUB differs from the reviewed edition');
  const opf = cheerio.load(zip.readAsText('OEBPS/content.opf'), { xmlMode: true });
  if (opf('dc\\:title').text() !== 'مرقاة المفاتيح شرح مشكاة المصابيح') throw Error('Wrong book');
  const manifest = new Map(opf('manifest item').toArray().map(e => [opf(e).attr('id'), opf(e).attr('href')]));
  const spine = opf('spine itemref').toArray().map(e => manifest.get(opf(e).attr('idref'))).filter(s => /^xhtml\/P\d+\.xhtml$/.test(s));
  const ncx = cheerio.load(zip.readAsText('OEBPS/toc.ncx'), { xmlMode: true }), headings = new Map();
  ncx('navPoint').each((i,e) => { const href = ncx(e).children('content').attr('src'); if (href?.includes('/P')) headings.set(href.split('#')[0], clean(ncx(e).children('navLabel').text())); });
  const segments = [], retained = [], starts = [], pages = [];
  let current, pending;
  function start(kind, page, extra = {}) { current = { kind, file: page.file, volume: page.volume, page: page.page, text: '', ...extra }; segments.push(current); }
  function append(text) { if (text) current.text += '\n\n' + text; }
  for (const href of spine) {
    const $ = cheerio.load(zip.readAsText('OEBPS/' + href)), body = $('#book-container'), footer = $('.center').text();
    const p = { file: Number(href.match(/P(\d+)/)[1]), volume: Number(footer.match(/الجزء:\s*(\d+)/)?.[1]), page: Number(footer.match(/الصفحة:\s*(\d+)/)?.[1]) };
    if (!p.volume || !p.page) throw Error(`Missing locator ${href}`);
    const number = Number(footer.match(/الحديث:\s*(\d+)/)?.[1]);
    if (number) { if (pending) throw Error(`Unresolved number ${pending}`); pending = number; starts.push(number); }
    // The source explicitly marks the quoted Mishkat text; retain the commentary,
    // including its own inline quotations, headings, footnotes and colophon.
    body.find('.matn').remove(); body.find('.matn-hr,hr,a').remove(); body.find('br').replaceWith('\n');
    const text = clean(body.text()); retained.push(text); pages.push({...p,text});
    if (headings.has(href) && p.file !== 39) start('heading', p, { title: headings.get(href) });
    if (!current) start('heading', p, { title: 'مقدمة المؤلف' });
    const printed = p.file === 3384 ? 3367 : p.file === 7201 ? 3232 : pending;
    const match = pending && text.match(p.file === 4266 ? /(?:^|\n)(- \(عَنْ عَمْرِو)/ : new RegExp(`(?:^|\\s)(${printed}\\s*[-–])`));
    if (match) {
      const offset = match.index + match[0].indexOf(match[1]);
      const prefix = text.slice(0,offset).trim();
      if (current.kind === 'hadith' && /الفصل/.test(prefix.normalize('NFKD').replace(/[\u064b-\u065f]/g, '')) && prefix.length < 100) start('heading', p, { title: prefix, level: 3 });
      append(prefix);
      start('hadith', p, { number: pending }); pending = null;
      append(text.slice(offset));
    } else append(text);
  }
  if (pending) throw Error(`Unresolved final number ${pending}`);
  for (const s of segments) s.text = clean(s.text);
  const compact = s => s.replace(/\s/g, '');
  if (compact(segments.map(s=>s.text).join('')) !== compact(retained.join(''))) throw Error('Text conservation failed');
  const entries = segments.filter(s=>s.kind === 'hadith');
  if (entries.length !== starts.length || new Set(starts).size !== starts.length || entries.some((s,i)=>s.number !== starts[i])) throw Error('Number alignment failed');
  // Some numbered explanations lack EPUB footer metadata (and two are out of
  // order). Split only explicit paragraph starts near the surrounding number.
  const expanded = [];
  for (const segment of segments) {
    const nearby = segment.number || entries.filter(e=>e.file <= segment.file).at(-1)?.number;
    let active = { ...segment }, offset = 0;
    for (const m of segment.text.matchAll(/(?:^|\n)(\d+)\s*[-–]/g)) {
      const n = Number(m[1]);
      if (n < 100 || Math.abs(n - nearby) > 10 || n === active.number) continue;
      const at = m.index + m[0].indexOf(m[1]);
      active.text = segment.text.slice(offset, at).trim();
      if (active.text) expanded.push(active);
      const witness = segment.text.slice(at).split('\n')[0].slice(0,100);
      const locator = pages.find(p=>p.file>=segment.file && p.text.includes(witness));
      if (!locator) throw Error(`Missing source locator for ${n}`);
      active = { ...segment, file:locator.file, page:locator.page, volume:locator.volume, kind: 'hadith', number: n }; delete active.title;
      offset = at;
    }
    active.text = segment.text.slice(offset).trim();
    if (active.text) expanded.push(active);
  }
  // P50 prints hadith 2 before the chapter introduction, then P51 starts its
  // explanation. The footer's first number is not the commentary boundary.
  const faithIndex = expanded.findIndex(s=>s.kind==='hadith' && s.number===2);
  const faith = expanded[faithIndex];
  const faithStart = faith.text.indexOf('1 - كِتَابُ الْإِيمَانِ\nالْكِتَابُ إِمَّا');
  const faithEnd = faith.text.indexOf('الْفَصْلُ الْأَوَّلُ\n2 - (عَنْ عُمَرَ', faithStart);
  if (faithStart < 0 || faithEnd <= faithStart) throw Error('Faith introduction boundaries changed');
  expanded.splice(faithIndex, 1,
    {...faith,text:faith.text.slice(0,faithStart).trim()},
    {kind:'heading',file:50,page:50,volume:1,level:1,title:'كتاب الإيمان',text:faith.text.slice(faithStart,faithEnd).trim()},
    {...faith,file:51,page:51,text:faith.text.slice(faithEnd).trim()});
  const boundaries = options.legacyBoundaries ? {segments:expanded,moves:[],rejected:[]}
    : require('./mirqat-introduction-boundaries').splitIntroductions(expanded,pages,
      [...headings].map(([href,title])=>({file:Number(href.match(/P(\d+)/)[1]),title})));
  expanded.splice(0,expanded.length,...boundaries.segments);
  const finalEntries = expanded.filter(s=>s.kind === 'hadith');
  for (const s of finalEntries) {
    // Only explicitly co-numbered text is shared. Never infer coverage from a gap.
    const header = s.text.match(/^[\d\s,،و\u064b-\u065f-]+/)?.[0] || '';
    s.numbers = [...new Set([s.number, ...Array.from(header.matchAll(/\d+/g),m=>+m[0]).filter(n=>n>=s.number && n<=s.number+4)])];
  }
  // 1831 is explicitly numbered in the quoted matn on P2649; its explanation
  // is joined to 1830 inside the same parenthesis, so keep the shared passage.
  finalEntries.find(s=>s.number===1830).numbers.push(1831);
  if (compact(expanded.map(s=>s.text).join('')) !== compact(retained.join(''))) throw Error('Split conservation failed');
  return { sha256: sha(bytes), pages: spine.length, segments: expanded, entries: finalEntries,
    introductionAudit:{moves:boundaries.moves,rejected:boundaries.rejected} };

}
module.exports = { extract, SOURCE, sha };

function planImport(source, virtual, toc) {
  const byNumber = new Map();
  for (const row of virtual) {
    if (!/^\d+[a-z]?$/.test(row.num) || !row.hadithId || Number(row.bookId)!==100419) throw Error(`Unexpected Mishkat entry ${row.id}`);
    const n = Number(row.num.match(/^\d+/)[0]);
    if (!byNumber.has(n)) byNumber.set(n, []);
    byNumber.get(n).push(row);
  }
  const entries = new Map(), headings = [], unmapped = [];
  for (let i=0;i<source.segments.length;i++) {
    const s=source.segments[i];
    if (s.kind === 'hadith') {
      for (const n of s.numbers) {
        if (!byNumber.has(n)) throw Error(`No Mishkat reference ${n}`);
        for (const v of byNumber.get(n)) {
          if (!entries.has(v.id)) entries.set(v.id, {virtualId:v.id,hadithId:v.hadithId,num:v.num,number:n,sourceEntryId:-10000000-v.id, page:s.page,volume:s.volume,text:[],files:[]});
          const e=entries.get(v.id);e.text.push(s.text);e.files.push(s.file);
        }
      }
    } else {
      if (require('../../lib/SharhHeadingContent').isMishkatHeadingOnly('mirqat', s)) continue;
      const next=source.segments.slice(i+1).find(e=>e.kind==='hadith');
      const vs=byNumber.get(next?.number), v=vs?.[0];
      const level=s.file===1?2:s.level===3&&v?.h3==null?2:s.level || (/^\[?كتاب/.test(s.title)?1:2);
      let candidates=toc.filter(t=>s.file===1?t.h1===0&&t.level===2&&t.h2===0:
        t.level===level&&t.h1===v?.h1&&(level===1||t.h2===(s.sectionNumber&&level===2?s.sectionNumber:v?.h2))&&(level!==3||t.h3===(s.sectionNumber||v?.h3)));
      if (s.file !== 1 && s.level !== 3) {
        const norm = require('../import-mishkat-epub').norm;
        const titleKey = title => norm(title).replace(/^(?:كتاب|باب) /, '').trim();
        const exact = toc.filter(t=>t.h1===v?.h1 && t.level<=2 && titleKey(t.title)===titleKey(s.title));
        if (exact.length===1) candidates=exact;
        // Some source bab headings are top-level books in Mishkat. Their first
        // child is a section, not the destination for the chapter introduction.
        const headingKey=require('../../lib/SharhHeadingContent').normalize;
        if(candidates.length===1&&candidates[0].level===2&&/^(?:الصحاح|الحسان|الفصل (?:الاول|الثاني|الثالث))$/.test(headingKey(candidates[0].title)))
          candidates=toc.filter(t=>t.level===1&&t.h1===v?.h1);
      }
      if(candidates.length!==1){unmapped.push({file:s.file,title:s.title,next:next?.number,candidates:candidates.map(t=>t.id)});continue;}
      headings.push({...s,tocId:candidates[0].id,sourceEntryId:-10000000-s.file});
    }
  }
  if (unmapped.length) throw Error('Unmapped headings: '+JSON.stringify(unmapped));
  const missing=[...byNumber.keys()].filter(n=>!source.entries.some(e=>e.numbers.includes(n))).sort((a,b)=>a-b);
  return {entries:[...entries.values()].map(e=>({...e,text:normalizeStoredHonorifics(e.text.join('\n\n'))})),headings:headings.map(h=>({...h,text:normalizeStoredHonorifics(h.text)})),missing};
}
module.exports.planImport = planImport;

async function main() {
  require('dotenv').config();
  const mysql=require('mysql'), {promisify}=require('util');
  const db=mysql.createConnection(require('../initializeHadithAttributions').connectionSettings()), query=promisify(db.query).bind(db);
  const dir=path.resolve('temp/mirqat/audit'); fs.mkdirSync(dir,{recursive:true});
  const source=extract(path.resolve('temp/mirqat/mirqat.epub'));
  let sourceId;
  try {
    const [book]=await query('SELECT id,alias,`virtual` FROM books WHERE id=100419');
    if(book?.alias!=='mishkat' || Number(book.virtual)!==1) throw Error('Target Mishkat book identity changed');
    const virtual=await query('SELECT * FROM hadiths_virtual WHERE bookId=100419 ORDER BY ordinal');
    const toc=await query('SELECT * FROM toc WHERE bookId=100419 ORDER BY ordinal');
    const plan=planImport(source,virtual,toc);
    const summary={epubSha256:source.sha256,pages:source.pages,hadithLinks:plan.entries.length,headingPassages:plan.headings.length,missing:plan.missing,textConservation:true};
    fs.writeFileSync(path.join(dir,'plan.json'),JSON.stringify(plan));
    fs.writeFileSync(path.join(dir,'validated.json'),JSON.stringify(summary,null,2)); console.log(summary);
    if (!process.argv.includes('--apply') && !process.argv.includes('--refresh')) return;
    if (process.argv.includes('--apply')) {
      await require('../../lib/HadithHeadingSharh').ensureSchema(query);
      await require('../../lib/VirtualHadithSharh').ensureSchema(query);
      if (Number((await query("SELECT GET_LOCK('import-mirqat',30) locked"))[0].locked)!==1) throw Error('Import already running');
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
      finally{await query("SELECT RELEASE_LOCK('import-mirqat')");}
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
    if(book.alias===`sharh-${book.id}`) await global.query(mysql.format("UPDATE books SET alias='mishkat-mirqat',lang='ar',author_en='ʿAlī al-Qārī' WHERE id=?",[book.id]));
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
    console.log(`Indexed ${count} Mirqat links; refreshed Mishkat TOC, cache and runtime catalog.`);
  } finally {await promisify(global.dbPool.end).call(global.dbPool);}
}
module.exports.refresh=refresh;
if(require.main===module)main().catch(error=>{console.error(error.stack);process.exitCode=1;});
