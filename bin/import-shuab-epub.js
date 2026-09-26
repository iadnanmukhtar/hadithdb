#!/usr/bin/env node
'use strict';
const fs = require('fs');
const crypto = require('crypto');
const Zip = require('adm-zip');
const cheerio = require('cheerio');
const zlib = require('zlib');
const SOURCE = 'temp/shuab/shuab.epub';
const SOURCE_SHA256 = '13b9d90b031331db484b04541008b2ab3cc49756f7925229ac36a3a1a58386be';
const norm = s => s.normalize('NFD').replace(/[\u064b-\u065f\u0670ـ\s\p{P}\p{S}]/gu, '');
const clean = s => s.replace(/[\t\r ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
function parse() {
 if(sha(fs.readFileSync(SOURCE))!==SOURCE_SHA256)throw Error('Source edition changed; review chapter alignment before import');
 const zip = new Zip(SOURCE), opf = cheerio.load(zip.readAsText('OEBPS/content.opf'), {xmlMode:true});
 const manifest = new Map(opf('manifest item').toArray().map(e=>[opf(e).attr('id'),opf(e).attr('href')]));
 const files = opf('spine itemref').toArray().map(e=>'OEBPS/'+manifest.get(opf(e).attr('idref'))).filter(f=>/\/P\d+\.xhtml$/.test(f));
 const pages = files.map(file=>{const $=cheerio.load(zip.readAsText(file));$('#book-container br').replaceWith('\n');return {file, page:Number(file.match(/P(\d+)/)[1]), text:clean($('#book-container').text()), html:$('#book-container').html(), footer:$('.center').text()};});
 const byPage=new Map(pages.map(p=>[p.page,p]));
 const ncx=cheerio.load(zip.readAsText('OEBPS/toc.ncx'),{xmlMode:true});
 let h1=-1,h2=null,h3=null;
 const headings=ncx('navPoint').toArray().map(e=>({key:ncx(e).children('content').attr('src').split('#')[1],title:ncx(e).children('navLabel').text(),target:Number(ncx(e).children('content').attr('src').match(/P(\d+)/)?.[1]),level:ncx(e).parents('navPoint').length+1})).filter(h=>h.key).map(h=>{
  if(h.level===1){h1++;h2=null;h3=null;}else if(h.level===2){h2=(h2||0)+1;h3=null;}else h3=(h3||0)+1;
  let candidates=pages.filter(p=>Math.abs(p.page-h.target)<120&&norm(p.text).startsWith(norm(h.title)));
  let p;
  if(h.level===1&&h1>0){
   // This edition's navigation anchors are generally seven XHTML files late.
   // Match the authored branch heading, including headings split across pages.
   candidates=pages.filter(p=>Math.abs(p.page-(h.target-7))<=2&&!/^\d/.test(p.text)&&/شعبالايمان/.test(norm(p.text.slice(0,180))));
   p=candidates.length===1?candidates[0]:byPage.get(h.target-7);
   if(h1===43)p=byPage.get(6714);
   if(!/شعبالايمان|باب/.test(norm(p.text.slice(0,200))))throw Error('Invalid main heading '+h.key);
  }else if(candidates.length===1)p=candidates[0];
  else if(candidates.some(p=>p.page===h.target-7))p=byPage.get(h.target-7);
  else if(['C34','C414'].includes(h.key))p=byPage.get(h.target-7);
  else throw Error('Ambiguous heading '+h.key);
  return {...h,h1,h2,h3,page:p.page,witness:p.text.slice(0,600),intro:'',sources:[]};
 });
 for(let i=1;i<headings.length;i++)if(headings[i].page<=headings[i-1].page)throw Error('Heading order '+headings[i].key);
 const start=new Map(headings.map(h=>[h.page,h]));let current=null,last=null;const entries=[];const pageAudit=[];
 for(const p of pages){
  if(p.page===1)continue;
  if(start.has(p.page)){current=start.get(p.page);last=null;}
  if(!current){if(p.text)throw Error('Unassigned page '+p.file);continue;}
  const $=cheerio.load('<div id="content">'+p.html+'</div>'),b=$('#content');
  b.find('a,hr,.footnote-hr').remove();
  b.find('span.title').each((i,e)=>{if(/^\[ص:/.test($(e).text()))$(e).remove();});
  b.find('span.red').each((i,e)=>{const m=$(e).text().match(/^\s*(\d+)\s*-\s*(?:-\s*)?$/);if(m)$(e).replaceWith(`\n@@HADITH:${m[1]}@@\n`);});
  b.find('.footnote').each((i,e)=>$(e).replaceWith('\n@@NOTE@@'+$(e).text()+'@@ENDNOTE@@\n'));
  const text=clean(b.text());const pieces=text.split(/@@HADITH:(\d+)@@/);
  const add=(target,s)=>{let notes=[];s=s.replace(/@@NOTE@@([\s\S]*?)@@ENDNOTE@@/g,(_,x)=>{notes.push(clean(x));return '';});s=clean(s);if(s)target[target.number?'text':'intro']+=(target[target.number?'text':'intro']?'\n\n':'')+s;if(notes.length)target.footnote=[target.footnote,...notes].filter(Boolean).join('\n\n');if(s||notes.length)target.sources.push({file:p.file,footer:p.footer});};
  add(last||current,pieces[0]);
  for(let i=1;i<pieces.length;i+=2){last={number:Number(pieces[i]),headingKey:current.key,text:'',footnote:'',sources:[]};entries.push(last);add(last,pieces[i+1]);}
  pageAudit.push({file:p.file,headingKey:current.key,markers:(pieces.length-1)/2,nonempty:!!text});
 }
 // Branch 48 begins in the final line of P7463, after report 6936.
 // Its actual exposition continues on P7464; keep the split title out of the report.
 const splitReport=entries.find(e=>e.number===6936),splitHeading=headings.find(h=>h.h1===48&&h.level===1);
 const splitTitle='الثَّامِنُ وَالْأَرْبَعُونَ مِنْ شُعَبِ الْإِيمَانِ وَهُوَ';
 if(!splitReport.text.endsWith(splitTitle))throw Error('Split branch 48 title changed');
 splitReport.text=splitReport.text.slice(0,-splitTitle.length).trim();
 splitHeading.intro=splitTitle+'\n\n'+splitHeading.intro;
 splitHeading.sources.unshift(splitReport.sources.at(-1));
 const counts=new Map();for(const e of entries)counts.set(e.number,(counts.get(e.number)||0)+1);
 const seen=new Map();for(const [i,e]of entries.entries()){const n=(seen.get(e.number)||0)+1;seen.set(e.number,n);e.ordinal=i+1;e.num=String(e.number)+(counts.get(e.number)>1?String.fromCharCode(96+n):'');e.num0=e.number+(counts.get(e.number)>1?n/1000:0);if(!e.text)throw Error('Empty report '+e.num);}
 const missing=Array.from({length:10756},(_,i)=>i+1).filter(n=>!counts.has(n));
 if(entries.length!==10725||headings.length!==421||h1!==77||missing.length!==46)throw Error('Source coverage changed');
 return {source:SOURCE,sha256:sha(fs.readFileSync(SOURCE)),metadata:pages[0].text,headings,entries,pageAudit,stats:{pages:pages.length,headings:headings.length,chapters:h1,entries:entries.length,missing,duplicates:[...counts].filter(x=>x[1]>1)}};
}
async function main(){
 const data=parse();fs.writeFileSync('temp/shuab/parsed.json',JSON.stringify(data,null,2));console.log(JSON.stringify(data.stats));
 if(!process.argv.includes('--apply')&&!process.argv.includes('--verify'))return;
 require('dotenv').config();const mysql=require('mysql'),util=require('util'),Utils=require('../lib/Utils');
 const db=mysql.createConnection(require('./initializeHadithAttributions').connectionSettings()),q=util.promisify(db.query).bind(db);
 try{
 const existing=(await q("SELECT * FROM books WHERE alias='shuab'"))[0];
 const normalize=s=>Utils.normalizeArabicHonorifics(s||'');
 async function verify(bookId){
  const hs=await q('SELECT * FROM hadiths WHERE bookId=? ORDER BY ordinal',[bookId]);
  const ts=await q('SELECT * FROM toc WHERE bookId=? ORDER BY ordinal',[bookId]);
  if(hs.length!==data.entries.length||ts.length!==data.headings.length)throw Error('Readback counts differ');
  const headingIds=new Map(ts.map((t,i)=>[data.headings[i].key,t.id]));
  hs.forEach((h,i)=>{const e=data.entries[i];if(h.num!==e.num||h.text!==normalize(e.text)||h.footnote!==(normalize(e.footnote)||null)||h.tocId!==headingIds.get(e.headingKey))throw Error('Readback differs '+e.num);});
  ts.forEach((t,i)=>{if(t.intro!==(normalize(data.headings[i].intro)||null))throw Error('Intro differs '+t.id);});
  return {bookId,entries:hs.length,headings:ts.length,verified:true};
 }
 if(existing){const props=typeof existing.properties==='string'?JSON.parse(existing.properties):existing.properties;if(props?.shuabImport?.sha256!==data.sha256)throw Error('Existing book differs; refusing replacement');console.log(JSON.stringify({...await verify(existing.id),unchanged:true}));return;}
 if(process.argv.includes('--verify'))throw Error('Book not imported');
 fs.writeFileSync('temp/shuab/before-import.json',JSON.stringify({books:[],hadiths:[],toc:[],sourceSha256:data.sha256}));
 await q('START TRANSACTION');
 try{
 const bookId=Number((await q('SELECT MAX(id)+1 id FROM books'))[0].id);
 await q('INSERT INTO books SET ?',{id:bookId,ordinal:Math.max(52,Number((await q("SELECT MAX(ordinal)+1 n FROM books WHERE type='hadith'"))[0].n)),alias:'shuab',type:'hadith',source:'shamela-epub',lang:'ar',size:'lg',shortName:'شعب الإيمان',shortName_en:'Shuab al-Iman',name:'شُعَبُ الْإِيمَانِ',name_en:'Shuab al-Iman',title:'شعب الإيمان',title_en:'Shuab al-Iman',author:'أحمد بن الحسين بن علي بن موسى، أبو بكر البيهقي',author_en:'Abu Bakr al-Bayhaqi',death:458,publisher:'مكتبة الرشد للنشر والتوزيع بالرياض بالتعاون مع الدار السلفية ببومباي بالهند',published_year:2003,format:'md',description:data.metadata,properties:JSON.stringify({shuabImport:{sha256:data.sha256,...data.stats}})});
 const ids=new Map(),base=Number((await q('SELECT MAX(ordinal)+1 n FROM toc'))[0].n);
 for(const [i,h]of data.headings.entries()){
  const members=data.entries.filter(e=>{const t=data.headings.find(x=>x.key===e.headingKey);return t.h1===h.h1&&(h.level===1||t.h2===h.h2&&(h.level===2||t.h3===h.h3));});
  const result=await q('INSERT INTO toc SET ?',{bookId,ordinal:base+i,level:h.level,h1:h.h1,h2:h.h2,h3:h.h3,title:normalize(h.title),intro:normalize(h.intro)||null,start:members[0]?.num||null,end:members.at(-1)?.num||null,start0:members[0]?.num0??null,end0:members.at(-1)?.num0??null,count:members.length,lastmod_user:'epub:shuab'});ids.set(h.key,result.insertId);
 }
 const hm=new Map(data.headings.map(h=>[h.key,h])),chapterCounts=new Map();
 const columns=['ordinal','bookId','tocId','numInChapter','h1','h2','h3','num','numActual','num0','gradeText','text','body','footnote','lastmod_user'];
 const rows=data.entries.map(e=>{const h=hm.get(e.headingKey),n=(chapterCounts.get(h.key)||0)+1;chapterCounts.set(h.key,n);return [e.ordinal,bookId,ids.get(h.key),n,h.h1,h.h2,h.h3,e.num,String(e.number),e.num0,'No Grade',normalize(e.text),normalize(e.text),normalize(e.footnote)||null,'epub:shuab'];});
 // MySQL UNCOMPRESS accepts a little-endian original-size prefix plus zlib.
 // Compressing UTF-8 JSON avoids sending duplicated long Arabic text uncompressed.
 for(let i=0;i<rows.length;i+=300){
  const raw=Buffer.from(JSON.stringify(rows.slice(i,i+300))),size=Buffer.alloc(4);size.writeUInt32LE(raw.length);
  const packed=Buffer.concat([size,zlib.deflateSync(raw)]).toString('base64');
  const numeric=new Set(['ordinal','bookId','tocId','numInChapter','h1','h2','h3','num0']);
  const fields=columns.map((name,j)=>'`'+name+'` '+(numeric.has(name)?'DECIMAL(12,3)':'LONGTEXT')+` PATH '$[${j}]'`).join(',');
  await q('INSERT INTO hadiths (`'+columns.join('`,`')+'`) SELECT '+columns.map(n=>'`'+n+'`').join(',')+" FROM JSON_TABLE(CONVERT(UNCOMPRESS(FROM_BASE64(?)) USING utf8mb4), '$[*]' COLUMNS ("+fields+')) source_rows',[packed]);
  console.log(`Inserted ${Math.min(i+300,rows.length)}/${rows.length} reports`);
 }
 const audit=await verify(bookId);await q('COMMIT');fs.writeFileSync('temp/shuab/applied.json',JSON.stringify({...audit,sha256:data.sha256,stats:data.stats},null,2));console.log(JSON.stringify(audit));
 }catch(e){await q('ROLLBACK');throw e;}
 }finally{db.end();}
}
module.exports={parse,norm};
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});
