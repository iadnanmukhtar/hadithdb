#!/usr/bin/env node
'use strict';
const normalizeStoredHonorifics = require('./normalize-commentary-honorifics').normalize;
const fs=require('fs'),crypto=require('crypto'),AdmZip=require('adm-zip'),cheerio=require('cheerio');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const clean=s=>s.replace(/\u00a0/g,' ').replace(/[ \t]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim();
const SOURCE={bookId:-11,title:'مرعاة المفاتيح (المباركفوري)',titleEn:'Mirʿāt al-Mafātīḥ (al-Mubārakfūrī)',author:'عبيد الله الرحماني المباركفوري'};
function extract(filename) {
 const bytes=fs.readFileSync(filename),zip=new AdmZip(bytes),review=require('./miraat-alignment.json');
 if(sha(bytes)!==review.epubSha256)throw Error('EPUB differs from the reviewed edition');
 const opf=cheerio.load(zip.readAsText('OEBPS/content.opf'),{xmlMode:true});
 if(opf('dc\\:title').text()!=='مرعاة المفاتيح شرح مشكاة المصابيح'||opf('dc\\:creator').text()!==SOURCE.author)throw Error('Wrong source book');
 const manifest=new Map(opf('manifest item').toArray().map(e=>[opf(e).attr('id'),opf(e).attr('href')]));
 const spine=opf('spine itemref').toArray().map(e=>manifest.get(opf(e).attr('idref'))).filter(s=>/^xhtml\/P\d+\.xhtml$/.test(s));
 const pages=spine.map(href=>{const $=cheerio.load(zip.readAsText('OEBPS/'+href)),body=$('#book-container');body.find('br').replaceWith('\n');const matn=clean(body.find('.matn').text()),footer=$('.center').text();body.find('.matn,.matn-hr,hr,a').remove();return {file:+href.match(/P(\d+)/)[1],volume:+(footer.match(/الجزء:\s*(\d+)/)?.[1]||0),page:+(footer.match(/الصفحة:\s*(\d+)/)?.[1]||0),matn,comment:clean(body.text())};});
 const parsed={};
 for(const field of ['matn','comment']){
  const segments=[];let current;
  for(const p of pages){
   if(p.file<3)continue; // Bibliographic card and title leaf are source metadata.
   if(p.file===366||p.file===411)current=null;
   if(!current){current={kind:'heading',title:p.file===366?'ملحقات الجزء الأول':'مقدمة المؤلف',file:p.file,volume:p.volume,page:p.page,numbers:[],text:''};segments.push(current);}
   let anchors=[];
   if(p.file<366||p.file>410){
    const re=/(?:^|\n)\s*\(?(\d+(?:(?:\s*[،,]\s*|\s*-\s*(?=\d))\d+)*)(?: وغيره)?\)?\s*[،,]?\s*[-–—ـ_]+/g;
    for(const m of p[field].matchAll(re)){
     let numbers=m[1].match(/\d+/g).map(Number);
     if(field==='comment'&&numbers[0]<=20&&p.file>=100)continue;
     if(p.file===482&&field==='matn'&&m[1]==='370-372')numbers=[370,371,372];
     if(p.file===829&&field==='matn'&&numbers[0]===716&&anchors.some(a=>a.numbers.includes(716)))numbers=[717];
     else {const correction=review.corrections[field][p.file]?.[numbers[0]];if(correction&&!anchors.some(a=>a.correctedFrom===numbers[0])){anchors.push({offset:m.index+m[0].search(/\(?\d/),numbers:[correction],correctedFrom:numbers[0]});continue;}}
     anchors.push({offset:m.index+m[0].search(/\(?\d/),numbers});
    }
    for(const extra of review.extraAnchors.filter(a=>a.field===field&&a.file===p.file)){
     const offset=p[field].indexOf(extra.witness);if(offset<0||p[field].indexOf(extra.witness,offset+1)>=0)throw Error(`Changed anchor ${field}:${p.file}`);
     anchors.push({offset,numbers:extra.numbers});
    }
   }
   if(field==='comment')for(const h of review.headingAnchors.filter(h=>h.file===p.file)){
    const offset=p.comment.indexOf(h.witness);if(offset<0||p.comment.indexOf(h.witness,offset+1)>=0)throw Error(`Changed heading ${p.file}`);
    anchors.push({offset,numbers:[],kind:'heading',title:h.title,level:h.level});
   }
   anchors.sort((a,b)=>a.offset-b.offset);let pos=0;
   for(const a of anchors){current.text+='\n\n'+p[field].slice(pos,a.offset);current={kind:a.kind||'hadith',title:a.title,level:a.level,file:p.file,page:p.page,volume:p.volume,numbers:a.numbers,text:''};segments.push(current);pos=a.offset;}
   current.text+='\n\n'+p[field].slice(pos);
  }
  parsed[field]=segments.map(s=>({...s,text:clean(s.text)})).filter(s=>s.text);
  if(parsed[field].map(s=>s.text).join('').replace(/\s/g,'')!==pages.filter(p=>p.file>=3).map(p=>p[field]).join('').replace(/\s/g,''))throw Error(`${field} conservation failed`);
 }
 return {sha256:sha(bytes),pages:pages.length,segments:parsed.comment,entries:parsed.comment.filter(s=>s.kind==='hadith'),quoted:parsed.matn,pageData:pages};
}
module.exports={extract,SOURCE,sha};
function planImport(source,virtual,toc){
 const review=require('./miraat-alignment.json'),byNumber=new Map();
 for(const v of virtual){if(!/^\d+[a-z]?$/.test(v.num)||!v.hadithId||Number(v.bookId)!==100419)throw Error(`Unexpected Mishkat entry ${v.id}`);const n=parseInt(v.num);if(!byNumber.has(n))byNumber.set(n,[]);byNumber.get(n).push(v);}
 const entries=new Map(),headings=[];
 const targets=s=>[...new Set(s.numbers.flatMap(n=>{if(!review.mappings[n])throw Error(`Unreviewed source number ${n}`);return review.mappings[n];}))];
 for(let i=0;i<source.segments.length;i++){
  const s=source.segments[i];
  if(s.kind==='hadith')for(const n of targets(s)){
   if(!byNumber.has(n))throw Error(`No Mishkat reference ${n}`);
   for(const v of byNumber.get(n)){
    if(!entries.has(v.id))entries.set(v.id,{virtualId:v.id,hadithId:v.hadithId,num:v.num,number:n,sourceEntryId:-11000000-v.id,page:s.page,volume:s.volume,text:[],files:[],sourceNumbers:[]});
    const e=entries.get(v.id);e.text.push(s.text);e.files.push(s.file);e.sourceNumbers.push(...s.numbers);
   }
  }else{
   if(require('../../lib/SharhHeadingContent').isMishkatHeadingOnly('miraat',s))continue;
   const target=review.headingTargets[`${s.file}:${s.level||2}`];
   if(!target)throw Error(`Unreviewed heading ${s.file}`);
   const candidates=toc.filter(t=>t.id===target.tocId&&Number(t.bookId)===100419&&t.level===target.level&&t.h1===target.h1&&t.h2===target.h2&&t.h3===target.h3);
   if(candidates.length!==1)throw Error(`Heading identity changed: ${s.file}`);
   const level=s.level||2;
   headings.push({...s,tocId:candidates[0].id,sourceEntryId:-11000000-s.file*10-level});
  }
 }
 const covered=new Set([...entries.values()].map(e=>e.number)),missing=[...byNumber.keys()].filter(n=>!covered.has(n)).sort((a,b)=>a-b);
 return {entries:[...entries.values()].map(e=>({...e,sourceNumbers:[...new Set(e.sourceNumbers)],text:normalizeStoredHonorifics(e.text.join('\n\n'))})),headings:headings.map(h=>({...h,text:normalizeStoredHonorifics(h.text)})),missing};
}
module.exports.planImport=planImport;

if(require.main===module)require('./import-mishkat-sharh-common')({
 extract,planImport,SOURCE,epub:'temp/miraat/miraat.epub',auditDir:'temp/miraat/audit',
 lock:'import-miraat',alias:'mishkat-miraat',authorEn:'ʿUbayd Allāh al-Raḥmānī al-Mubārakfūrī'
}).catch(e=>{console.error(e.stack);process.exitCode=1;});
