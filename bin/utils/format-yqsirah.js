#!/usr/bin/env node
'use strict';
// Local-only, lossless editorial draft. No database or publication code.
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),crypto=require('crypto');
const digest=s=>crypto.createHash('sha256').update(s).digest('hex');
const markers=s=>s.match(/\[\^[^\]]+\]/g)||[];
const rules=[
 {id:'ordinary-emphasis',pattern:/(?<!\*)\*([A-Za-z][^*\n]*)\*(?!\*)/g,replacement:(_match,inner)=>`_${inner}_`},
 {id:'sirah-spelling',pattern:/\bseerah\b/gi,replacement:'sirah'},
 {id:'abd-allah',pattern:/\bAbdullah\b/g,replacement:'Abd Allah'},
 {id:'abd-al-rahman',pattern:/\bAbdurrahman\b/g,replacement:'Abd al-Rahman'},
 {id:'aisha-spelling',pattern:/\bAyesha\b/g,replacement:'Aisha'},
 // A given name must precede ibn/bint: standalone Ibn Abbas is untouched.
 {id:'name-chain',pattern:/\b([A-Z][a-z'’-]+) (ibn|bint) (?=(?:al-)?[A-Z][a-z])/g,replacement:(_match,name,relation)=>`${name} ${relation==='ibn'?'b.':'bt.'} `},
 {id:'honorific-ra',pattern:/\bRA\b/g,replacement:'ᴿᴬ'},
 {id:'honorific-as',pattern:/\bAS\b/g,replacement:'ᴬˢ'},
 {id:'in-sha-allah',pattern:/\bin\s*sha['’ -]?\s*allah\b/gi,replacement:'in sha Allah'},
 {id:'al-hamdu-lillah',pattern:/\bal[- ]?hamdu[- ]?li[- ]?llah\b/gi,replacement:'al-hamdu lillah'}
];
function edit(text,start,before,after,kind,ledger){
 assert.equal(text.slice(start,start+before.length),before);
 ledger.push({start,before,after,kind});return text.slice(0,start)+after+text.slice(start+before.length);
}
function uniqueEdit(text,before,after,kind,ledger){
 const start=text.indexOf(before);assert(start>=0,`Missing anchor: ${before}`);assert.equal(text.indexOf(before,start+1),-1,`Ambiguous anchor: ${before}`);
 return edit(text,start,before,after,kind,ledger);
}
function undo(text,ledger){for(const change of [...ledger].reverse())text=edit(text,change.start,change.after,change.before,'undo',[]);return text;}
function paragraphBreaks(text){
 const offsets=[];
 // Only split plain prose at explicit transitions, outside quoted speech and asides.
 // Footnotes, evidence blocks, tables and Markdown list items stay together.
 for(const match of text.matchAll(/[^\n]+(?:\n(?!\n)[^\n]+)*/g)){
  const paragraph=match[0];
  if(/^(?: {4}|\t|\s*(?:>|#|\[\^|[-*+] |\d+[.)] |```)|.*\|)/m.test(paragraph)||paragraph.split(/\s+/).length<180)continue;
  let quoted=false,depth=0,last=0;
  for(let i=0;i<paragraph.length;i++){
   const c=paragraph[i];
   if(c==='"'||c==='“'||c==='”')quoted=!quoted;
   if(!quoted){if(c==='('||c==='[')depth++;if(c===')'||c===']')depth=Math.max(0,depth-1);}
   if(quoted||depth||c!==' '||!/[.!?]/.test(paragraph[i-1]||''))continue;
   if(!/^(?:And |But |So |Now |However, |Therefore, |Then |This |Thus, |Indeed, |For example, )/.test(paragraph.slice(i+1)))continue;
   if(paragraph.slice(last,i).split(/\s+/).length<100||paragraph.slice(i+1).split(/\s+/).length<35)continue;
   offsets.push(match.index+i);last=i+1;
  }
 }
 return offsets;
}
function formatField(original,manual=[],options={}){
 let text=original;const ledger=[];
 for(const change of manual){
  assert(['evidence','punctuation','spacing','quran-layout','quran-translation-layout','quran-completion','pdf-repair','footnote-boundary','source-image'].includes(change.kind),'Unsupported manual edit kind');
  if(change.kind==='source-image'){
   const image=require('../../data/yqsirah-formatting-source-images.json').find(r=>r.id===change.imageId);
   assert(image?.visuallyVerified&&Number.isInteger(image.pdfPage),'Source image requires visual PDF verification');
   assert(/^public\/static\/images\/yqsirah\/[\w-]+\.jpg$/.test(image.publicPath),'Invalid source image path');
   assert.equal(image.url,image.publicPath.slice('public'.length));
   assert.equal(digest(fs.readFileSync(path.resolve(__dirname,'../..',image.publicPath))),image.sha256,'Source image bytes changed');
   assert.equal(change.before,image.anchor,'Image must retain its recorded source position');
   assert([undefined,'before'].includes(image.position),'Invalid source image position');
   const markup=`![${image.alt}](${image.url})`;
   const restored=image.position==='before'?`${markup}\n\n${change.before}`:`${change.before}\n\n${markup}\n\n`;
   assert.equal(change.after,restored,'Image restoration may only append or prepend the verified image');
  }
  if(change.kind==='footnote-boundary'){
   const verified=require('../../data/yqsirah-formatting-pdf-repairs.json').repairs.find(r=>r.id===change.repairId);
   assert(verified&&verified.kind==='footnote-boundary'&&verified.visuallyVerified&&Number.isInteger(verified.page),'Footnote boundary requires a visually verified source mapping');
   assert.equal(change.before,verified.before,'Footnote boundary must match the recorded extraction');
   assert.equal(change.after,verified.after,'Footnote boundary must match the recorded page transcription');
   const content=s=>s.replace(/\[\^[^\]]+\]:/g,'').replace(/\s/g,'');
   assert.equal(content(change.before),content(change.after),'Footnote boundary cannot rewrite content');
   assert.deepEqual(markers(change.before),markers(change.after),'Footnote boundary cannot change markers');
  }
  if(change.kind==='pdf-repair'){
   const verified=require('../../data/yqsirah-formatting-pdf-repairs.json').repairs.find(r=>r.id===change.repairId);
   assert(verified&&verified.visuallyVerified&&Number.isInteger(verified.page),'PDF repair requires a visually verified source mapping');
   assert.equal(change.before,verified.before,'PDF repair must match the recorded extraction');
   assert.equal(change.after,verified.after,'PDF repair must match the recorded page transcription');
   assert.equal((change.before.match(/[A-Za-z0-9]+/g)||[]).join(' '),(change.after.match(/[A-Za-z0-9]+/g)||[]).join(' '),'PDF Arabic repair cannot rewrite English');
  }
  if(change.kind==='quran-layout'){
   assert.equal(change.sourceMapping,'data/yqsirah-arabic-repairs.json');
   assert(/^[\p{Script=Arabic}\p{M}\s\u0640\u06dd\u06de\u06e9]+$/u.test(change.before),'Quran layout must preserve an existing Arabic excerpt');
   assert(/^https:\/\/quran\.islamunlocked\.com\/quran:\d+:\d+$/.test(change.url));
   assert(/^[\p{Script=Arabic}\p{M} –-]+$/u.test(change.label));
   assert([undefined,4].includes(change.indent),'Only footnote indentation is supported');
   const indent=' '.repeat(change.indent||0);
   const quote=change.inlineReference
    ? `${indent}> ﴿${change.before}﴾ ([${change.label}](${change.url}))`
    : `${indent}> ﴿${change.before}﴾\n${indent}>\n${indent}> [${change.label}](${change.url})`;
   assert.equal(change.after,`\n\n${quote}\n\n${indent}`,'Quran layout may only wrap existing Arabic and add its reference');
  }
  if(change.kind==='quran-translation-layout'){
   assert(/^https:\/\/quran\.islamunlocked\.com\/quran:\d+:\d+$/.test(change.url));
   assert.equal(change.verification?.hadithdb,change.url);
   assert(change.verification?.independent,'Translation layout requires verified reference');
   assert(/^\[\d+:\d+(?:[-–]\d+)?\]\.$/.test(change.sourceReference),'Expected an existing Quran reference');
   assert(change.before.endsWith(change.sourceReference),'Translation must retain its original source reference');
   assert([undefined,4].includes(change.indent));
   const indent=' '.repeat(change.indent||0);
   const original=change.before.slice(0,-change.sourceReference.length).trim();
   assert.equal(change.after,`${indent}<!-- -->\n\n${indent}> ${original} ([${change.label}](${change.url}))`,'Translation layout cannot rewrite the source English');
  }
  if(change.kind==='quran-completion'){
   const verified=require('../../data/yqsirah-formatting-quran-evidence.json').find(e=>e.reference===change.reference);
   assert(verified&&verified.url===change.verification?.hadithdb&&verified.independent===change.verification?.independent,'Completion requires a verified Quran record');
   assert(change.before.includes('﴾')&&change.before.includes(change.oldLabel),'Completion requires an existing Quran block');
   if(change.insert!==undefined){
    assert.equal(change.append,undefined);assert.equal(change.prepend,undefined);
    assert(typeof change.insert==='string'&&change.insert.trim()&&verified.arabic.includes(change.insert.trim()),'Insertion requires an exact verified Quran clause');
    const match=change.before.match(/﴿([^﴾]+)﴾/u);
    assert(match&&change.before.indexOf('﴿')===change.before.lastIndexOf('﴿'),'Insertion requires one Quran block');
    assert(typeof change.anchor==='string'&&change.anchor&&match[1].split(change.anchor).length===2,'Insertion requires a unique Arabic anchor');
    assert.equal(change.after,change.before.replace(change.anchor,change.insert+change.anchor),'Insertion may only restore the missing clause');
    const letters=s=>s.replace(/[\p{M}\sـۥۦ]/gu,'').replace(/[ٱآ]/g,'ا').replace(/ى/g,'ي');
    assert.equal(letters(change.after.match(/﴿([^﴾]+)﴾/u)[1]),letters(verified.arabic),'Restored Quran must match the complete verified verse');
    assert(change.before.includes(`](${verified.url})`),'Insertion must retain the verified verse link');
   }else if(change.prepend!==undefined){
    assert.equal(change.append,undefined,'Completion cannot prepend and append together');
    const basmala='بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ ';
    if(change.omitBasmala)assert(verified.arabic.startsWith(basmala),'Verified text must contain the opening basmala');
    assert.equal(change.prepend,change.omitBasmala?verified.arabic.slice(basmala.length):verified.arabic,'Completion must prepend the exact verified verse');
    assert(/^https:\/\/quran\.islamunlocked\.com\/quran:\d+:\d+$/.test(change.oldUrl),'Completion requires the original Quran URL');
    assert.equal(change.newUrl,verified.url,'Prepended range must link to its verified first verse');
    assert(change.before.includes(`](${change.oldUrl})`),'Completion requires the original reference');
    assert.equal(change.after,change.before.replace('﴿','﴿'+change.prepend+' ').replace(change.oldLabel,change.newLabel).replace(`](${change.oldUrl})`,`](${change.newUrl})`),'Completion may only prepend a verified verse and extend its reference');
   }else{
   assert.equal(change.append,verified.arabic,'Completion must append the exact verified verse');
   assert.equal(change.after,change.before.replace('﴾',' '+change.append+'﴾').replace(change.oldLabel,change.newLabel),'Completion may only append a verified verse and extend its label');
   }
  }
  if(change.kind==='evidence'){
   assert(change.verification?.hadithdb&&change.verification?.independent,'Evidence requires two verified sources');
   assert(change.after.startsWith(change.before),'Evidence may not replace transcript wording');
  }
  if(change.kind==='spacing')assert.equal(change.before.replace(/\s/g,''),change.after.replace(/\s/g,''),'Spacing edit changes wording');
  if(change.kind==='punctuation')assert.equal(change.before.replace(/[^\p{L}\p{N}\p{M}]/gu,''),change.after.replace(/[^\p{L}\p{N}\p{M}]/gu,''),'Punctuation edit changes wording');
  if(change.kind==='quran-layout'&&Number.isInteger(change.sourceOffset))text=edit(text,change.sourceOffset,change.before,change.after,change.kind,ledger);
  else text=uniqueEdit(text,change.before,change.after,change.kind,ledger);
 }
 for(const rule of rules){
  // Keep URL destinations intact, including plain links in the PDF footnotes.
  const protectedRanges=[...text.matchAll(/https?:\/\/[^\s<>]+/g)].map(m=>[m.index,m.index+m[0].length]);
  const matches=[...text.matchAll(rule.pattern)].filter(m=>!protectedRanges.some(([a,b])=>m.index>=a&&m.index<b));
  for(const m of matches.reverse()){
   const replacement=typeof rule.replacement==='function'?rule.replacement(...m):rule.replacement;
   if(m[0]!==replacement)text=edit(text,m.index,m[0],replacement,rule.id,ledger);
  }
 }
 if(options.paragraphs){
  // PDF page boundaries can split a sentence between lowercase words. Keep
  // list labels separate and change only whitespace, never either word.
  const fragments=[...text.matchAll(/[a-z,;]\n\n(?=[a-z])(?![ivxlcdm]+[.)]\s|[a-z][.)]\s)/g)];
  for(const m of fragments.reverse())text=edit(text,m.index+1,'\n\n',' ','pdf-sentence-spacing',ledger);
  for(const start of paragraphBreaks(text).reverse())text=edit(text,start,' ','\n\n','paragraph-spacing',ledger);
 }
 assert.deepEqual(markers(text),markers(original),'Footnote markers moved or changed');
 assert.equal(undo(text,ledger),original,'The editorial ledger cannot reproduce the source');
 return {text,ledger};
}
function buildDraft(plan,manifest){
 return plan.entries.map(entry=>{
  const review=manifest.passages[String(entry.num)]||{};
  if(review.source_body_sha256)assert.equal(digest(entry.body),review.source_body_sha256,`Passage ${entry.num}: stale editorial source`);
  const fields={};for(const field of ['title','body','footnotes'])fields[field]=formatField(entry[field],review[field]||[],{paragraphs:field==='body'});
  return {num:entry.num,h1:entry.h1,h2:entry.h2,h3:entry.h3,source_sha256:entry.sha256,reviewStatus:review.status||'mechanical-pass-only',fields};
 });
}
function inventory(plan){
 const references=[];
 for(const e of plan.entries)for(const field of ['body','footnotes']){
  const text=e[field];
  for(const group of text.matchAll(/\[(?:(?:see|e\.g\.,?)\s+)?(?:[^\[\]\n\d]*\bQuran\s*,?\s*)?\d{1,3}:\d{1,3}(?:[-–~]\d{1,3})?(?:\s*(?:,\s*(?:and\s+)?|;\s*|and\s+|&\s*)\d{1,3}:\d{1,3}(?:[-–~]\d{1,3})?)*\]/gi)){
   const matches=[...group[0].matchAll(/(\d{1,3}):(\d{1,3})(?:[-–~](\d{1,3}))?/g)];
   for(const [i,m] of matches.entries()){
    const surah=Number(m[1]),from=Number(m[2]),to=Number(m[3]||m[2]);
    if(surah<1||surah>114||from<1||to<from)continue;
    // Keep existing singleton IDs stable; grouped citations get separate offsets.
    references.push({passage:e.num,field,offset:i===0?group.index:group.index+m.index,kind:'quran',reference:group[0],surah,from,to,context:text.slice(Math.max(0,group.index-300),group.index+group[0].length+150)});
   }
  }
  for(const m of text.matchAll(/\b(?:(?:Sahih )?(?:al-)?Bukhari|Sahih Muslim|(?:al-)?Tirmidhi|Abu Dawud|Ibn Majah|(?:al-)?Nasa['’]?i|Musnad (?:Imam )?Ahmad|Muslim)\b/g)){
   // Bare Muslim is also an ordinary noun; only admit an explicit attribution.
   // Keep the start offset of previously recognized collection names unchanged.
   if(m[0]==='Muslim'&&!/(?:\b(?:in|by|from|Imam) |\bBukhari (?:and|&) )$/.test(text.slice(0,m.index)))continue;
   references.push({passage:e.num,field,offset:m.index,kind:'hadith-collection-mention',reference:m[0],context:text.slice(Math.max(0,m.index-150),m.index+400)});
  }
  for(const m of text.matchAll(/https?:\/\/(?:www\.)?sunnah\.com\/[^\s)\]]+/g))references.push({passage:e.num,field,offset:m.index,kind:'hadith-link',reference:m[0]});
  for(const m of text.matchAll(/\*(?!\*)([^*\n]+)\*(?!\*)/g))references.push({passage:e.num,field,offset:m.index,kind:'emphasis-review',reference:m[0]});
 }
 return references;
}
function main(){
 const {build}=require('./import-yqsirah');const source=JSON.parse(fs.readFileSync('var/imports/yqsirah/extracted.json'));
 const plan=build(source,require('../../data/yqsirah-topics.json'));
 const manifest=require('../../data/yqsirah-formatting.json');const draft=buildDraft(plan,manifest),references=inventory(plan);
 const dir=path.resolve('var/imports/yqsirah/formatting');fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(dir,'draft.json'),JSON.stringify({source_sha256:plan.source_sha256,draft},null,2));
 fs.writeFileSync(path.join(dir,'citation-inventory.json'),JSON.stringify(references,null,2));
 fs.writeFileSync(path.join(dir,'transcript.md'),draft.map(e=>`## ${e.num}. ${e.fields.title.text}\n\n${e.fields.body.text}\n\n${e.fields.footnotes.text}`).join('\n\n---\n\n')+'\n');
 const flags=Object.entries(manifest.passages).flatMap(([passage,review])=>(review.citationFlags||[]).map(flag=>({passage:Number(passage),...typeof flag==='string'?{reason:flag}:flag})));
 fs.writeFileSync(path.join(dir,'citation-flags.json'),JSON.stringify(flags,null,2)+'\n');
 fs.writeFileSync(path.join(dir,'citation-review.json'),JSON.stringify(manifest.citationReviews||[],null,2)+'\n');
 const hadithQueue=references.filter(r=>r.kind==='hadith-collection-mention'||r.kind==='hadith-link').map(r=>{
  const id=`${r.passage}:${r.field}:${r.offset}`;
  const decision=(manifest.citationReviews||[]).find(x=>x.id===id);
  return {...r,id,status:decision?.decision||'needs-review',...(decision?.matchedReference?{matchedReference:decision.matchedReference}:{})};
 });
 fs.writeFileSync(path.join(dir,'hadith-review-queue.json'),JSON.stringify(hadithQueue,null,2)+'\n');
 // Presence in the same item is a triage aid, not proof of editorial review.
 const quranQueue=references.filter(r=>r.kind==='quran').map(r=>{
  const id=`${r.passage}:${r.field}:${r.offset}`;
  const decision=(manifest.citationReviews||[]).find(x=>x.id===id);
  const changes=manifest.passages[r.passage]?.[r.field]||[];
  const covered=new Set();
  for(const c of changes){
   const urls=[c.url,c.verification?.hadithdb,...(c.verification?.additional||[]).map(x=>x.hadithdb)].filter(Boolean);
   for(const url of urls){const match=url.match(/quran:(\d+):(\d+)$/);if(match)covered.add(`${Number(match[1])}:${Number(match[2])}`);}
   if(c.kind==='quran-layout'&&c.label.includes('–')){
    const match=c.url.match(/quran:(\d+):(\d+)$/),end=Number(c.label.split('–')[1].replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
    if(match)for(let a=Number(match[2]);a<=end;a++)covered.add(`${Number(match[1])}:${a}`);
   }
  }
  const present=Array.from({length:r.to-r.from+1},(_,i)=>`${r.surah}:${r.from+i}`).every(k=>covered.has(k));
  return {...r,id,status:decision?.decision||(present?'arabic-present-in-item':'needs-review')};
 });
 fs.writeFileSync(path.join(dir,'quran-review-queue.json'),JSON.stringify(quranQueue,null,2)+'\n');
 const report={passages:draft.length,changedPassages:draft.filter(e=>Object.values(e.fields).some(f=>f.ledger.length)).length,edits:draft.reduce((n,e)=>n+Object.values(e.fields).reduce((n,f)=>n+f.ledger.length,0),0),reviewedPassages:draft.filter(e=>e.reviewStatus==='reviewed').map(e=>e.num),quranCandidates:references.filter(r=>r.kind==='quran').length,linkedHadithCandidates:references.filter(r=>r.kind==='hadith-link').length,hadithCollectionMentions:references.filter(r=>r.kind==='hadith-collection-mention').length,emphasisCandidates:references.filter(r=>r.kind==='emphasis-review').length,allEditsReversible:true,footnoteMarkersPreserved:true};
 fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(report);
}
if(require.main===module)main();
module.exports={formatField,undo,buildDraft,inventory};
