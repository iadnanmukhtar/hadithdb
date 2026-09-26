#!/usr/bin/env node
'use strict';
// Source-faithful virtual-book import. Default: local parse/match report only.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const AdmZip=require('adm-zip'),cheerio=require('cheerio');
const clean=s=>String(s||'').replace(/\[ص:\s*\d+\]/gu,'').replace(/\s+/gu,' ').trim();
const norm=s=>clean(String(s||'').normalize('NFKD').replace(/[\u064b-\u065f\u0670\u06d6-\u06edـ]/gu,'').replace(/صلى الله عليه وسلم|رضي الله عنهما?|ﷺ|ؓ/gu,' ').replace(/[إأآٱ]/gu,'ا').replace(/ى/gu,'ي').replace(/ة/gu,'ه').replace(/[^\p{L}\p{N} ]/gu,' '));
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
// Reviewed authorial notes left inline by this EPUB, rather than marked .footnote.
// Keep boundaries explicit: quoted speech can itself contain forward references.
function separateLegacyEditorial(h){
 if(h.number!==28)return h;
 const words=[...h.text.matchAll(/\S+/gu)];
 const start=words.findIndex((w,i)=>norm(w[0])==='والحديثان'&&norm(words[i+1]?.[0])==='المرويان');
 if(start<0)return h;
 const offset=words[start].index,note=h.text.slice(offset);
 if(!norm(note).includes('سنذكرهما في باب'))throw Error('Mishkat 28 editorial boundary changed');
 return {...h,text:h.text.slice(0,offset).trim(),footnote:clean([h.footnote,note].filter(Boolean).join(' '))};
}
function separateEditorial(h){return require('./utils/mishkat-editorial').separateReviewedEditorial(separateLegacyEditorial(h));}
function parse(file=path.resolve('temp/مشكاة المصابيح.epub')){
 const z=new AdmZip(file),$=cheerio.load(z.readAsText('OEBPS/toc.ncx'),{xmlMode:true}),headings=[];
 let h1=0,h2=0,h3=0;
 $('navPoint').each((i,e)=>{const src=$(e).children('content').attr('src'),m=src.match(/P(\d+)\.xhtml/);if(!m)return;
 const title=clean($(e).children('navLabel').text()),n=norm(title);let level;
 if(+m[1]===1){level=2;}else if($(e).parents('navPoint').length===0){h1++;h2=0;h3=0;level=1;}
 else if(n.startsWith('الفصل')){if(h2===0){h2=1;headings.push({key:'implicit-'+h1,file:+m[1],title:'*',level:2,h1,h2,h3:null,intro:''});}h3=n.includes('الثاني')?2:n.includes('الثالث')?3:1;level=3;}
 else{h2++;h3=0;level=2;}
 headings.push({key:$(e).attr('id'),file:+m[1],title,level,h1,h2:level>=2?h2:null,h3:level===3?h3:null,intro:''});});
 // Two authored headings are absent from the NCX; one follows hadith 1645 inline.
 headings.push({key:'embedded-funeral-prayer',file:1959.5,title:'الْمَشْي بالجنازة وَالصَّلَاة عَلَيْهَا',level:2,intro:''},{key:'embedded-weeping',file:2043,title:'[7] الْبكاء على الْمَيِّت',level:2,intro:''});
 headings.sort((a,b)=>a.file-b.file);
 h1=0;h2=0;h3=0;
 for(const h of headings){if(h.level===1){h1++;h2=0;h3=0;}else if(h.level===2){h2=h1?h2+1:0;h3=0;}else{const n=norm(h.title);h3=h.key==='C300'?1:n.includes('الثاني')?2:n.includes('الثالث')?3:1;}h.h1=h1;h.h2=h.level>=2?h2:null;h.h3=h.level===3?h3:null;}
 const positions=headings.map(h=>[h.level,h.h1,h.h2,h.h3].join(':'));if(new Set(positions).size!==positions.length)throw Error('Duplicate heading paths');
 const opf=cheerio.load(z.readAsText('OEBPS/content.opf'),{xmlMode:true});const manifest=new Map(opf('manifest item').toArray().map(e=>[opf(e).attr('id'),'OEBPS/'+opf(e).attr('href')]));
 const entries=[];let current=null,heading=null;
 for(const e of opf('spine itemref').toArray()){
 const name=manifest.get(opf(e).attr('idref')),m=name?.match(/P(\d+)\.xhtml/);if(!m)continue;const page=+m[1],p=cheerio.load(z.readAsText(name),{xmlMode:true}),c=p('#book-container');
 const pageHeadings=headings.filter(h=>h.file===page);if(pageHeadings.length){heading=pageHeadings.at(-1);current=null;}
 const marker=c.find('span.red').first(),start=p('div.center').last().text().match(/الحديث:\s*(\d+)/u);
 if(start && clean(marker.text()).match(/^(\d+)\s*-/)){current={number:+start[1],file:page,headingKey:heading.key,text:'',footnote:''};entries.push(current);marker.remove();}
 c.find('.footnote').each((i,e)=>{if(current)current.footnote=clean(current.footnote+' '+p(e).text());});c.find('.footnote,.footnote-hr,hr,a').remove();c.find('br').replaceWith(' ');
 if(pageHeadings.length && page!==1){heading.title=clean(c.text());c.empty();}else if(page===1)c.find('span.title').remove();const text=clean(c.text());
 if(current){const body=page===1959?text.replace(/الْمَشْي بالجنازة وَالصَّلَاة عَلَيْهَا$/u,''):text;current.text=clean(current.text+' '+body);}else if(heading&&text){if(heading.h1 && heading.key!=='C1146' && !/^(وهذا|ليس)/.test(norm(text)))heading.title=clean(heading.title+' '+text);else heading.intro=clean(heading.intro+' '+text);}
 }
 for(const h of entries){const raw=cheerio.load(z.readAsText(`OEBPS/xhtml/P${h.file}.xhtml`))('#book-container').text();const header=raw.split(/\n/).map(clean).filter(Boolean)[0]||'';h.numbers=[h.number,...Array.from(header.matchAll(/(?:،|-)\s*(\d{4})\s*(?:-?\s*\[|\(|$)/gu),m=>+m[1]).filter(n=>n>h.number&&n<=h.number+4)];}
 const nums=new Set(entries.flatMap(h=>h.numbers));if(new Set(entries.map(h=>h.number)).size!==entries.length)throw Error('Duplicate source numbers: '+JSON.stringify(entries.filter((h,i)=>entries.findIndex(x=>x.number===h.number)!==i).map(h=>({number:h.number,file:h.file,text:h.text.slice(0,150)}))));
 const missing=[];for(let i=1;i<=Math.max(...nums);i++)if(!nums.has(i))missing.push(i);
 return {file,sha256:sha(fs.readFileSync(file)),headings,entries:entries.map(separateEditorial),missing};
}
const patterns=[['shuab',/في (?:كتاب )?شعب الايمان/g],['bukhari',/البخاري/g],['muslim',/مسلم/g],['abudawud',/اب[وي] داود/g],['tirmidhi',/الترمذي/g],['ibnmajah',/ابن ماجه/g],['nasai',/النسايي|النسائي/g],['darimi',/الدارمي/g],['ahmad',/احمد/g],['malik',/مالك/g],['daraqutni',/الدارقطني/g],['bayhaqi',/البيهقي/g],['hakim',/الحاكم/g],['ibnhibban',/ابن حبان/g]];
function sources(text){
 const n=norm(text),at=n.search(/رواه|رواهما|اخرجه|اخرجاه|في روايه ل|ولمسلم|لفظ البخاري/),tail=at<0?'':n.slice(at),out=[];
 if(n.includes('متفق عليه'))out.push('bukhari','muslim');
 for(const [alias,re]of patterns){re.lastIndex=0;if(re.test(tail)&&!out.includes(alias)){
 // Author names alone must not alias a different work by the same author.
 if(alias==='bayhaqi'&&!/البيهقي في (?:السنن|سننه الكبير)/.test(tail))continue;
 if(alias==='bukhari'&&/الادب المفرد|التاريخ/.test(tail))continue;
 if(alias==='ahmad'&&/الزهد/.test(tail))continue;
 if(alias==='nasai'&&/عمل اليوم|الكبري/.test(tail))continue;
 if(alias==='tirmidhi'&&/الشمايل|الشمائل/.test(tail))continue;
 out.push(alias);}}
 return out;
}
function match(source,corpus,books){
 const bookMap=new Map(books.map(b=>[b.id,b.alias])),indexes=new Map();
 for(const c of corpus){c.alias=bookMap.get(c.bookId);if(!patterns.some(p=>p[0]===c.alias))continue;if(!indexes.has(c.alias))indexes.set(c.alias,{rows:[],grams:new Map()});const ix=indexes.get(c.alias);c.normal=norm([c.chain,c.body,c.text].join(' '));c.words=new Set(c.normal.split(' '));const pos=ix.rows.length;ix.rows.push(c);const w=c.normal.split(' ');for(let j=0;j<w.length-4;j++){const g=w.slice(j,j+5).join(' ');if(!ix.grams.has(g))ix.grams.set(g,new Set());ix.grams.get(g).add(pos);}}
 const results=[];
 for(const h of source.entries){const allowed=h.numbers.length>1?[]:sources(h.text),n=norm(h.text.replace(/^(?:\[\d+\]\s*)?\([^)]*\)\s*/u,'')).split(/(?:رواه|رواهما|اخرجه|اخرجاه) /u)[0],w=n.split(' '),links=[],review=[];
 for(const alias of allowed){const ix=indexes.get(alias);if(!ix)continue;const votes=new Map();for(let j=0;j<w.length-4;j++)for(const pos of ix.grams.get(w.slice(j,j+5).join(' '))||[])votes.set(pos,(votes.get(pos)||0)+1);
 const ranks=[...votes].sort((a,b)=>b[1]-a[1]).slice(0,15).map(([pos,hits])=>{const c=ix.rows[pos],words=w.filter(x=>x.length>2),recall=words.filter(x=>c.words.has(x)).length/words.length;return {id:c.id,ref:alias+':'+c.num,hits,recall,score:hits/Math.max(1,w.length-4)};}).sort((a,b)=>b.score-a.score||b.recall-a.recall);
 const best=ranks[0],second=ranks[1];const candidate=best&&ix.rows.find(c=>c.id===best.id);const narrator=n.match(/^(?:و?عن) (.*?) (?:قال|قالت|ان|انه|انها) /u)?.[1];const narratorWords=norm(narrator).split(' ').filter(x=>x.length>2);const narratorMatches=!narratorWords.length||narratorWords.every(x=>candidate?.words.has(x));const accepted=h.numbers.length===1&&narratorMatches&&best&&best.hits>=8&&best.recall>=0.85&&best.score>=0.45&&(!second||best.score-second.score>=0.08);
 if(accepted)links.push({...best,targetSha256:sha(JSON.stringify([candidate.id,candidate.bookId,candidate.num,candidate.chain,candidate.body,candidate.text]))});else review.push({alias,candidates:ranks.slice(0,3)});
 }
 results.push({...h,sources:allowed,links,review});
 }
 return {sha256:source.sha256,stats:{entries:source.entries.length,headings:source.headings.length,linkedEntries:results.filter(h=>h.links.length).length,links:results.reduce((s,h)=>s+h.links.length,0),unlinked:results.filter(h=>!h.links.length).length,missingNumbers:source.missing},headings:source.headings,entries:results};
}
async function main(){if(process.argv.includes('--fetch-corpus')){require('dotenv').config();const mysql=require('mysql'),util=require('util'),db=mysql.createConnection(require('./initializeHadithAttributions').connectionSettings()),q=util.promisify(db.query).bind(db);try{fs.writeFileSync('temp/mishkat-books.json',JSON.stringify(await q('SELECT id,alias,name FROM books')));fs.writeFileSync('temp/mishkat-corpus.json',JSON.stringify(await q("SELECT h.id,h.bookId,h.num,h.chain,h.body,h.text FROM hadiths h JOIN books b ON b.id=h.bookId WHERE b.type='hadith' AND b.`virtual`=0")));}finally{db.end();}}const source=parse();fs.writeFileSync('temp/mishkat-parsed.json',JSON.stringify(source,null,2));console.log(JSON.stringify({entries:source.entries.length,headings:source.headings.length,last:source.entries.at(-1).number,missing:source.missing}));if(process.argv.includes('--parse-only'))return;const report=match(source,JSON.parse(fs.readFileSync('temp/mishkat-corpus.json')),JSON.parse(fs.readFileSync('temp/mishkat-books.json')));fs.writeFileSync('temp/mishkat-import-review.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report.stats));}
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});module.exports={parse,norm,sources,match,separateEditorial};
