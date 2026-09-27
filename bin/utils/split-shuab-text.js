#!/usr/bin/env node
'use strict';
const fs=require('fs'),assert=require('assert/strict');
const unmark=s=>s.replace(/[\u064b-\u065f\u0670\u06d6-\u06edـ]/g,'');
function mapped(s){let text='',offsets=[];for(let i=0;i<s.length;i++){const ch=unmark(s[i]);if(ch){text+=ch;offsets.push(i);}}return {text,offsets};}
const transmit=/^[وف]?(?:سمعته|سمعت|أنشدنا|أنشدني|أخبرنا|أخبرني|أخبرناه|أنبأنا|أنبأني|أنبأ|حدثنا|حدثني|حدثناه|ثنا|نا|أنا)$/;
// These source entries have an introductory rubric or omit an opening transmission verb.
// Reviewed against the current Shuab text; do not generalize these openings to other books.
const reviewedOpenings=new Set('109 347 3631 4795 4960 5091 5246 5315 5316 5469 5514 5555a 5555b 5594 5612 5676 5698 5888 5889 5923 5950 6168 6380 6605a 6605b 7616 7694 7956 8131 8217 8275 8287 8303 8500 8628 8664 9470 9484 9633 9740 9773'.split(' '));
const reviewedBoundaries={5338:'فِي قَوْلِ اللهِ',5424:'وَهَذَا لَيْسَ',6368:'وَأَصَحُّ ذَلِكَ',9622:'خَلِيلَيَّ',9717:'مَا بَيْنَ'};
function boundary(text,num){
 if(reviewedBoundaries[num]){
  const m=mapped(text),needle=unmark(reviewedBoundaries[num]),i=m.text.indexOf(needle);
  assert(i>0,'Reviewed boundary missing: '+num);
  return {offset:m.offsets[i],method:'reviewed-boundary'};
 }
 const {text:s,offsets}=mapped(text);const tokens=[...s.matchAll(/[\p{L}ﷺؓ]+|["«»{]/gu)].map(m=>({v:m[0],i:m.index}));
 let first=0;
 while(['\"','«','وذلك','وهذا','فيما','وفيما','ففيما','الذي','كما','وبه','وقد','فقد','ما','وبهذا','الإسناد','وبإسناده'].includes(tokens[first]?.v))first++;
 if(!reviewedOpenings.has(String(num))&&(!tokens.length||!transmit.test(tokens[first]?.v||'')&&!['قال','وقال','وروى','قرأت','أجاز'].includes(tokens[first]?.v)&&!(first>0&&['عن','سواء','فيما'].includes(tokens[first]?.v))))return {offset:0,method:'no-opening-isnad'};
 for(let i=first+1;i<tokens.length;i++){
  const t=tokens[i],v=t.v,next=tokens[i+1]?.v;
  if(v==='{'||v==='قوله'||v==='في'&&['قوله','قول'].includes(next))return {offset:offsets[t.i],method:'verse-commentary'};
  if(['"','«'].includes(v)){
   if(transmit.test(next||''))continue;
   return {offset:offsets[t.i],method:'quotation'};
  }
  if(v==='نحو'&&next==='الأول')return {offset:offsets[t.i],method:'abbreviated-report'};
  if(v==='بهذا'&&next==='الحديث')return {offset:offsets[t.i],method:'abbreviated-report'};
  if(/^(?:ف?ذكره|فذكر|بمثله|مثله|نحوه|بمعناه|بإسناده|بذلك|يرفعه|رفعه)$/.test(v))return {offset:offsets[t.i],method:'abbreviated-report'};
  if(v==='رسول'&&next==='الله'||v==='النبي'||v==='ﷺ'){
   let j=i;if(['عن','أن','أنها','أنه','سمعت','سمع','يبلغ','به'].includes(tokens[i-1]?.v))j=i-1;
   return {offset:offsets[tokens[j].i],method:'prophetic-attribution'};
  }
  if(['أن','أنه','أنها','أنهم'].includes(v)){
   // Explicit nested transmission remains part of the chain.
   const following=tokens.slice(i+1,i+9).map(x=>x.v);
   if(following.some(x=>/^(?:حدثه|حدثته|أخبره|أخبرته|أخبرهم)$/.test(x)))continue;
   return {offset:offsets[t.i],method:'reported-event'};
  }
  if(/^[وف]?(قال|قالت|يقول|تقول|قالا|قالوا)$/.test(v)){
   let j=i+1;while(['قال','قالا','وقال','فقال'].includes(tokens[j]?.v))j++;
   const n=tokens[j]?.v;
   if(transmit.test(n||'')||['عن','سمعت','سمعنا','سمع','أنبأني'].includes(n))continue;
   // Names between "قال" and another transmission are still isnad.
   let k=j;while(k<Math.min(tokens.length,j+10)&&!['"','«','قال','يقول'].includes(tokens[k].v)&&!transmit.test(tokens[k].v))k++;
   if(k<Math.min(tokens.length,j+10)&&transmit.test(tokens[k].v)&&tokens.slice(j,k).some(x=>['بن','ابن','أبو','أبي'].includes(x.v)))continue;
   return {offset:offsets[t.i],method:'terminal-speech'};
  }
 }
 const poetry=text.indexOf('[البحر');
 if(poetry>0)return {offset:poetry,method:'poetry'};
 return {offset:0,method:'unresolved'};
}
// Closing references obscured by unmatched EPUB quotation marks, reviewed individually.
// Per the requested temporary convention, فرواه also starts a footnote inside quotations.
const reviewedFootnotes={
 151:'تفرد به عبيد الله',167:'كذا قال البخاري',1172:'ورواه شريك',1432:'هذا لفظ حديث الفقيه',
 1486:'والحديث الذي روي في الآل',2153:'قال أبو بكر البيهقي',2285:'ورواه غيره عن القعنبي',
 2873:'وذكر جابر فيه غير محفوظ',3092:'هكذا قاله ابن عيينة',3529:'قال أحمد:',3670:'وقد رويناه من وجه آخر',
 3965:'قال البخاري:',4578:'ورواه هشام بن عروة',4607:'ورواه أيضا مبارك',5048:'ورواه جماعة',
 5473:'رواه أبو عيسى',5620:'رواه حماد بن سلمة',5873:'ورواه غيره',5917:'ورواه أبو داود',
 6064:'رواه حماد',6403:'ورواه جرير',6438:'ورواه عبدان',6689:'وفي رواية عبد الغني',
 8193:'ورواه همام',8612:'قال أبو علي:',8895:'ورواه يحيى',10171:'رواه أحمد بن حنبل',
 10357:'ورواه حميد',10579:'وكذلك رواه مكحول',10620:'هذا الإسناد أولى بالصحة'
};
function rawahuOffset(text,start,num){
 if(reviewedFootnotes[num]){
  const m=mapped(text),i=m.text.indexOf(reviewedFootnotes[num]);
  assert(i>=0&&m.offsets[i]>start,'Reviewed reference missing: '+num);
  return m.offsets[i];
 }

 const {text:s,offsets}=mapped(text);let quoted=false;const states=[];
 for(let i=0;i<s.length;i++){states[i]=quoted;if(s[i]==='"')quoted=!quoted;if(s[i]==='«')quoted=true;if(s[i]==='»')quoted=false;}
 for(const m of s.matchAll(/(?:^|\s)([وف]?رواه)(?=\s)/g)){
  let i=m.index+m[0].length-m[1].length;
  // Include the introductory words belonging to the reference, not half a sentence.
  const prefix=s.slice(0,i).match(/(?:[وف]?(?:هكذا|كذا|كذلك|بمعناه|بهذا المعنى)\s+)$/);
  if(prefix)i-=prefix[0].length;
  let offset=offsets[i];
  const rawIndex=m.index+m[0].length-m[1].length;
  const namedCollection=/^[وف]?رواه\s+(?:البخاري|مسلم)(?:\s|،|,|\.|$)/u.test(s.slice(rawIndex))||/^[وف]?رواه[^.\n]{0,90}(?:البخاري|مسلم بن الحجاج)/u.test(s.slice(rawIndex));
  const authors=[...s.slice(0,i).matchAll(/قال (?:البيهقي|الإمام أحمد|الامام أحمد|الشيخ)(?:[^:]{0,35}):\s*"?/g)];
  const author=authors.filter(a=>offsets[a.index]>start).at(-1);
  if(author&&offsets[author.index]>start){i=author.index;offset=offsets[i];}
  if(offset<=start||(states[i]&&!namedCollection&&!author&&!prefix&&m[1]!=='فرواه'))continue;
  // Require some actual report text before a closing source-reference paragraph.
  const preceding=unmark(text.slice(start,offset)).trim();
  if(preceding.split(/\s+/).length<3&&!/^(?:(?:يقول: )?ف?ذكره(?: بمثله| بإسناده| مرسلا| مثله)?|بهذا الحديث|بمثله|مثله|نحوه|بمعناه)[.،\s]*$/.test(preceding))continue;
  return offset;
 }
 return -1;
}
function split(row){
 if(row.chain)return {...row,method:'existing-chain'};
 const text=row.body||'',b=boundary(text,row.num),r=rawahuOffset(text,b.offset,row.num);
 const end=r<0?text.length:r,chain=b.offset?text.slice(0,b.offset).trim():null,body=text.slice(b.offset,end).trim();
 const moved=r<0?'':text.slice(r).trim(),footnote=[moved,row.footnote].filter(Boolean).join('\n\n')||null;
 if(!body)throw Error('Empty matn '+row.num);
 const whitespace=s=>(s||'').replace(/\s/g,'');
 assert.equal(whitespace([chain,body,moved].filter(Boolean).join(' ')),whitespace(text),'Text conservation '+row.num);
 return {id:row.id,num:row.num,chain,body,footnote,text:[chain,body].filter(Boolean).join(' '),method:b.method,moved:!!moved};
}
function plan(){const rows=JSON.parse(fs.readFileSync('temp/shuab/split-source.json'));const patches=rows.map(split);const stats={reports:rows.length,chains:patches.filter(r=>r.chain).length,footnotesMoved:patches.filter(r=>r.moved).length,methods:patches.reduce((a,r)=>(a[r.method]=(a[r.method]||0)+1,a),{})};fs.writeFileSync('temp/shuab/split-plan.json',JSON.stringify({stats,patches},null,2));console.log(stats);}
module.exports={split,boundary,rawahuOffset};
async function apply(){
 require('dotenv').config();
 const db=require('mysql').createConnection(require('../initializeHadithAttributions').connectionSettings());
 const q=require('util').promisify(db.query).bind(db);
 const fields=['chain','body','text','footnote'];
 const verifyOnly=process.argv.includes('--verify');
 const source=JSON.parse(fs.readFileSync('temp/shuab/split-source.json'));
 const proposed=JSON.parse(fs.readFileSync('temp/shuab/split-plan.json'));
 assert.equal(source.length,10725);
 // Reproduce the reviewed plan before touching the database.
 assert.deepEqual(source.map(split),proposed.patches);
 try{
  await q('START TRANSACTION');
  const rows=await q(`SELECT ${verifyOnly?'h.id,h.chain,h.body,h.text,h.footnote':'h.*'} FROM hadiths h JOIN books b ON b.id=h.bookId WHERE b.alias='shuab' ORDER BY h.ordinal ${verifyOnly?'':'FOR UPDATE'}`);
  assert.equal(rows.length,source.length);
  const patches=[];
  for(let i=0;i<rows.length;i++){
   const r=rows[i],before=source[i],after=proposed.patches[i];
   assert.equal(r.id,before.id);
   const already=fields.every(k=>r[k]===after[k]);
   if(already)continue;
   for(const k of fields)assert.equal(r[k],before[k],`Concurrent edit: ${r.id}:${k}`);
   patches.push(after);
  }
  if(!patches.length){await q('ROLLBACK');console.log('Verified all 10,725 reports: no changes needed');return;}
  assert(!verifyOnly,`${patches.length} pending changes`);
  const backup=`temp/shuab/text-split-before-${Date.now()}.json`;
  fs.writeFileSync(backup,JSON.stringify(rows));
  await q('CREATE TEMPORARY TABLE shuab_text_patch (id INT PRIMARY KEY, chain LONGTEXT, body LONGTEXT, text LONGTEXT, footnote LONGTEXT) CHARACTER SET utf8mb4');
  for(let i=0;i<patches.length;i+=300){
   const raw=Buffer.from(JSON.stringify(patches.slice(i,i+300)));const size=Buffer.alloc(4);size.writeUInt32LE(raw.length);
   const packed=Buffer.concat([size,require('zlib').deflateSync(raw)]).toString('base64');
   await q(`INSERT INTO shuab_text_patch SELECT * FROM JSON_TABLE(CONVERT(UNCOMPRESS(FROM_BASE64(?)) USING utf8mb4),'$[*]' COLUMNS(id INT PATH '$.id',chain LONGTEXT PATH '$.chain',body LONGTEXT PATH '$.body',text LONGTEXT PATH '$.text',footnote LONGTEXT PATH '$.footnote')) j`,[packed]);
  }
  await q('UPDATE hadiths h JOIN shuab_text_patch p ON p.id=h.id SET h.chain=p.chain,h.body=p.body,h.text=p.text,h.footnote=p.footnote WHERE h.bookId=100420');
  // The existing trigger derives search_chain/search_body from OLD values.
  await q('UPDATE hadiths h JOIN shuab_text_patch p ON p.id=h.id SET h.body=h.body WHERE h.bookId=100420');
  const after=await q('SELECT * FROM hadiths WHERE bookId=100420 ORDER BY ordinal');
  const changed=new Map(patches.map(p=>[p.id,p]));
  for(let i=0;i<after.length;i++)for(const k of Object.keys(after[i])){
   if(['lastmod','search_chain','search_body','search_text'].includes(k))continue;
   const expected=changed.has(after[i].id)&&fields.includes(k)?changed.get(after[i].id)[k]:rows[i][k];
   assert.deepEqual(after[i][k],expected,`Preservation: ${after[i].id}:${k}`);
  }
  const invalid=await q(`SELECT COUNT(*) AS n FROM hadiths WHERE bookId=100420 AND (NOT(search_chain <=> remove_tashkil(chain)) OR NOT(search_body <=> remove_tashkil(body)) OR NOT(search_text <=> remove_tashkil(CONCAT(COALESCE(chain,''),' ',COALESCE(body,''),' ',COALESCE(footnote,'')))))`);
  assert.equal(invalid[0].n,0);
  await q('UPDATE books SET content_lastmod=NOW() WHERE id=100420');
  await q('COMMIT');
  fs.writeFileSync('temp/shuab/text-split-applied.json',JSON.stringify({backup,updated:patches.length,stats:proposed.stats,verified:true},null,2));
  console.log(JSON.stringify({backup,updated:patches.length,verified:true}));
 }catch(e){await q('ROLLBACK');throw e;}finally{db.end();}
}
if(require.main===module){
 if(process.argv.includes('--apply')||process.argv.includes('--verify'))apply().catch(e=>{console.error(e.stack);process.exitCode=1;});
 else plan();
}
