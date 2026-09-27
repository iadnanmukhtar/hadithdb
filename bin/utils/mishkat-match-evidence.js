'use strict';
const {canonical}=require('../recover-mishkat-text-pass2');
const {bodyEvidence,narratorEvidence}=require('../recover-mishkat-variants');
const narrators=require('../recover-mishkat-narrators');
function repairExtractionText(text){return String(text).replace(/^(\[\d+\]\s*)و\s+(\([^)]*\))\s*/u,'$1$2 ').replace(/ق[\u064b-\u065f]*ا[\u064b-\u065f]*\s+ل(?=[\s:：])/gu,'قال');}
function prepareEntries(entries){return entries.map(h=>({...h,text:repairExtractionText(h.text)}));}
function extract(h,entries){
 const e=narrators.extract(h,entries);
 return {...e,segments:e.segments.map(s=>{
  let text=canonical(s).replace(/(?:\s+)?متفق عليه[.\s]*$/u,'').trim();
  // Unquoted companion statements can retain their reporting clause as matn.
  // Remove it only when it names the independently extracted narrator.
  const intro=text.match(/^(?:وعن|عن) (.+?) انه كان يقول /u);
  if(intro&&canonical(intro[1])===canonical(e.narrator||''))text=text.slice(intro[0].length);
  return text;
 }).filter(s=>s.split(' ').length>=2)};
}
const words=s=>canonical(s).split(' ').filter(Boolean);
function grams(w,k=2){return new Set(w.slice(0,Math.max(0,w.length-k+1)).map((_,i)=>w.slice(i,i+k).join(' ')));}
function overlap(a,b){const m=new Map();for(const w of b)m.set(w,(m.get(w)||0)+1);let n=0;for(const w of a)if(m.get(w)>0){n++;m.set(w,m.get(w)-1);}return n;}
function segmentEvidence(source,target,narratorVerified){
 const a=canonical(source),b=canonical(target),aw=words(a),bw=words(b);if(!aw.length)return null;
 if(aw.length>=2&&b.replace(/ /g,'').includes(a.replace(/ /g,'')))return {method:'exact-spacing-normalized',score:1,words:aw.length};
 // Sparse single-character spelling errors with eight unchanged words are
 // strong transcription evidence; never normalize away a negation.
 const negatives=new Set(['لا','لم','لن','ليس','ما']);
 const editOne=(x,y)=>{if(x===y)return true;if(Math.abs(x.length-y.length)>1)return false;let i=0,j=0,n=0;while(i<x.length&&j<y.length){if(x[i]===y[j]){i++;j++;continue;}if(++n>1)return false;if(x.length>=y.length)i++;if(y.length>=x.length)j++;}return n+(x.length-i)+(y.length-j)<=1;};
 if(aw.length>=10)for(let i=0;i+aw.length<=bw.length;i++){
  const window=bw.slice(i,i+aw.length),different=aw.map((w,j)=>[w,window[j]]).filter(([x,y])=>x!==y);
  if(different.length>0&&different.length<=2&&aw.length-different.length>=8&&different.every(([x,y])=>x.length>=4&&y.length>=4&&!negatives.has(x)&&!negatives.has(y)&&editOne(x,y)))return {method:'sparse-transcription-errors',score:1-different.length/aw.length*.25,words:aw.length,targetWindow:window.join(' ')};
 }
 const strict=bodyEvidence(a,b);if(strict)return strict;
 if(aw.length<(narratorVerified?4:8))return null;
 const ag=grams(aw);let best=null;
 for(const size of [...new Set([Math.ceil(aw.length*.7),aw.length,Math.ceil(aw.length*1.25)])])for(let i=0;i<bw.length;i++){
  const window=bw.slice(i,i+size);if(window.length<(aw.length<8?3:6))continue;
  const hits=overlap(aw,window),recall=hits/aw.length,precision=hits/window.length,bg=grams(window),pairs=[...ag].filter(g=>bg.has(g)).length/Math.max(1,ag.size);
  const close=recall>=.75&&precision>=.70&&pairs>=.5;
  const abbreviated=narratorVerified&&aw.length>=8&&aw.length<=30&&recall>=.65&&precision>=.85&&pairs>=.5;
  if(!close&&!abbreviated)continue;
  // Reject an opposite polarity when a variant differs only by a negation.
  const negative=['لا','لم','لن','ليس'];if(aw.length<=30&&negative.some(w=>aw.includes(w)!==window.includes(w)))continue;
  const score=.7*(2*recall*precision/(recall+precision))+.3*pairs;
  if(!best||score>best.score)best={method:abbreviated&&!close?'same-narrator-abbreviated-wording':'close-wording-variant',score,words:aw.length,recall,precision,pairs,targetWindow:window.join(' ')};
 }
 return best;
}
function sourceMatn(candidate){
 const text=canonical(candidate.body||'');
 if(candidate.alias!=='tirmidhi')return text;
 // Compiler cross-references and grading are not the transmitted narration.
 return text.split(/(?:قال )?وفي الباب عن |قال ابو عيسي |(?:قال )?هذا حديث (?:حسن|صحيح|غريب|ضعيف)/u)[0].trim();
}
function evidence(e,c){c={...c,body:sourceMatn(c)};const n=narratorEvidence(e.narrator,c)||(/^(?:ابي|ابو) مسعود الانصاري$/.test(canonical(e.narrator||''))&&narratorEvidence('ابي مسعود',c))||(/^عبد الله بن ام مكتوم$/.test(canonical(e.narrator||''))&&narratorEvidence('ابن ام مكتوم',c))||(/^(?:ابن مسعود|عبد الله بن مسعود)$/.test(canonical(e.narrator||''))&&/عن علقمه عن عبد الله(?: قال|$)/.test(canonical(c.chain||''))),segments=e.segments.map(s=>segmentEvidence(s,[c.chain,c.body].join(' '),!!n)),count=e.segments.reduce((n,s)=>n+words(s).length,0);return {narrator:!!n,segments,words:count,coverage:count?segments.reduce((n,s)=>n+(s?.words||0),0)/count:0,score:count?segments.reduce((n,s)=>n+(s?s.words*s.score:0),0)/count:0};}
// Candidate-generation aid only: a short terminal gloss may explain a mismatch.
// Callers must review it in context; never silently discard it from source data.
function glossReviewVariant(e){
 const glosses=[];
 const segments=e.segments.map((segment,index)=>{
  const text=canonical(segment),m=text.match(/^(.*) يعني (\S+(?: \S+){0,4})$/u);
  if(!m||m[1].split(' ').length<5)return segment;
  glosses.push({segment:index,text:'يعني '+m[2]});return m[1];
 });
 return {...e,segments,glosses,requiresReview:true};
}
function mainWording(h,entries){
 const repaired={...h,text:repairExtractionText(h.text)};
 const e=extract(repaired,entries);
 const plain=String(repaired.text).normalize('NFKD').replace(/[\u064b-\u065f\u0670\u06d6-\u06edـ]/gu,'');
 const boundaries=[...plain.matchAll(/(?:وف[يى] رواية|وف[يى] روايه|هذه رواية|وف[يى] لفظ|ولمسلم|وف[يى] الصحيحين|(?<=[.۔]\s)قيل:)/gu)];
 const editorial=plain.match(/[«" ]*لم اجده[»" ]*في الصحيحين/u);
 if(editorial&&editorial.index>0)boundaries.push(editorial);
 boundaries.sort((a,b)=>a.index-b.index);
 const boundary=boundaries.find(m=>plain.slice(0,m.index).replace(/^\[\d+\]\s*/,'').replace(/^\([^)]*\)\s*/,'').trim())?.index??-1;
 let matchingText=boundary>=0?plain.slice(0,boundary):plain;
 let result=e;
 if(boundary>=0){result=extract({...h,text:matchingText,splitNarrator:null,splitSegments:null},entries);result.narrator=e.narrator;}
 if(!result.segments.length){const body=canonical(matchingText.replace(/^\[\d+\]\s*/,'').replace(/^\([^)]*\)\s*/,'').replace(/^قال[: ]*/,'' )).replace(/متفق عليه$/,'').trim();if(body.split(' ').length>=6&&!/^(?:وفي روايه|رواه|وعن|عن) /.test(body))result={...result,segments:[body]};}
 let excludedText='';
 if(boundary>=0){let offset=0;for(let i=0;i<repaired.text.length;i++){if(offset>=boundary){excludedText=repaired.text.slice(i);break;}offset+=repaired.text[i].normalize('NFKD').replace(/[\u064b-\u065f\u0670\u06d6-\u06edـ]/gu,'').length;}}
 return {...result,matchingText,boundary:boundary>=0,excludedText};
}

