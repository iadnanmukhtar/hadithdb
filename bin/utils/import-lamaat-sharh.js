#!/usr/bin/env node
'use strict';
const normalizeStoredHonorifics = require('./normalize-commentary-honorifics').normalize;
const fs=require('fs'),crypto=require('crypto'),AdmZip=require('adm-zip'),cheerio=require('cheerio');
const {isHeadingOnly}=require('../../lib/SharhHeadingContent');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const clean=s=>s.replace(/\u00a0/g,' ').replace(/[ \t]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim();
const norm=s=>String(s||'').normalize('NFKD').replace(/[\u064b-\u065f\u0670\u0640]/g,'').replace(/[أإآ]/g,'ا').replace(/[^\p{L}\s]/gu,' ').replace(/\s+/g,' ').trim();
const SOURCE={bookId:-12,title:'لمعات التنقيح (عبد الحق الدهلوي)',titleEn:'Lamaʿāt al-Tanqīḥ (ʿAbd al-Ḥaqq al-Dihlawī)',author:'عبد الحق بن سيف الدين الدهلوي'};
// Printed misnumbers checked against the quoted Mishkat text and surrounding numbers.
const corrections={315:{468:68},912:{652:562},3733:{3858:3808},4190:{4345:4335},4465:{46665:4665},4743:{5026:5062},5292:{5718:5618},5327:{5761:5661}};
function extract(filename){
 const bytes=fs.readFileSync(filename);if(sha(bytes)!=='06688a9634f57f80386a032c30a8f09d57919c2a067c7cda701610c3e1e79b6c')throw Error('EPUB differs from reviewed edition');
 const z=new AdmZip(bytes),opf=cheerio.load(z.readAsText('OEBPS/content.opf'),{xmlMode:true});
 if(opf('dc\\:title').text()!=='لمعات التنقيح في شرح مشكاة المصابيح'||opf('dc\\:creator').text()!=='عبد الحق الدِّهْلوي')throw Error('Wrong source book');
 const manifest=new Map(opf('manifest item').toArray().map(e=>[opf(e).attr('id'),opf(e).attr('href')]));
 const spine=opf('spine itemref').toArray().map(e=>manifest.get(opf(e).attr('idref'))).filter(s=>/^xhtml\/P\d+\.xhtml$/.test(s));
 const pages=spine.map(href=>{const $=cheerio.load(z.readAsText('OEBPS/'+href)),b=$('#book-container'),footer=$('.center').text();b.find('br').replaceWith('\n');const matn=clean(b.find('.matn').text()),titles=b.find('.title').map((i,e)=>clean($(e).text())).get();b.find('.matn,.matn-hr,hr,a').remove();b.find('.footnote-hr').replaceWith('\n');return {file:+href.match(/P(\d+)/)[1],volume:+footer.match(/الجزء:\s*(\d+)/)?.[1],page:+footer.match(/الصفحة:\s*(\d+)/)?.[1],matn,text:clean(b.text()),footnotes:b.find('.footnote').map((i,e)=>clean($(e).text())).get(),titles};});
 const segments=[],retained=[];let current;
 const start=(p,extra)=>{current={file:p.file,page:p.page,volume:p.volume,text:'',...extra};segments.push(current);};
 for(const p of pages){
  if(!p.volume||!p.page)throw Error(`Missing locator ${p.file}`);
  if(p.page<=4)continue; // Repeated volume title/copyright leaves, retained in the page audit.
  retained.push(p.text);
  if(!current)start(p,{kind:'heading',title:'مقدمات الكتاب',level:2,intro:true});
  if(p.file===6021)start(p,{kind:'heading',title:'ملحقات المجلد العاشر',level:2,intro:true});
  const anchors=[];
  if(p.file>=161&&p.volume<10){
   const re=/(?:^|\n)\s*(\d+(?:\s*[-–،,]\s*\d+)*)\s*[-–]\s*\[([^\]]+)\]/g;
   for(const m of p.text.matchAll(re))anchors.push({offset:m.index+m[0].search(/\d/),kind:'hadith',numbers:m[1].match(/\d+/g).map(Number).map(n=>corrections[p.file]?.[n]||n)});
   for(const n of (p.file===161?[1]:p.file===2420?[2144]:p.file===2673?[2387]:[])){
    const re=new RegExp(`(?:^|\\n)(${n} - )`),m=p.text.match(re);if(!m)throw Error(`Missing reviewed anchor ${n}`);anchors.push({offset:m.index+m[0].indexOf(m[1]),kind:'hadith',numbers:[n]});
   }
   let offset=0;
   for(const line of p.text.split('\n')){
    const key=norm(line),isSection=/^الفصل (?:الاول|الثاني|الثالث)$/.test(key);
    if(isSection || p.titles.some(t=>key===norm(t)&&/^(?:كتاب|باب)(?: |$)/.test(norm(t))) || (/^\(?\d+\)?\s*[-–]?\s*(?:كتاب|باب)/.test(line)&&line.length<180)){
     if(/^(?:كتاب|باب|الفصل)(?: |$)/.test(key))anchors.push({offset,kind:'heading',title:line,level:isSection?3:key.startsWith('كتاب ')?1:2});
    }
    offset+=line.length+1;
   }
  }
  const noteRanges=p.footnotes.filter(Boolean).map(note=>{const at=p.text.indexOf(note);if(at<0)throw Error(`Footnote locator ${p.file}`);return [at,at+note.length];});
  for(let i=anchors.length-1;i>=0;i--)if(noteRanges.some(([a,b])=>anchors[i].offset>=a&&anchors[i].offset<b))anchors.splice(i,1);
  anchors.sort((a,b)=>a.offset-b.offset);let pos=0;
  for(const a of anchors){current.text+='\n\n'+p.text.slice(pos,a.offset);start(p,a);pos=a.offset;}
  current.text+='\n\n'+p.text.slice(pos);
 }
 const result=segments.map(s=>({...s,text:clean(s.text)})).filter(s=>s.text);
 if(result.map(s=>s.text).join('').replace(/\s/g,'')!==retained.join('').replace(/\s/g,''))throw Error('Text conservation failed');
 const entries=result.filter(s=>s.kind==='hadith');
 return {sha256:sha(bytes),pages:pages.length,segments:result,entries,pageData:pages};
}
function planImport(source,virtual,toc){
 const byNumber=new Map();for(const v of virtual){if(!/^\d+[a-z]?$/.test(v.num)||!v.hadithId||Number(v.bookId)!==100419)throw Error(`Unexpected Mishkat entry ${v.id}`);const n=parseInt(v.num);if(!byNumber.has(n))byNumber.set(n,[]);byNumber.get(n).push(v);}
 const entries=new Map(),headings=[],unmapped=[];
 for(let i=0;i<source.segments.length;i++){
  const s=source.segments[i];
  if(s.kind==='hadith')for(const n of s.numbers){
   if(!byNumber.has(n))throw Error(`Unknown Mishkat number ${n}`);
   for(const v of byNumber.get(n)){
    if(!entries.has(v.id))entries.set(v.id,{virtualId:v.id,hadithId:v.hadithId,num:v.num,number:n,sourceEntryId:-12000000-v.id,page:s.page,volume:s.volume,text:[],files:[]});
    const e=entries.get(v.id);e.text.push(s.text);e.files.push(s.file);
   }
  }else{
   if(isHeadingOnly(s.text,s.title))continue;
   const next=source.segments.slice(i+1).find(e=>e.kind==='hadith'),v=byNumber.get(next?.numbers[0])?.[0];
   let candidates=toc.filter(t=>s.intro?t.h1===0&&t.h2===0&&t.level===2:t.level===s.level&&t.h1===v?.h1&&(s.level===1||t.h2===v?.h2)&&(s.level!==3||t.h3===({'الفصل الاول':1,'الفصل الثاني':2,'الفصل الثالث':3}[norm(s.title)]||v?.h3)));
   if(!s.intro&&s.level!==3){const key=t=>norm(t).replace(/^(?:كتاب|باب) /,'');const exact=toc.filter(t=>t.h1===v?.h1&&t.level<=2&&key(t.title)===key(s.title));if(exact.length===1)candidates=exact;}
   if(candidates.length!==1){unmapped.push({file:s.file,title:s.title,next:next?.numbers,candidates:candidates.map(t=>t.id)});continue;}
   headings.push({...s,tocId:candidates[0].id,sourceEntryId:-12000000-s.file*10-s.level});
  }
 }
 if(unmapped.length)throw Error('Unmapped headings: '+JSON.stringify(unmapped));
 const covered=new Set([...entries.values()].map(e=>e.number));
 return {entries:[...entries.values()].map(e=>({...e,text:normalizeStoredHonorifics(e.text.join('\n\n'))})),headings:headings.map(h=>({...h,text:normalizeStoredHonorifics(h.text)})),missing:[...byNumber.keys()].filter(n=>!covered.has(n)).sort((a,b)=>a-b)};
}
module.exports={extract,planImport,SOURCE,sha};
if(require.main===module)require('./import-mishkat-sharh-common')({extract,planImport,SOURCE,epub:'temp/lamaat/lamaat.epub',auditDir:'temp/lamaat/audit',lock:'import-lamaat',alias:'mishkat-lamaat',authorEn:'ʿAbd al-Ḥaqq al-Dihlawī'}).catch(e=>{console.error(e.stack);process.exitCode=1;});
