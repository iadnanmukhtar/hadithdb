'use strict';
const {isHeadingOnly}=require('../../lib/SharhHeadingContent');
const compact=s=>s.replace(/\s/g,'');
const key=s=>require('../../lib/SharhHeadingContent').normalize(s).replace(/^باب في /,'باب ');

// Inspect every retained paragraph, using the reviewed edition's navigation and
// exact source positions. A heading may occur after a quoted hadith or at the
// end of the preceding explanation, rather than at the EPUB footer boundary.
function splitIntroductions(segments,pages,navigation) {
 const bounds=[];let total=0;
 for(const page of pages){bounds.push({start:total,end:total+compact(page.text).length,page});total+=compact(page.text).length;}
 const locate=position=>{let lo=0,hi=bounds.length-1;while(lo<hi){const mid=(lo+hi)>>1;if(bounds[mid].end<=position)lo=mid+1;else hi=mid;}return bounds[lo].page;};
 const output=[],moves=[],rejected=[];let position=0;
 for(const segment of segments){
  const base=position;position+=compact(segment.text).length;
  if(segment.kind!=='hadith'){output.push(segment);continue;}
  const boundaries=[];let offset=0,local=0;
  for(const line of segment.text.split('\n')){
   const normalized=key(line),page=locate(base+local);
   const section=normalized.match(/^الفصل (الاول|الثاني|الثالث)$/);
   if(section)boundaries.push({offset,kind:'heading',...page,text:undefined,title:line,level:3,sectionNumber:['الاول','الثاني','الثالث'].indexOf(section[1])+1});
   else if(/^[\s\[("«]*(?:[\d]+\s*[-–]\s*)?[كب]/.test(line)&&/^(كتاب|باب) /.test(normalized)){
    const nearby=navigation.filter(h=>Math.abs(h.file-page.file)<=3);
    const matched=nearby.filter(h=>{const a=key(h.title),b=normalized;return a===b||a.startsWith(b+' ')||b.startsWith(a+' ')||a.split(' ').slice(0,2).join(' ')===b.split(' ').slice(0,2).join(' ');});
    if(matched.length===1)boundaries.push({offset,kind:'heading',...page,text:undefined,title:matched[0].title,level:key(matched[0].title).startsWith('كتاب ')?1:2});
    else rejected.push({number:segment.number,file:page.file,line:line.slice(0,180),matches:matched.length});
   }
   if(new RegExp(`^${segment.number}\\s*[-–]`).test(line))boundaries.push({offset,kind:'hadith'});
   offset+=line.length+1;local+=compact(line).length;
  }
  let consumed=0;
  for(let i=0;i<boundaries.length;i++){
   const b=boundaries[i];if(b.kind!=='heading')continue;
   const end=boundaries[i+1]?.offset??segment.text.length;
   const text=segment.text.slice(b.offset,end).trim();
   if(isHeadingOnly(text,b.title))continue;
   if(b.offset>consumed)output.push({...segment,text:segment.text.slice(consumed,b.offset).trim()});
   const {offset:ignored,...heading}=b;output.push({...heading,text});
   moves.push({number:segment.number,file:b.file,page:b.page,volume:b.volume,title:b.title,level:b.level,sectionNumber:b.sectionNumber,text});
   consumed=end;
  }
  if(consumed<segment.text.length)output.push({...segment,text:segment.text.slice(consumed).trim()});
 }
 if(compact(output.map(s=>s.text).join(''))!==compact(segments.map(s=>s.text).join('')))throw Error('Introduction split lost or duplicated source text');
 return {segments:output,moves,rejected};
}
module.exports={splitIntroductions};
