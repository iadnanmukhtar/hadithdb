#!/usr/bin/env node
'use strict';
require('dotenv').config();
const fs=require('fs'),assert=require('assert/strict'),crypto=require('crypto'),mysql=require('mysql'),{promisify}=require('util');
const dataDir=process.env.MISHKAT_DATA_DIR || (fs.existsSync('temp/mishkat/mishkat-import-review.json')?'temp/mishkat':'temp');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
async function main(){
 const reviewed=process.argv.includes('--reviewed'),pass2=process.argv.includes('--muttafaq-pass2');
 const safeEs=process.argv.includes('--safe-es'),esMode=reviewed||safeEs||process.argv.includes('--es');
 assert(!(process.argv.includes('--apply')&&esMode&&!safeEs&&!reviewed),'Broad ES candidates require individual review; use the audited safe plan');
 const prefix=reviewed?'mishkat-reviewed':pass2?'mishkat-muttafaq-pass2':safeEs?'mishkat-es-safe':esMode?'mishkat-es':'mishkat-muttafaq';
 const plan=JSON.parse(fs.readFileSync(`${dataDir}/${prefix}-plan.json`)),baseline=JSON.parse(fs.readFileSync(reviewed?`${dataDir}/mishkat-reviewed-live.json`:pass2?`${dataDir}/mishkat-muttafaq-pass2-live.json`:esMode?`${dataDir}/mishkat-es-baseline.json`:`${dataDir}/mishkat-muttafaq-live.json`));
 if(safeEs)for(const r of plan.resolved){assert(r.audit?.approved&&r.scope.mode==='cited-books');assert((r.number===5597&&r.ref==='tirmidhi:2432'&&r.audit.narratorVerified)||(r.audit.score===1&&r.audit.words>=12)||(r.audit.narratorVerified&&r.audit.score>=.9&&r.audit.words>=8));}
 if(reviewed)for(const r of plan.resolved){assert(r.audit?.approved&&r.audit.reason);assert(r.scope.mode==='cited-books'||(r.scope.mode==='reviewed-source-exception'&&r.audit.userRequestedSourceException&&r.audit.narratorVerified&&r.originalScope?.mode==='cited-books')||(r.scope.mode==='reviewed-existing-books'&&r.audit.userRequestedSourceException&&r.audit.identityReviewed&&r.originalScope&&r.scope.aliases.length===1&&!['misc','suyuti'].includes(r.scope.aliases[0])),'Uncited source requires an explicitly requested, individually reviewed exception');}
 if(pass2)for(const r of plan.resolved){assert(r.audit?.approved&&r.audit.reason,'Each approximate match must be reviewed');assert(['bukhari','muslim'].includes(r.ref.split(':')[0]));}
 const db=mysql.createConnection(require('./initializeHadithAttributions').connectionSettings()),q=promisify(db.query).bind(db);
 try{
 const ids=plan.resolved.map(r=>r.aliasId);assert(ids.length);assert.equal(new Set(ids).size,ids.length);
 const aliases=await q('SELECT * FROM hadiths_virtual WHERE id IN (?) ORDER BY id',[ids]);assert.equal(aliases.length,ids.length);
 const targetIds=[...new Set(plan.resolved.map(r=>r.targetId))],oldIds=[...new Set(plan.resolved.map(r=>r.oldId))];
 const physical=await q('SELECT * FROM hadiths WHERE id IN (?)',[ [...new Set([...targetIds,...oldIds])] ]),byId=new Map(physical.map(r=>[r.id,r]));
 const originals=new Map(baseline.aliases.map(r=>[r.id,r]));
 const sharhLinks=await q('SELECT * FROM hdith_virtual_sharh_links WHERE virtual_id IN (?) ORDER BY sharh_id',[ids]);
 const sharh=sharhLinks.length?await q('SELECT * FROM hdith_hadith_sharh WHERE id IN (?) ORDER BY id',[sharhLinks.map(l=>l.sharh_id)]):[];
 const sharhTargets=new Map(sharhLinks.map(l=>[l.sharh_id,plan.resolved.find(r=>r.aliasId===l.virtual_id).targetId]));
 for(const s of sharh){const link=sharhLinks.find(l=>l.sharh_id===s.id);assert.equal(s.hadith_id,originals.get(link.virtual_id).hadithId);}
 if(sharh.length){const triggers=await q("SHOW TRIGGERS WHERE `Table`='hadiths_virtual'");const expected=require('../lib/VirtualHadithSharh').triggers.virtual_sharh_after_update;assert.equal(triggers.find(t=>t.Trigger==='virtual_sharh_after_update')?.Statement.replace(/\s+/g,' ').trim(),expected.slice(expected.indexOf('BEGIN')).replace(/\s+/g,' ').trim(),'Commentary ownership trigger must be present and unchanged');}
 for(const a of aliases){const old=originals.get(a.id);for(const k of Object.keys(a))assert.equal(JSON.stringify(a[k]),JSON.stringify(old[k]),`Alias changed: ${a.id}:${k}`);}
 for(const r of plan.resolved){const target=baseline.candidates.find(c=>c.id===r.targetId);assert(esMode?r.scope.aliases.includes(target.alias):['bukhari','muslim'].includes(target.alias));if(pass2||reviewed)assert.equal(sha(JSON.stringify([target.id,target.bookId,target.num,target.chain,target.body])),r.audit.targetSha256);for(const k of (pass2||reviewed?['body','chain','num','bookId','text']:['body','chain','num','bookId']))assert.equal(byId.get(r.targetId)[k],target[k]);}
 const deleted=oldIds.filter(id=>byId.get(id).bookId===9999);for(const id of deleted)assert.equal(byId.get(id).lastmod_user,'epub:mishkat-misc');
 const dependencies=[];
 const schema=JSON.parse(fs.readFileSync(`${dataDir}/mishkat-muttafaq-schema.json`));
 const pairs=new Map([...schema.cols.filter(r=>!r.TABLE_NAME.startsWith('v_')), ...schema.fks].map(r=>[r.TABLE_NAME+':'+r.COLUMN_NAME,r]));
 // Similarity relations have additional non-FK columns pointing at physical records.
 const other=await q("SELECT TABLE_NAME,COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND (COLUMN_NAME LIKE '%hadith%' OR COLUMN_NAME IN ('refId')) AND TABLE_NAME NOT LIKE 'v\\_%'");
 for(const r of other.filter(r=>/^(hadithId[12]|hadith_id[12]|related_hadith_id|target_hadith_id)$/.test(r.COLUMN_NAME)))pairs.set(r.TABLE_NAME+':'+r.COLUMN_NAME,r);
 if(deleted.length)for(const {TABLE_NAME:t,COLUMN_NAME:c} of pairs.values()){
  const rows=await q(`SELECT * FROM \`${t}\` WHERE \`${c}\` IN (?)`,[deleted]);if(!rows.length)continue;
  dependencies.push({table:t,column:c,rows});
  if(t==='hadiths_virtual')assert(rows.every(r=>ids.includes(r.id)),'Other virtual alias references a placeholder');
  else if(t==='hdith_hadith_sharh')assert(rows.every(r=>sharhTargets.has(r.id)),'Unowned commentary must be preserved before deletion');
  else assert(t==='hadiths_grades'&&rows.every(r=>[null,0].includes(r.gradeId)||r.gradeId===byId.get(r.hadithId).gradeId),`Dependent data in ${t}; must preserve before deletion`);
 }
 if(deleted.length)assert.equal((await q("SELECT COUNT(*) n FROM user_content_translations WHERE item_type='hadith' AND item_id IN (?)",[deleted.map(String)]))[0].n,0,'Saved user translations must be preserved');
 const books=await q('SELECT * FROM books WHERE id IN (100419,9999)'),toc=await q('SELECT * FROM toc WHERE bookId=9999');
 const bytes=fs.readFileSync(`${dataDir}/mishkat-import-review.json`),report=JSON.parse(bytes),entries=new Map(report.entries.map(e=>[e.number,e]));
 const summary={...plan.stats,deleteMisc:deleted.length,dependentGradeRows:dependencies.filter(d=>d.table==='hadiths_grades').reduce((n,d)=>n+d.rows.length,0)};console.log(summary);
 if(!process.argv.includes('--apply'))return;
 const backup=`${dataDir}/${prefix}-before-${Date.now()}.json`;fs.writeFileSync(backup,JSON.stringify({books,toc,aliases,physical,dependencies,sharh,sharhLinks,report,plan}));
 for(const r of plan.resolved){const h=entries.get(r.number);assert(h.links.some(l=>l.id===r.oldId));h.links=h.links.map(l=>l.id===r.oldId?{id:r.targetId,ref:r.ref,method:r.method,sourceMatchVerified:true,evidence:{score:r.candidates[0].evidence?.score??r.candidates[0].score,narrator:r.narrator,previousRef:r.from,aliasId:r.aliasId}}:l);if(r.noteAddition)h.footnote=(h.footnote||'')+r.noteAddition;h.placeholderResolution={previousRef:r.from,ref:r.ref,deletedMiscId:deleted.includes(r.oldId)?r.oldId:undefined};if(deleted.includes(r.oldId)){h.originalMiscImport=h.miscImport;delete h.miscImport;}}
 report.stats.miscEntries=report.entries.filter(h=>h.links.some(l=>l.ref.startsWith('misc:'))).length;report.stats.matchedSourceEntries=report.stats.linkedEntries-report.stats.miscEntries;
 assert.equal(sha(bytes),plan.baseReportSha256);assert.equal(require('./import-mishkat-epub').parse(`${dataDir}/مشكاة المصابيح.epub`).sha256,plan.sourceSha256);
 const next=JSON.stringify(report,null,2),book=books.find(b=>b.id===100419),props=JSON.parse(book.properties);props.mishkatImport.reportSha256=sha(next);props.mishkatMiscImport.originalEntries??=props.mishkatMiscImport.entries;props.mishkatMiscImport.entries=report.stats.miscEntries;props[esMode?'mishkatEsRecovery':'mishkatMuttafaqRecovery']={...summary,backup};
 await q('START TRANSACTION');
 try{
  const locked=await q('SELECT * FROM hadiths_virtual WHERE id IN (?) ORDER BY id FOR UPDATE',[ids]);assert.deepEqual(locked,aliases);
  assert.deepEqual(await q('SELECT * FROM hdith_virtual_sharh_links WHERE virtual_id IN (?) ORDER BY sharh_id FOR UPDATE',[ids]),sharhLinks);
  if(sharh.length)assert.deepEqual(await q('SELECT * FROM hdith_hadith_sharh WHERE id IN (?) ORDER BY id FOR UPDATE',[sharh.map(s=>s.id)]),sharh);
  const oldLocked=await q('SELECT * FROM hadiths WHERE id IN (?) FOR UPDATE',[oldIds]);for(const row of oldLocked)assert.deepEqual(row,byId.get(row.id));
  assert.equal(sha(fs.readFileSync(`${dataDir}/mishkat-import-review.json`)),sha(bytes));
  for(const r of plan.resolved)await q('UPDATE hadiths_virtual SET hadithId=?,ref_num=?,bookActual=?,muttafaq=COALESCE(?,muttafaq) WHERE id=?',[r.targetId,r.ref,r.ref.split(':')[0],esMode?null:1,r.aliasId]);
  for(const r of plan.resolved.filter(r=>r.noteAddition))await q("UPDATE hadiths_virtual SET note=CONCAT(COALESCE(note,''),?) WHERE id=?",[r.noteAddition,r.aliasId]);
  if(sharh.length){const afterSharh=await q('SELECT * FROM hdith_hadith_sharh WHERE id IN (?) ORDER BY id',[sharh.map(s=>s.id)]);assert.equal(afterSharh.length,sharh.length);for(let i=0;i<sharh.length;i++)assert.deepEqual({...afterSharh[i]},{...sharh[i],hadith_id:sharhTargets.get(sharh[i].id)});assert.deepEqual(await q('SELECT * FROM hdith_virtual_sharh_links WHERE virtual_id IN (?) ORDER BY sharh_id',[ids]),sharhLinks);}
  if(deleted.length){assert.equal((await q('SELECT COUNT(*) n FROM hadiths_virtual WHERE hadithId IN (?)',[deleted]))[0].n,0);await q('DELETE FROM hadiths_grades WHERE hadithId IN (?)',[deleted]);const result=await q('DELETE FROM hadiths WHERE id IN (?) AND bookId=9999 AND lastmod_user=?',[deleted,'epub:mishkat-misc']);assert.equal(result.affectedRows,deleted.length);}
  const after=await q('SELECT * FROM hadiths_virtual WHERE id IN (?) ORDER BY id',[ids]);
  for(const a of after){const old=originals.get(a.id),r=plan.resolved.find(r=>r.aliasId===a.id);assert.equal(a.hadithId,r.targetId);assert.equal(a.ref_num,r.ref);assert.equal(a.note,r.noteAddition?(old.note||'')+r.noteAddition:old.note);for(const k of Object.keys(old).filter(k=>!['note','hadithId','ref_num','bookActual','muttafaq','lastmod','sourceAlias'].includes(k)))assert.deepEqual(a[k],old[k]);}
  for(const t of toc){const [count]=await q('SELECT COUNT(*) n FROM hadiths WHERE tocId=?',[t.id]);await q('UPDATE toc SET count=? WHERE id=?',[count.n,t.id]);}
  // Rebuild collection membership on surviving old/new physical records after the alias move.
  for(const id of [...new Set([...oldIds.filter(id=>!deleted.includes(id)),...targetIds])]){const membership=await q('SELECT DISTINCT b.alias FROM books b JOIN hadiths h ON h.bookId=b.id WHERE h.id=? UNION SELECT DISTINCT b.alias FROM books b JOIN hadiths_virtual v ON v.bookId=b.id WHERE v.hadithId=?',[id,id]);await q('UPDATE hadiths SET books=? WHERE id=?',[membership.map(b=>`{${b.alias}}`).join(''),id]);}
  const description=book.description.replace(/Of these, [\d,]+ have source-collection matches; [\d,]+ are preserved verbatim/,`Of these, ${report.stats.matchedSourceEntries.toLocaleString('en-US')} have source-collection matches; ${report.stats.miscEntries.toLocaleString('en-US')} are preserved verbatim`);
  await q('UPDATE books SET properties=?,description=?,content_lastmod=NOW() WHERE id=100419',[JSON.stringify(props),description]);await q('UPDATE books SET content_lastmod=NOW() WHERE id=9999');
  await q('COMMIT');
 }catch(e){await q('ROLLBACK');throw e;}
 fs.writeFileSync(`${dataDir}/mishkat-import-review.json`,next);fs.writeFileSync(`${dataDir}/${prefix}-applied.json`,JSON.stringify({summary,backup,deleted,targetIds,oldIds,changes:plan.resolved.map(({aliasId,number,from,ref,oldId,targetId})=>({aliasId,number,from,ref,oldId,targetId})),verified:true},null,2));console.log({applied:true,backup});
 }finally{db.destroy();}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