function referenceText(h){return String(h.text).replace(/^\[\d+\]\s*/,'').replace(/^\([^)]*\)\s*/,'').normalize('NFKD').replace(/[\u064b-\u065f\u0670\u06d6-\u06edـ]/gu,'').trim();}
function isReferenceOnly(h){
 const text=referenceText(h).replace(/«(شعب الايمان)»/g,'$1');
 return /^(?:ورواه|رواه|والبيهقي) /.test(text)&&text.split(/\s+/).length<=40&&!/[«»":]/u.test(text)&&!/(?:^|\s)(?:الا|لم يذكر|قال|قوله|روايته|زاد|بدل|انتهت)(?=\s|$)/u.test(text);
}
function contextualWording(h,entries,seen=new Set()){
 const own=mainWording(h,entries);
 if(!isReferenceOnly(h))return own;
 if(seen.has(h.number))return {...own,segments:[],referenceIssue:'cyclic-reference'};
 seen.add(h.number);
 const i=entries.indexOf(h);let j=i-1;
 while(j>=0&&h.file!==undefined&&entries[j].file===h.file)j--;
 const prior=entries[j];
 if(!prior||!h.headingKey||prior.headingKey!==h.headingKey)return {...own,segments:[],referenceIssue:'no-previous-entry-in-section'};
 const context=contextualWording(prior,entries,seen);
 const named=referenceText(h).match(/ عن (.+)$/)?.[1];
 const name=named?canonical(named).replace(/(?: مرسلا| تعليقا| نحوه| من قوله).*$/,'').trim():'';
 return {...own,narrator:name||context.narrator,segments:context.segments,contextNumber:prior.number,contextNumbers:[prior.number,...(context.contextNumbers||[])],referenceOnly:true,referenceIssue:context.referenceIssue};
}
function rankingText(h,entries){
 const e=contextualWording(h,entries);
 if(e.referenceOnly){const prior=entries.find(x=>x.number===e.contextNumbers?.at(-1));return prior?rankingText(prior,entries):'';}
 let text=canonical(e.matchingText.replace(/^\[\d+\]\s*/,'').replace(/^\([^)]*\)\s*/,'').split(/(?:رواه|رواهما|اخرجه|اخرجاه)\s/u)[0]);
 const name=canonical(e.narrator||'');
 for(const prefix of ['وعن '+name,'عن '+name])if(name&&name.split(' ').length<=9&&text.startsWith(prefix+' ')){text=text.slice(prefix.length).trim();break;}
 text=text.replace(/^(?:وعنه|وعنها|عنه|عنها) /,'');
 return cleanOpening(text);
}
function cleanOpening(text){return canonical(text).replace(/فحي هلا/g,'فحيهلا').replace(/^(?:(?:قالت|قال)\s+)+/,'').replace(/^(?:سمعت |عن )?(?:ان |انه )?(?:رسول الله)(?: انه)?(?: قال| يقول)? /,'').replace(/^قال /,'').trim();}
function wordingSimilarity(source,target){
 const a=words(cleanOpening(source)),b=words(cleanOpening(target));if(!a.length||!b.length)return {score:0,words:a.length};
 const joined=a.join(' '),all=b.join(' ');if((' '+all+' ').includes(' '+joined+' '))return {score:1,words:a.length,recall:1,precision:1,pairs:1};
 const ag=grams(a);let best={score:0,words:a.length};
 // Ranking only: imperfect candidates still require evidence review before import.
 for(const size of [...new Set([Math.ceil(a.length*.75),a.length,Math.ceil(a.length*1.25)])])for(let i=0;i<b.length;i++){
  const window=b.slice(i,i+size);if(window.length<Math.min(4,a.length))continue;
  const hits=overlap(a,window),recall=hits/a.length,precision=hits/window.length,bg=grams(window),pairs=[...ag].filter(g=>bg.has(g)).length/Math.max(1,ag.size);
  const score=.7*(hits?2*recall*precision/(recall+precision):0)+.3*pairs;
  if(score>best.score)best={score,words:a.length,recall,precision,pairs};
 }
 return best;
}
function compareCandidates(a,b,books){
 const ordinal=alias=>books.find(book=>book.alias===alias)?.ordinal??Infinity;
 return b.wording.score-a.wording.score||ordinal(a.alias)-ordinal(b.alias)||String(a.ref).localeCompare(String(b.ref),'en',{numeric:true});
}
module.exports={sourceMatn,glossReviewVariant,rankingText,wordingSimilarity,compareCandidates,contextualWording,isReferenceOnly,mainWording,repairExtractionText,prepareEntries,extract,segmentEvidence,evidence};
